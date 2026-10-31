import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * Can Jev and Clairic tell when they are not enough, and hand those fields to a model that
 * writes? Four ways to fill the same forms:
 *
 * - both: Jev and Clairic together (fill.ts), no writer.
 * - jev-routes: Jev is also asked, per field and in the same round trip, whether its value
 *   can be taken from the message, has to be written, or is missing. "Written" goes to the writer.
 * - clairic-unsure: text fields Clairic left empty or answered with confidence below 0.5 go to
 *   the writer, which may still leave them empty.
 * - writer: the writer fills every field, for reference.
 *
 * The writer is Claude Haiku 5.5 when ANTHROPIC_API_KEY is set (in .env.local), else Gemma 4 on
 * Workers AI through `cf`. WRITER=haiku|gemma picks one.
 *
 *   bun experiments/delegate/delegate.ts
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import { CASES, type Case, type Need } from '#experiments/fill/cases.ts';
import { fieldsOf, fillBoth, score, type Field, type Mark, type Values } from '#experiments/fill/fill.ts';
import { systemOne, type ChoiceAnswer, type NoulAnswer, type Question } from '#experiments/jev-specs/generate.ts';
import { parse } from '#src/index.ts';

// ── The writer ───────────────────────────────────────────────────────────────────────────

interface Written {
  readonly values: Values;
  readonly model: string;
  readonly ms: number;
  readonly tokens: number;
}

const INSTRUCTIONS =
  'You fill in form fields from a message someone sent. Use only what the message says or clearly implies. ' +
  'When it gives nothing a field could be filled from, answer null for that field; never make a value up. ' +
  "Follow each field's description, options and length limit. Dates are ISO 8601 (YYYY-MM-DD, or YYYY-MM-DDTHH:mm with a time), worked out from `today`.";

function schemaFor(fields: readonly Field[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    const base =
      f.type === 'enum'
        ? z.enum(f.options!.map((o) => o.value) as [string, ...string[]])
        : f.type === 'boolean'
          ? z.boolean()
          : f.type === 'int'
            ? z.number().int()
            : f.type === 'number'
              ? z.number()
              : z.string();
    shape[f.key] = base.nullable();
  }
  return z.object(shape);
}

const request = (c: Case, fields: readonly Field[]) =>
  JSON.stringify({
    today: c.today,
    message: c.source,
    fields: fields.map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.type === 'date' ? (f.time ? 'date and time' : 'date') : f.type,
      ...(f.description && { description: f.description }),
      ...(f.unit && { unit: f.unit }),
      ...((f.maxLength ?? 0) > 0 && { maxLength: f.maxLength }),
      ...(f.options && { options: f.options }),
    })),
  });

const haiku = (() => {
  let client: Anthropic | undefined;
  return async (c: Case, fields: readonly Field[]): Promise<Written> => {
    // This shell's ANTHROPIC_BASE_URL points at a local proxy; the API is named explicitly.
    client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: 'https://api.anthropic.com' });
    const started = performance.now();
    const response = await client.messages.parse({
      model: 'claude-haiku-5-5',
      max_tokens: 4000,
      system: INSTRUCTIONS,
      messages: [{ role: 'user', content: request(c, fields) }],
      output_config: { effort: 'low', format: zodOutputFormat(schemaFor(fields)) },
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) throw new Error(`Haiku gave no values (${response.stop_reason})`);
    return {
      values: response.parsed_output,
      model: 'claude-haiku-5-5',
      ms: Math.round(performance.now() - started),
      tokens: response.usage.input_tokens + response.usage.output_tokens,
    };
  };
})();

const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
/** Gemma through `cf` now and then runs into the CLI's 30-second limit; it is tried again. */
async function gemma(c: Case, fields: readonly Field[]): Promise<Written> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await gemmaOnce(c, fields);
    } catch (e) {
      if (attempt >= 3 || !String(e).includes('timeout')) throw e;
    }
  }
}

