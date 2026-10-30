/**
 * Jev and Clairic together. Jev chooses: which phrases are fields, their kinds, what may be
 * blank, catalog fields, and when each is shown. Clairic reads values out of the description:
 * a field's short name, and the ranges, defaults, units, length limits and options it states.
 * Each Clairic request runs alongside a Jev request, so it adds no round trip.
 *
 *   bun experiments/clairic-specs/hybrid.ts     (Jev's key from .env.local; Clairic through `cf`)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CRITERIA, generate, type Built, type Helpers, type Result } from "../jev-specs/generate.ts";
import { clairic, type ClairicAnswer, type ClairicField } from "./clairic.ts";

/** Units Clairic may pick from when the description does not name one. Answers are spans of the input. */
const UNITS = "\n\nUnits: °C, °F, mm, cm, m, km, mm/s, km/h, ms, seconds, minutes, hours, days, weeks, g, kg, px, MB, GB.";
const SECONDS: Record<string, number> = { ms: 0.001, s: 1, sec: 1, second: 1, seconds: 1, min: 60, minute: 60, minutes: 60, h: 3600, hour: 3600, hours: 3600, day: 86400, days: 86400, week: 604800, weeks: 604800 };

/** Taken only when the description states it, and Clairic is fairly sure. */
const sure = (a: ClairicAnswer | undefined) => a !== undefined && a.value !== null && a.value !== undefined && (a.confidence ?? 0) >= 0.5;
/**
 * Numbers need more: asked about many fields at once, Clairic sometimes gives a value the text
 * does not state, with middling confidence. One it reads off the text is near-certain.
 */
const stated = (a: ClairicAnswer | undefined) => sure(a) && (a!.p_null ?? 1) < 0.2 && (a!.confidence ?? 0) >= 0.7;
/** Whether a word or phrase appears whole in the text: spans can split words ("be", "ef"). */
export const whole = (text: string, word: string) => {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(text);
};

