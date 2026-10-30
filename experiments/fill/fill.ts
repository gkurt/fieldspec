/**
 * How well Jev and Clairic fill in a form from a message, measured against known answers.
 *
 * - Jev chooses: code proposes candidates from the message (sentences, clauses, names, numbers,
 *   emails, versions…) and Jev picks one per field, or "not stated"; options and yes/no it
 *   picks directly.
 * - Clairic reads: text as spans of the message, numbers, dates and durations worked out from
 *   it; options and yes/no as spans of a list appended to the message.
 * - Both: Jev for options and yes/no, Clairic for everything else, in parallel.
 *
 *   bun experiments/fill/fill.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clairic, type ClairicField } from "../clairic-specs/clairic.ts";
import { systemOne, type ChoiceAnswer, type NoulAnswer, type Question } from "../jev-specs/generate.ts";
import { CASES, type Case, type Need } from "./cases.ts";

// ── Fields ───────────────────────────────────────────────────────────────────────────────

export interface Field {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly description?: string;
  readonly unit?: string;
  readonly time?: boolean;
  readonly maxLength?: number;
  readonly options?: readonly { value: string; label: string }[];
}

export function fieldsOf(c: Case): Field[] {
  return Object.entries(c.spec.fields as Record<string, Record<string, unknown>>).map(([key, d]) => ({
    key,
    label: String(d.label ?? key),
    type: String(d.type),
    ...(typeof d.description === "string" && { description: d.description }),
    ...(typeof d.unit === "string" && { unit: d.unit }),
    ...(d.time === true && { time: true }),
    ...(typeof d.maxLength === "number" && { maxLength: d.maxLength }),
    ...(Array.isArray(d.options) && { options: d.options as { value: string; label: string }[] }),
  }));
}

const isText = (f: Field) => f.type === "string" || f.type === "url";
const isNumber = (f: Field) => f.type === "int" || f.type === "number";
const TIME_UNITS = new Set(["seconds", "minutes", "hours", "days", "weeks"]);

export type Values = Record<string, unknown>;
export interface Filled {
  readonly values: Values;
  /** Per field: how sure the model was, as it reports it. */
  readonly sureness: Record<string, number | undefined>;
  readonly calls: readonly { model: string; ms: number; tokens: number }[];
  readonly ms: number;
}

// ── Jev: choosing ────────────────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };

/** Spans of the message a text field might take. */
export function textCandidates(source: string): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.trim().replace(/^(?:and|but|so|or)\s+/i, "").replace(/[.!?]+$/, "").trim();
    if (t.length > 1 && t.length < 200) out.add(t);
  };
  for (const sentence of source.split(/(?<=[.!?])\s+/)) {
    add(sentence);
    for (const clause of sentence.split(/[,;:]|\s[–—]\s/)) {
      add(clause);
      for (const part of clause.split(/\s+and\s+/)) add(part);
    }
  }
  const patterns = [
    /[\w.+-]+@[\w-]+\.[\w.]+/g, // emails
    /\b(?:https?:\/\/)?[a-z0-9-]+\.(?:io|com|org|net|dev|ai|co)\b/gi, // sites
    /\b\d+(?:\.\d+)+\b/g, // versions
    /\b[A-Z][\w'’]*(?:\s+(?:[A-Z][\w'’]*|\d+\w*|&))*/g, // names, places, models
    /(?<=^|\s)['"][^'"]+['"](?=[\s,.!?]|$)/g, // quoted
    /\b[A-Z][a-z]{2,}\b/g, // single capitalized words
    /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g, // UK postcodes
    /\b\d+\w*\s+[A-Z][a-z]+\s+(?:Street|Road|Avenue|Lane|Way)\b/g, // street addresses
  ];
  for (const p of patterns) for (const m of source.matchAll(p)) add(m[0]);
  return [...out];
}