async function gemmaOnce(c: Case, fields: readonly Field[]): Promise<Written> {
  const dir = mkdtempSync(join(tmpdir(), 'writer-'));
  const body = join(dir, 'body.json');
  writeFileSync(
    body,
    JSON.stringify({
      messages: [
        { role: 'system', content: `${INSTRUCTIONS} Reply with JSON only.` },
        { role: 'user', content: request(c, fields) },
      ],
      max_tokens: 2000,
      response_format: { type: 'json_schema', json_schema: { name: 'fields', schema: z.toJSONSchema(schemaFor(fields)) } },
      // With reasoning on, a whole form outlasts `cf`'s 30-second limit; off, it takes ~2.5 s.
      chat_template_kwargs: { enable_thinking: false },
    }),
  );
  const started = performance.now();
  try {
    const cf = process.platform === 'win32' ? 'cf.cmd' : 'cf';
    const proc = Bun.spawn([cf, 'ai', 'run', GEMMA, '--body', `@${body}`], { stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(`cf ai run failed (${code}): ${err.slice(0, 400)}`);
    const res = JSON.parse(out) as { choices: { message: { content: string } }[]; usage: { total_tokens: number } };
    const parsed = schemaFor(fields).safeParse(JSON.parse(res.choices[0].message.content));
    if (!parsed.success) throw new Error(`Gemma's values do not fit: ${parsed.error.message.slice(0, 300)}`);
    return {
      values: parsed.data,
      model: 'gemma-4-26b',
      ms: Math.round(performance.now() - started),
      tokens: res.usage.total_tokens,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WRITER = (process.env.WRITER ?? (process.env.ANTHROPIC_API_KEY ? 'haiku' : 'gemma')) as 'haiku' | 'gemma';
const write = WRITER === 'haiku' ? haiku : gemma;

// ── Jev, routing ─────────────────────────────────────────────────────────────────────────

export type Route = 'taken' | 'written' | 'missing';

export async function route(c: Case): Promise<{ routes: Record<string, Route>; sure: Record<string, number>; ms: number; tokens: number }> {
  const questions: Record<string, Question> = {};
  for (const f of fieldsOf(c)) {
    const limits = [f.description, (f.maxLength ?? 0) > 0 && `at most ${f.maxLength} characters`].filter(Boolean).join(', ');
    questions[f.key] = {
      type: 'choice',
      instructions: `How can the form field "${f.label}"${limits ? ` (${limits})` : ''} be filled from \`source\`?`,
      criteria: {
        taken:
          'From `source` as it stands: the value is written there, follows from it as an option or a yes or no, or is worked out from numbers or dates in it',
        written:
          'It has to be written: composed, summarized or rephrased from what `source` says, because no part of `source` fits the field as it stands',
        missing: '`source` says nothing it could be filled from',
      },
    };
  }
  const call = await systemOne({ source: c.source }, questions);
  const routes: Record<string, Route> = {};
  const sure: Record<string, number> = {};
  for (const [key, a] of Object.entries(call.answers) as [string, ChoiceAnswer][]) {
    routes[key] = a.choice as Route;
    sure[key] = a.probabilities[a.choice]!;
  }
  return { routes, sure, ms: call.ms, tokens: call.tokens };
}

// ── Running ──────────────────────────────────────────────────────────────────────────────

export interface Run {
  readonly way: 'both' | 'jev-routes' | 'clairic-unsure' | 'jev-checks' | 'writer';
  readonly values: Values;
  readonly marks: readonly Mark[];
  /** Fields handed to the writer. */
  readonly delegated: readonly string[];
  /** Written values the spec refused (over a length limit, say); the fill's value was kept. */
  readonly rejected: readonly string[];
  readonly ms: number;
}

/** Whether a value passes the spec's own rules for its field. */
function fits(c: Case, key: string, value: unknown): boolean {
  return !parse(c.spec, { [key]: value }).issues.some((i) => i.path === `/${key}` || i.path.startsWith(`/${key}/`));
}

/** Jev's view, per filled field, of whether the message gives that value. */
export async function verify(c: Case, values: Values): Promise<{ sure: Record<string, number>; ms: number }> {
  const filled = fieldsOf(c).filter((f) => !empty(values[f.key]) && c.gold[f.key].need !== 'write');
  if (filled.length === 0) return { sure: {}, ms: 0 };
  const shown = (f: Field) =>
    f.options
      ? f.options.find((o) => o.value === values[f.key])?.label
      : typeof values[f.key] === 'boolean'
        ? values[f.key]
          ? 'yes'
          : 'no'
        : String(values[f.key]);
  const questions: Record<string, Question> = {};
  for (const f of filled) {
    questions[f.key] = {
      type: 'noul',
      instructions: `Is \`values.${f.key}\` what \`source\` gives for the form field "${f.label}"${f.unit ? ` (in ${f.unit})` : ''}?`,
      criteria: {
        yes: '`source` says this, or it follows directly from what `source` says (`today` anchors relative dates).',
        no: '`source` says something else for this field, or does not say it.',
      },
    };
  }
  const call = await systemOne(
    { source: c.source, today: c.today, values: Object.fromEntries(filled.map((f) => [f.key, shown(f)])) },
    questions,
  );
  return { sure: Object.fromEntries(filled.map((f) => [f.key, (call.answers[f.key] as NoulAnswer).noul])), ms: call.ms };
}

export interface CaseResult {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly needs: Record<string, Need>;
  readonly routes: Record<string, Route>;
  readonly routeSure: Record<string, number>;
  readonly clairicSure: Record<string, number | undefined>;
  readonly checks: Record<string, number>;
  readonly runs: readonly Run[];
}

const isText = (f: Field) => f.type === 'string' || f.type === 'url';
const empty = (v: unknown) => v === null || v === undefined || v === '';

async function runCase(c: Case): Promise<CaseResult> {
  const fields = fieldsOf(c);
  // The fill and Jev's routing go out together; the writer follows only where it is needed.
  const started = performance.now();
  const [base, routed] = await Promise.all([fillBoth(c), route(c)]);
  const firstMs = performance.now() - started;

  const withWriter = async (way: Run['way'], pick: (f: Field) => boolean, extraMs = 0): Promise<Run> => {
    const chosen = fields.filter(pick);
    const values: Values = { ...base.values };
    const rejected: string[] = [];
    let ms = firstMs + extraMs;
    if (chosen.length > 0) {
      const w = await write(c, chosen);
      for (const f of chosen) {
        const v = w.values[f.key] ?? null;
        // The spec has the last word: a written value breaking the field's rules is not taken.
        if (fits(c, f.key, v)) values[f.key] = v;
        else rejected.push(f.key);
      }
      ms += w.ms;
    }
    return { way, values, marks: await score(c, values), delegated: chosen.map((f) => f.key), rejected, ms: Math.round(ms) };
  };

  const both: Run = {
    way: 'both',
    values: base.values,
    marks: await score(c, base.values),
    delegated: [],
    rejected: [],
    ms: Math.round(firstMs),
  };
  const jevRoutes = await withWriter('jev-routes', (f) => routed.routes[f.key] === 'written');
  const clairicUnsure = await withWriter(
    'clairic-unsure',
    (f) => isText(f) && (empty(base.values[f.key]) || (base.sureness[f.key] ?? 0) < 0.5),
  );
  // Verify and escalate: Jev checks the filled values against the message; doubtful ones go to the writer too.
  const checked = await verify(c, base.values);
  const jevChecks = await withWriter(
    'jev-checks',
    (f) => routed.routes[f.key] === 'written' || (checked.sure[f.key] ?? 1) < 0.5,
    checked.ms,
  );
  const all = await write(c, fields);
  const writer: Run = {
    way: 'writer',
    values: all.values,
    marks: await score(c, all.values),
    delegated: fields.map((f) => f.key),
    rejected: [],
    ms: all.ms,
  };

  return {
    id: c.id,
    title: c.title,
    source: c.source,
    needs: Object.fromEntries(fields.map((f) => [f.key, c.gold[f.key].need])),
    routes: routed.routes,
    routeSure: routed.sure,
    clairicSure: base.sureness,
    checks: checked.sure,
    runs: [both, jevRoutes, clairicUnsure, jevChecks, writer],
  };
}

if (import.meta.main) {
  console.log(`writer: ${WRITER === 'haiku' ? 'claude-haiku-5-5' : GEMMA}\n`);
  const results: CaseResult[] = [];
  for (const c of CASES) {
    const r = await runCase(c);
    results.push(r);
    for (const run of r.runs) {
      const wrong = run.marks.filter((m) => !m.correct).map((m) => `${m.key}=${JSON.stringify(m.value)?.slice(0, 60)}`);
      console.log(
        `${c.id.padEnd(9)} ${run.way.padEnd(15)} ${run.marks.filter((m) => m.correct).length}/${run.marks.length}  ${String(run.ms).padStart(5)} ms  → writer: ${run.delegated.join(', ') || '-'}  ${wrong.length > 0 ? `✗ ${wrong.join(' · ')}` : ''}`,
      );
    }
  }

  // How well each signal finds the fields that must be written.
  const all = results.flatMap((r) => Object.keys(r.needs).map((k) => ({ r, k, need: r.needs[k] })));
  const confusion = (says: (r: CaseResult, k: string) => boolean) => ({
    caught: all.filter((x) => x.need === 'write' && says(x.r, x.k)).length,
    of: all.filter((x) => x.need === 'write').length,
    falseAlarms: all.filter((x) => x.need !== 'write' && says(x.r, x.k)).length,
  });
  const jevSignal = confusion((r, k) => r.routes[k] === 'written');
  const clairicSignal = confusion((r, k) => r.runs.find((x) => x.way === 'clairic-unsure')!.delegated.includes(k));
  console.log(
    `\nJev routes "written": caught ${jevSignal.caught}/${jevSignal.of} fields that must be written, ${jevSignal.falseAlarms} false alarms`,
  );
  console.log(`Clairic unsure:       caught ${clairicSignal.caught}/${clairicSignal.of}, ${clairicSignal.falseAlarms} false alarms`);
  const routeRight = all.filter(
    (x) => (x.need === 'write' ? 'written' : x.need === 'absent' ? 'missing' : 'taken') === x.r.routes[x.k],
  ).length;
  console.log(`Jev's three-way routing matches the tags on ${routeRight}/${all.length} fields`);
  // How well Jev's checks find the fill's wrong values (fields to be written aside).
  const checkedFields = results.flatMap((r) =>
    r.runs[0].marks.filter((m) => r.checks[m.key] !== undefined).map((m) => ({ m, p: r.checks[m.key] })),
  );
  const checkSignal = {
    caught: checkedFields.filter((x) => !x.m.correct && x.p < 0.5).length,
    wrong: checkedFields.filter((x) => !x.m.correct).length,
    falseAlarms: checkedFields.filter((x) => x.m.correct && x.p < 0.5).length,
    checked: checkedFields.length,
  };
  console.log(
    `Jev checks:           caught ${checkSignal.caught}/${checkSignal.wrong} wrong values among ${checkSignal.checked} filled, ${checkSignal.falseAlarms} false alarms`,
  );

  console.log('');
  const summary: Record<string, { right: number; of: number; invented: number; delegated: number; rejected: number; ms: number }> = {};
  for (const way of ['both', 'jev-routes', 'clairic-unsure', 'jev-checks', 'writer'] as const) {
    const runs = results.map((r) => r.runs.find((x) => x.way === way)!);
    const marks = runs.flatMap((x) => x.marks);
    const s = (summary[way] = {
      right: marks.filter((m) => m.correct).length,
      of: marks.length,
      invented: marks.filter((m) => m.invented).length,
      delegated: runs.reduce((n, x) => n + x.delegated.length, 0),
      rejected: runs.reduce((n, x) => n + x.rejected.length, 0),
      ms: Math.round(runs.reduce((n, x) => n + x.ms, 0) / runs.length),
    });
    const write = marks.filter((m) => m.need === 'write');
    console.log(
      `${way.padEnd(15)} ${s.right}/${s.of} right · write ${write.filter((m) => m.correct).length}/${write.length} · ${s.invented} invented · ${s.delegated} to the writer, ${s.rejected} refused by the spec · ${s.ms} ms per form`,
    );
  }
  const out = join(import.meta.dir, 'out');
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, `delegate-${WRITER}.json`),
    JSON.stringify(
      {
        writer: WRITER === 'haiku' ? 'claude-haiku-5-5' : GEMMA,
        results,
        summary,
        signals: { jev: jevSignal, clairic: clairicSignal, checks: checkSignal, routeRight, fields: all.length },
      },
      null,
      2,
    ),
  );
}