const says = (f: Built, word: string) => f.phrase !== undefined && whole(f.phrase, word);
const numeric = (f: Built) => (f.decl.type === "int" || f.decl.type === "number") && f.decl.use === undefined;
const choosing = (f: Built) => f.kind === "one_choice" || f.kind === "many_choices" || f.decl.type === "enum";
const texty = (f: Built) => f.decl.type === "string" || f.decl.use === "multiline";
const valueOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const clairicHelpers: Helpers = {
  async names(_criteria, phrases) {
    // One small request per phrase, with the phrase as the state: asked together, the names of
    // similar phrases blur into one another.
    const name: ClairicField = { type: "text", instructions: "The name of the setting or information asked for, without its limits, options or defaults" };
    const started = performance.now();
    const calls = await Promise.all(phrases.map((p) => clairic(p, { name })));
    // Only a phrase carrying limits, options or defaults needs shortening; others say it best
    // themselves ("compress archives", not "archives").
    const names = calls.map((c, i) => (/[\d(]/.test(phrases[i]!) && sure(c.answers.name) ? String(c.answers.name!.value) : undefined));
    const tokens = calls.reduce((n, c) => n + c.tokens, 0);
    return { names, call: { questions: phrases.length, tokens, ms: performance.now() - started, model: `clairic ×${phrases.length}` } };
  },

  async enrich(criteria, built) {
    const fields: Record<string, ClairicField> = {};
    const about = (f: Built) => `the field "${String(f.decl.label ?? f.key)}" (described as "${f.phrase}")`;
    built.forEach((f, j) => {
      if (f.phrase === undefined) return;
      if (numeric(f)) {
        const integer = f.decl.type === "int";
        fields[`f${j}.min`] = { type: "number", integer, instructions: `The smallest value allowed for ${about(f)}, as stated` };
        fields[`f${j}.max`] = { type: "number", integer, instructions: `The largest value allowed for ${about(f)}, as stated` };
        fields[`f${j}.default`] = { type: "number", instructions: `The default value of ${about(f)}, as stated` };
        // Speculative: a default stated as a length of time ("a week"), read as seconds.
        fields[`f${j}.span`] = { type: "duration", unit: "seconds", instructions: `The default length of time for ${about(f)}, as stated` };
        if (f.decl.unit === undefined) fields[`f${j}.unit`] = { type: "text", instructions: `The unit, from the description or the list of units, that ${about(f)} is measured in` };
      }
      if (choosing(f)) {
        fields[`f${j}.options`] = { type: "list", items: "text", instructions: `The options stated for ${about(f)}, without any default` };
        fields[`f${j}.pick`] = { type: "text", instructions: `The option stated as the default for ${about(f)}` };
      }
      if (texty(f) && !choosing(f)) fields[`f${j}.length`] = { type: "number", integer: true, instructions: `The most characters allowed for ${about(f)}, as stated` };
    });
    if (Object.keys(fields).length === 0) return { applied: [], call: { questions: 0, tokens: 0, ms: 0, model: "clairic" } };

    const call = await clairic(criteria + UNITS, fields);
    const a = (j: number, what: string) => call.answers[`f${j}.${what}`];
    const applied: string[] = [];
    built.forEach((f, j) => {
      const d = f.decl;
      const note = (what: string, value: unknown) => applied.push(`${f.key}.${what} = ${JSON.stringify(value)}`);
      if (numeric(f)) {
        const unit = sure(a(j, "unit")) ? String(a(j, "unit")!.value) : (d.unit as string | undefined);
        if (sure(a(j, "unit"))) note("unit", (d.unit = unit));
        // A limit is taken only if its number is in the text, too.
        const number = (what: string) => (stated(a(j, what)) && whole(criteria, String(a(j, what)!.value)) ? Number(a(j, what)!.value) : undefined);
        const min = number("min");
        const max = number("max");
        if (min !== undefined && max !== undefined && min > max) return applied.push(`${f.key}: dropped min ${min} > max ${max}`);
        if (min !== undefined) note("min", (d.min = min));
        if (max !== undefined) note("max", (d.max = max));
        // A default stated as a time span is converted to the field's unit of time.
        const perUnit = unit === undefined ? undefined : SECONDS[unit.toLowerCase()];
        const fromSpan = perUnit !== undefined && stated(a(j, "span")) ? Number(a(j, "span")!.value) / perUnit : undefined;
        // A default only where the field's own phrase states one: Clairic may otherwise supply one.
        const value = says(f, "default") ? (fromSpan ?? number("default")) : undefined;
        if (value !== undefined && Number.isFinite(value)) {
          const fits = (d.min === undefined || value >= Number(d.min)) && (d.max === undefined || value <= Number(d.max));
          if (fits) note("default", (d.default = d.type === "int" ? Math.round(value) : value));
          else applied.push(`${f.key}: dropped default ${value}, outside its range`);
        }
      }
      if (choosing(f)) {
        const listed = a(j, "options");
        // Spans can carry the words that join a list ("coffee or").
        const trim = (v: string) => v.trim().replace(/^(?:or|and)\s+|\s+(?:or|and)$/gi, "").trim();
        const values = sure(listed) && Array.isArray(listed!.value) ? [...new Set((listed!.value as string[]).map(trim).filter(Boolean))] : [];
        if (values.some((v) => !whole(criteria, v))) applied.push(`${f.key}: dropped options ${JSON.stringify(values)}, not whole words of the text`);
        else if (values.length >= 2) {
          const options = values.map((v) => ({ value: valueOf(v), label: v.charAt(0).toUpperCase() + v.slice(1) }));
          if (f.kind === "many_choices") Object.assign(d, { type: "set", render: "checks", items: { type: "enum", options } });
          else Object.assign(d, { type: "enum", options, ...(options.length <= 3 ? { render: "segmented" } : {}) });
          if (d.type !== "set") delete d.items;
          note("options", values);
        }
        const pick = a(j, "pick");
        const option = says(f, "default") && sure(pick) && d.type === "enum" ? (d.options as { value: string; label: string }[]).find((o) => o.label.toLowerCase() === String(pick!.value).toLowerCase()) : undefined;
        if (option) note("default", (d.default = option.value));
      }
      if (texty(f) && stated(a(j, "length")) && Number(a(j, "length")!.value) > 0) note("maxLength", (d.maxLength = Number(a(j, "length")!.value)));
    });
    return { applied, call: { questions: call.fields, tokens: call.tokens, ms: call.ms, model: "clairic" } };
  },
};

/** Descriptions that state numbers, ranges, defaults and lengths. */
export const NUMERIC = [
  "Worker settings: request timeout between 5 and 300 seconds (default 60), up to 10 retries, a concurrency of 1 to 64 workers, a cache size of at most 8 GB, keep logs for a week by default, and log level (debug, info or warn, default info).",
  "Meeting room booking: number of people from 1 to 12, date, start time, a duration of up to 4 hours (default 1 hour), and catering (none, coffee or lunch; none by default).",
  "Profile page: a display name of at most 40 characters, a bio of up to 280 characters, age (18 or older), and theme (light or dark, default dark).",
];

if (import.meta.main) {
  const out = join(import.meta.dir, "out");
  mkdirSync(out, { recursive: true });
  const all = [...CRITERIA, ...NUMERIC];
  const jev: Result[] = [];
  const hybrid: Result[] = [];
  for (const criteria of all) {
    const [j, h] = [await generate(criteria), await generate(criteria, clairicHelpers)];
    jev.push(j);
    hybrid.push(h);
    console.log(`\n■ ${criteria}`);
    console.log(`  Jev:    ${j.valid ? "valid" : "INVALID"} · ${Object.keys(j.spec.fields).join(", ")} · ${j.wallMs} ms`);
    console.log(`  Hybrid: ${h.valid ? "valid" : "INVALID"} · ${Object.keys(h.spec.fields).join(", ")} · ${h.wallMs} ms`);
    for (const x of h.applied) console.log(`    + ${x}`);
    for (const x of h.faults) console.log(`    ✗ ${x}`);
  }
  writeFileSync(join(out, "jev.json"), JSON.stringify(jev, null, 2));
  writeFileSync(join(out, "results.json"), JSON.stringify(hybrid, null, 2));
}