/** Numbers in the message, each with the words around it. */
export function numberCandidates(source: string): { value: number; context: string }[] {
  const out: { value: number; context: string }[] = [];
  const re = new RegExp(`\\b(\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join("|")})\\b`, "gi");
  for (const m of source.matchAll(re)) {
    const value = NUMBER_WORDS[m[1]!.toLowerCase()] ?? Number(m[1]);
    const context = source.slice(Math.max(0, m.index! - 30), m.index! + m[0].length + 30).trim();
    if (!out.some((o) => o.value === value)) out.push({ value, context });
  }
  return out;
}

const NOT_STATED = "not_stated";

export async function fillJev(c: Case): Promise<Filled> {
  const started = performance.now();
  const fields = fieldsOf(c);
  const texts = textCandidates(c.source);
  const numbers = numberCandidates(c.source);
  const what = (f: Field) => `the form field "${f.label}"${f.description ? ` (${f.description})` : ""}${f.unit ? `, in ${f.unit}` : ""}`;
  const questions: Record<string, Question> = {};
  for (const f of fields) {
    const instructions = `According to \`source\`, what should ${what(f)} be?`;
    const none = { [NOT_STATED]: "`source` does not say" };
    if (f.type === "enum") questions[f.key] = { type: "choice", instructions, criteria: { ...Object.fromEntries(f.options!.map((o) => [o.value, o.label])), ...none } };
    else if (f.type === "boolean") questions[f.key] = { type: "choice", instructions, criteria: { yes: "Yes, or on", no: "No, or off", ...none } };
    else if (isNumber(f)) questions[f.key] = { type: "choice", instructions, criteria: { ...Object.fromEntries(numbers.map((n, i) => [`n${i}`, `${n.value} (from "…${n.context}…")`])), ...none } };
    else questions[f.key] = { type: "choice", instructions, criteria: { ...Object.fromEntries(texts.map((t, i) => [`t${i}`, t])), ...none } };
  }
  const call = await systemOne({ source: c.source }, questions);
  const values: Values = {};
  const sureness: Record<string, number> = {};
  for (const f of fields) {
    const a = call.answers[f.key] as ChoiceAnswer;
    sureness[f.key] = a.probabilities[a.choice];
    if (a.choice === NOT_STATED) values[f.key] = null;
    else if (f.type === "enum") values[f.key] = a.choice;
    else if (f.type === "boolean") values[f.key] = a.choice === "yes";
    else if (isNumber(f)) values[f.key] = numbers[Number(a.choice.slice(1))]!.value;
    else values[f.key] = texts[Number(a.choice.slice(1))];
  }
  return { values, sureness, calls: [{ model: call.model, ms: Math.round(call.ms), tokens: call.tokens }], ms: Math.round(performance.now() - started) };
}

// ── Clairic: reading ─────────────────────────────────────────────────────────────────────

const id = (key: string) => key.replace(/[^A-Za-z0-9_.-]/g, "_");

export async function fillClairic(c: Case, only?: (f: Field) => boolean): Promise<Filled> {
  const started = performance.now();
  const fields = fieldsOf(c).filter((f) => !only || only(f));
  const lists: string[] = [];
  const asked: Record<string, ClairicField> = {};
  for (const f of fields) {
    const what = `${f.label}${f.description ? ` (${f.description})` : ""}`;
    if (f.type === "enum") {
      lists.push(`Options for ${f.label}: ${f.options!.map((o) => o.label).join("; ")}.`);
      asked[id(f.key)] = { type: "text", instructions: `The option, from those listed for ${f.label}, that the message calls for` };
    } else if (f.type === "boolean") {
      lists.push(`Answers for ${f.label}: yes; no.`);
      asked[id(f.key)] = { type: "text", instructions: `The answer, yes or no from those listed for ${f.label}, that the message gives` };
    } else if (isNumber(f) && f.unit && TIME_UNITS.has(f.unit)) {
      asked[id(f.key)] = { type: "duration", unit: f.unit, instructions: `The ${what}` };
    } else if (isNumber(f)) {
      asked[id(f.key)] = { type: "number", integer: f.type === "int", ...(f.unit && { unit: f.unit }), instructions: `The ${what}${f.unit ? ` in ${f.unit}` : ""}` };
    } else if (f.type === "date") {
      asked[id(f.key)] = { type: f.time ? "datetime" : "date", instructions: `The ${what}` };
    } else {
      asked[id(f.key)] = { type: "text", instructions: `The ${what}` };
    }
  }
  const state = lists.length ? `${c.source}\n\n${lists.join("\n")}` : c.source;
  const call = await clairic(state, asked, c.today);
  const values: Values = {};
  const sureness: Record<string, number | undefined> = {};
  for (const f of fields) {
    const a = call.answers[id(f.key)]!;
    sureness[f.key] = a.confidence;
    const v = a.value;
    if (v === null || v === undefined || v === "") values[f.key] = null;
    else if (f.type === "enum") values[f.key] = f.options!.find((o) => o.label.toLowerCase() === String(v).toLowerCase())?.value ?? null;
    else if (f.type === "boolean") values[f.key] = /^y/i.test(String(v)) ? true : /^n/i.test(String(v)) ? false : null;
    else values[f.key] = v;
  }
  return { values, sureness, calls: [{ model: "clairic", ms: Math.round(call.ms), tokens: call.tokens }], ms: Math.round(performance.now() - started) };
}

// ── Both ─────────────────────────────────────────────────────────────────────────────────

const chosen = (f: Field) => f.type === "enum" || f.type === "boolean";

export async function fillBoth(c: Case): Promise<Filled> {
  const started = performance.now();
  const [jev, read] = await Promise.all([fillJev(c), fillClairic(c, (f) => !chosen(f))]);
  const values: Values = {};
  const sureness: Record<string, number | undefined> = {};
  for (const f of fieldsOf(c)) {
    const from = chosen(f) ? jev : read;
    values[f.key] = from.values[f.key];
    sureness[f.key] = from.sureness[f.key];
  }
  return { values, sureness, calls: [...jev.calls, ...read.calls], ms: Math.round(performance.now() - started) };
}

// ── Scoring ──────────────────────────────────────────────────────────────────────────────

const words = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
function f1(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return 0;
  const pool = [...y];
  let hit = 0;
  for (const w of x) {
    const i = pool.indexOf(w);
    if (i >= 0) {
      hit++;
      pool.splice(i, 1);
    }
  }
  if (!hit) return 0;
  const p = hit / x.length;
  const r = hit / y.length;
  return (2 * p * r) / (p + r);
}
const site = (s: string) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
const minute = (v: unknown) => String(v).replace(" ", "T").slice(0, 16);

export interface Mark {
  readonly key: string;
  readonly label: string;
  readonly need: Need;
  readonly gold: unknown;
  readonly value: unknown;
  readonly correct: boolean;
  /** Filled although the message does not say. */
  readonly invented: boolean;
  readonly judged?: number;
}

const empty = (v: unknown) => v === null || v === undefined || v === "";

/** Marks each field; text that had to be written is judged by Jev (a fitting value, within length). */
export async function score(c: Case, values: Values): Promise<Mark[]> {
  const fields = fieldsOf(c);
  const toJudge = fields.filter((f) => c.gold[f.key]!.need === "write" && !empty(values[f.key]));
  const judged: Record<string, number> = {};
  if (toJudge.length) {
    const questions: Record<string, Question> = {};
    for (const f of toJudge) {
      questions[f.key] = {
        type: "noul",
        instructions: `Is \`values.${id(f.key)}\` a fitting value for the form field "${f.label}"${f.description ? ` (${f.description})` : ""}, true to \`source\`?`,
        criteria: { yes: "It does what the field asks for, and says nothing `source` does not support.", no: "It does not fit the field, misses the point, or adds things `source` does not say." },
      };
    }
    const call = await systemOne({ source: c.source, values: Object.fromEntries(toJudge.map((f) => [id(f.key), String(values[f.key])])) }, questions);
    for (const f of toJudge) judged[f.key] = (call.answers[f.key] as NoulAnswer).noul;
  }
  return fields.map((f) => {
    const g = c.gold[f.key]!;
    const v = values[f.key];
    let correct: boolean;
    if (g.value === null) correct = empty(v);
    else if (empty(v)) correct = false;
    else if (g.need === "write") correct = (judged[f.key] ?? 0) >= 0.5 && (f.maxLength === undefined || String(v).length <= f.maxLength);
    else if (f.type === "url") correct = [g.value, ...(g.also ?? [])].some((x) => site(String(x)) === site(String(v)));
    else if (f.type === "string") correct = [g.value, ...(g.also ?? [])].some((x) => f1(String(x), String(v)) >= 0.8);
    else if (isNumber(f)) correct = Math.abs(Number(v) - Number(g.value)) < 1e-6;
    else if (f.type === "date") correct = minute(v) === minute(g.value);
    else correct = v === g.value;
    return { key: f.key, label: f.label, need: g.need, gold: g.value, value: v, correct, invented: g.value === null && !empty(v), ...(judged[f.key] !== undefined && { judged: judged[f.key] }) };
  });
}

// ── Running ──────────────────────────────────────────────────────────────────────────────

export const FILLERS = { jev: fillJev, clairic: fillClairic, both: fillBoth } as const;
export type FillerName = keyof typeof FILLERS;

export interface CaseRun {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly filler: string;
  readonly marks: readonly Mark[];
  readonly ms: number;
  readonly tokens: number;
  readonly sureness: Record<string, number | undefined>;
}

export function summarize(runs: readonly CaseRun[]) {
  const marks = runs.flatMap((r) => r.marks);
  const by = (need: Need) => {
    const m = marks.filter((x) => x.need === need);
    return { right: m.filter((x) => x.correct).length, of: m.length };
  };
  return {
    right: marks.filter((m) => m.correct).length,
    of: marks.length,
    invented: marks.filter((m) => m.invented).length,
    needs: { copy: by("copy"), choose: by("choose"), compute: by("compute"), write: by("write"), absent: by("absent") },
    ms: Math.round(runs.reduce((n, r) => n + r.ms, 0) / runs.length),
    tokens: Math.round(runs.reduce((n, r) => n + r.tokens, 0) / runs.length),
  };
}

if (import.meta.main) {
  const out = join(import.meta.dir, "out");
  mkdirSync(out, { recursive: true });
  const runs: CaseRun[] = [];
  for (const c of CASES) {
    for (const [name, fill] of Object.entries(FILLERS)) {
      const filled = await fill(c);
      const marks = await score(c, filled.values);
      runs.push({ id: c.id, title: c.title, source: c.source, filler: name, marks, ms: filled.ms, tokens: filled.calls.reduce((n, x) => n + x.tokens, 0), sureness: filled.sureness });
      const wrong = marks.filter((m) => !m.correct).map((m) => `${m.key}=${JSON.stringify(m.value)}${m.gold !== null ? ` (want ${JSON.stringify(m.gold)})` : " (want empty)"}`);
      console.log(`${c.id.padEnd(9)} ${name.padEnd(8)} ${marks.filter((m) => m.correct).length}/${marks.length}  ${filled.ms} ms  ${wrong.join(" · ")}`);
    }
  }
  console.log("");
  const table: Record<string, ReturnType<typeof summarize>> = {};
  for (const name of Object.keys(FILLERS)) {
    const s = (table[name] = summarize(runs.filter((r) => r.filler === name)));
    const n = (k: keyof typeof s.needs) => `${s.needs[k].right}/${s.needs[k].of}`;
    console.log(`${name.padEnd(8)} ${s.right}/${s.of} right · copy ${n("copy")} · choose ${n("choose")} · compute ${n("compute")} · write ${n("write")} · absent ${n("absent")} · ${s.invented} invented · ${s.ms} ms`);
  }
  writeFileSync(join(out, "fill.json"), JSON.stringify({ runs, summary: table }, null, 2));
}
