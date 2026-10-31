/**
 * Can a small model that writes text write specs that use the newer vocabulary: checks over
 * several fields, `$cel`, derived values, translations and migrations? Each case is a description
 * that calls for one of them, naming the field keys, and a behaviour test over sample values.
 *
 * The model gets `prompt(registry)` as its system prompt and the description, and replies with
 * a spec as JSON. A reply the checker rejects is sent back once with the checker's faults, as an
 * application would. Each attempt is scored on three things: it parses as JSON, the checker
 * accepts it, and it behaves (the test passes). Behaviour is never shown to the model.
 *
 * The writer is Gemma 4 on Workers AI through `cf` (its sign-in). RUNS=n runs each case n times,
 * OUT=name.json names the file in out/ (default results.json), and `--rescore <file>` scores a
 * recorded run again. out/ keeps three rounds: the first, then one after each change to the
 * prompt and the checker that the failures before it called for.
 *
 *   bun --conditions=fieldspec@dev experiments/writer-specs/write.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCel } from '#src/cel.ts';
import { checkSpec, createRegistry, formatFaults, localize, parse, prompt, type Issue, type Spec } from '#src/index.ts';

const registry = createRegistry({ languages: [createCel()] });
const MODEL = '@cf/google/gemma-4-26b-a4b-it';
const RUNS = Number(process.env.RUNS ?? 2);

// ── Cases ────────────────────────────────────────────────────────────────────────────────

export interface Case {
  readonly id: string;
  /** What the description calls for. */
  readonly construct: 'checks' | 'value' | 'locales' | 'migrations' | 'condition';
  readonly text: string;
  /** What is wrong with how the spec behaves; empty when it is right. */
  readonly test: (spec: Spec) => string[];
}

const run = (spec: Spec, values: unknown) => parse(spec, values);
const at = (value: unknown, pointer: string): unknown =>
  pointer
    .split('/')
    .slice(1)
    .reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), value);
const issuesAt = (issues: readonly Issue[], path: string) => issues.filter((i) => i.path === path);

/** An issue at `path` for these values. */
const flags = (spec: Spec, values: unknown, path: string) =>
  issuesAt(run(spec, values).issues, path).length > 0 ? [] : [`no issue at ${path} for ${JSON.stringify(values)}`];
/** No issue at `path` for these values. */
const passes = (spec: Spec, values: unknown, path: string) => {
  const found = issuesAt(run(spec, values).issues, path);
  return found.length === 0 ? [] : [`${path} has "${found[0].message}" for ${JSON.stringify(values)}`];
};
/** The value at `path` comes out as `expected`. */
const gives = (spec: Spec, values: unknown, path: string, expected: unknown) => {
  const got = at(run(spec, values).value, path);
  const same = typeof expected === 'number' && typeof got === 'number' ? Math.abs(got - expected) < 1e-9 : got === expected;
  return same ? [] : [`${path} is ${JSON.stringify(got)} for ${JSON.stringify(values)}, not ${JSON.stringify(expected)}`];
};

export const CASES: readonly Case[] = [
  {
    id: 'stay',
    construct: 'checks',
    text: 'A hotel stay: `checkIn` and `checkOut`, both dates. Check-out must be after check-in; otherwise say "Check-out is before check-in".',
    test: (s) => [
      ...flags(s, { checkIn: '2026-03-08', checkOut: '2026-03-01' }, '/checkOut'),
      ...passes(s, { checkIn: '2026-03-01', checkOut: '2026-03-08' }, '/checkOut'),
    ],
  },
  {
    id: 'signup',
    construct: 'checks',
    text: 'A sign-up form: `email`, `password` (at least 8 characters) and `confirm`, which must be the same as the password.',
    test: (s) => [
      ...flags(s, { email: 'a@b.co', password: 'secret123', confirm: 'secret124' }, '/confirm'),
      ...passes(s, { email: 'a@b.co', password: 'secret123', confirm: 'secret123' }, '/confirm'),
    ],
  },
  {
    id: 'seats',
    construct: 'checks',
    text: 'A team plan: `seats`, a whole number from 1 to 100, and `admins`, a whole number. At most half of the seats may be admins.',
    test: (s) => [...flags(s, { seats: 10, admins: 6 }, '/admins'), ...passes(s, { seats: 10, admins: 5 }, '/admins')],
  },
  {
    id: 'line',
    construct: 'value',
    text: 'An order line: `price` (a number), `quantity` (a whole number, at least 1) and `total`, which is always the price times the quantity and is not edited by hand.',
    test: (s) => gives(s, { price: 2.5, quantity: 4, total: 1 }, '/total', 10),
  },
  {
    id: 'slug',
    construct: 'value',
    text: 'A blog post: `title` and `slug`. The slug is always the title in lower case, with each space replaced by a hyphen.',
    test: (s) => gives(s, { title: 'Hello Big World' }, '/slug', 'hello-big-world'),
  },
  {
    id: 'nights',
    construct: 'value',
    text: 'A booking: `arrive` and `leave`, both dates, and `nights`, a whole number that is always the number of nights between them.',
    test: (s) => gives(s, { arrive: '2026-05-01', leave: '2026-05-04' }, '/nights', 3),
  },
  {
    id: 'shipping',
    construct: 'value',
    text: 'A checkout: `subtotal` (a number), `express` (yes or no) and `shipping`, a number that is always 0 when the subtotal is 50 or more, and otherwise 9.95, or 19.95 with express.',
    test: (s) => [
      ...gives(s, { subtotal: 60, express: true }, '/shipping', 0),
      ...gives(s, { subtotal: 20, express: false }, '/shipping', 9.95),
      ...gives(s, { subtotal: 20, express: true }, '/shipping', 19.95),
    ],
  },
  {
    id: 'vat',
    construct: 'condition',
    text: 'An invoice address: `company` (optional text), `country`, one of `nl`, `de` and `us` (shown as Netherlands, Germany and United States), and `vatNumber`, which is required for nl and de and not shown for us.',
    test: (s) => [...flags(s, { country: 'de' }, '/vatNumber'), ...passes(s, { country: 'us' }, '/vatNumber')],
  },
  {
    id: 'german',
    construct: 'locales',
    text: 'A contact form with `name`, `email` and `message` (long text), whose labels are written in English, with a German translation of each.',
    // A translation may read as the English does ("Name"): it must be there, and be what the form shows.
    test: (s) => {
      const de = localize(s, 'de');
      return ['name', 'email', 'message'].flatMap((key) => {
        const given = s.locales?.de?.[`/fields/${key}/label`];
        return typeof given === 'string' && de.fields[key]?.label === given ? [] : [`${key}'s label has no German translation`];
      });
    },
  },
  {
    id: 'timeout',
    construct: 'migrations',
    text: 'Settings for a job runner, version 2: `timeoutMs`, a whole number of milliseconds (default 1000), and `retries`, a whole number (default 3). Version 1 stored the timeout as `timeout`, in seconds. Values stored by version 1 say `"$version": 1` and must still load, with the timeout converted.',
    test: (s) => {
      const out = run(s, { $version: 1, timeout: 5, retries: 2 }).value;
      return [
        ...gives(s, { $version: 1, timeout: 5, retries: 2 }, '/timeoutMs', 5000),
        ...gives(s, { $version: 1, timeout: 5, retries: 2 }, '/retries', 2),
        ...(out && typeof out === 'object' && 'timeout' in out ? ['the old `timeout` is still there'] : []),
      ];
    },
  },
];

// ── The writer ───────────────────────────────────────────────────────────────────────────

const SYSTEM = `${prompt(registry)}\n\nReply with the spec as JSON only: no prose, no code fences.`;

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

async function write(messages: readonly Message[]): Promise<{ text: string; ms: number; tokens: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'writer-'));
  const body = join(dir, 'body.json');
  writeFileSync(body, JSON.stringify({ messages, max_tokens: 4000, chat_template_kwargs: { enable_thinking: false } }));
  const started = performance.now();
  try {
    for (let attempt = 1; ; attempt++) {
      const cf = process.platform === 'win32' ? 'cf.cmd' : 'cf';
      const proc = Bun.spawn([cf, 'ai', 'run', MODEL, '--body', `@${body}`], { stdout: 'pipe', stderr: 'pipe' });
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (code !== 0) {
        if (attempt < 3) continue;
        throw new Error(`cf ai run failed (${code}): ${err.slice(0, 300)}`);
      }
      const res = JSON.parse(out) as { choices: { message: { content: string } }[]; usage: { total_tokens: number } };
      return { text: res.choices[0].message.content, ms: Math.round(performance.now() - started), tokens: res.usage.total_tokens };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The JSON object in a reply, fences and prose around it ignored. */
function specOf(text: string): Spec | string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return 'no JSON object in the reply';
  try {
    return JSON.parse(text.slice(start, end + 1)) as Spec;
  } catch (error) {
    return `not JSON: ${(error as Error).message}`;
  }
}

// ── Scoring ──────────────────────────────────────────────────────────────────────────────

interface Attempt {
  readonly json: boolean;
  readonly valid: boolean;
  readonly behaves: boolean;
  readonly faults: string[];
  readonly wrong: string[];
  /** Which of the newer constructs the spec uses. */
  readonly uses: string[];
  readonly spec?: Spec;
  readonly ms: number;
  readonly tokens: number;
}

function usesOf(spec: Spec): string[] {
  const text = JSON.stringify(spec);
  // A field's `value`, not an option's.
  const derived = (node: unknown, key?: string): boolean =>
    key !== 'options' &&
    !!node &&
    typeof node === 'object' &&
    ((!Array.isArray(node) && 'value' in node && ('type' in node || 'use' in node)) ||
      Object.entries(node).some(([k, v]) => derived(v, Array.isArray(node) ? key : k)));
  const used: [string, boolean][] = [
    ['checks', text.includes('"checks"')],
    ['$cel', text.includes('"$cel"')],
    ['value', derived(spec.fields)],
    ['locales', text.includes('"locales"')],
    ['migrations', text.includes('"migrations"')],
  ];
  return used.filter(([, is]) => is).map(([name]) => name);
}

function score(c: Case, reply: { text: string; ms: number; tokens: number }): Attempt {
  const base = { ms: reply.ms, tokens: reply.tokens };
  const spec = specOf(reply.text);
  if (typeof spec === 'string') return { ...base, json: false, valid: false, behaves: false, faults: [spec], wrong: [], uses: [] };
  const defined = registry.define(structuredClone(spec));
  let faults: string[];
  try {
    faults = formatFaults(checkSpec(defined).filter((f) => f.severity === 'error'));
  } catch (error) {
    faults = [`checkSpec threw: ${(error as Error).message}`];
  }
  let wrong: string[];
  try {
    wrong = c.test(defined);
  } catch (error) {
    wrong = [`threw: ${(error as Error).message}`];
  }
  return { ...base, json: true, valid: faults.length === 0, behaves: wrong.length === 0, faults, wrong, uses: usesOf(spec), spec };
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────

interface Result {
  readonly id: string;
  readonly construct: Case['construct'];
  readonly run: number;
  readonly first: Attempt;
  /** After sending the checker's faults back, when there were any. */
  readonly repaired?: Attempt;
}

if (import.meta.main) await (process.argv[2] === '--rescore' ? rescore(process.argv[3]) : main());

async function main() {
  const results: Result[] = [];
  const only = process.argv[2];
  console.log(`writer: ${MODEL}, ${RUNS} run(s) per case\n`);
  for (const c of CASES) {
    if (only && c.id !== only) continue;
    for (let n = 1; n <= RUNS; n++) {
      const messages: Message[] = [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: c.text },
      ];
      const reply = await write(messages);
      const first = score(c, reply);
      let repaired: Attempt | undefined;
      if (!first.valid) {
        const again = await write([
          ...messages,
          { role: 'assistant', content: reply.text },
          { role: 'user', content: `checkSpec reports:\n${first.faults.join('\n')}\nReply with the fixed spec as JSON only.` },
        ]);
        repaired = score(c, again);
      }
      results.push({ id: c.id, construct: c.construct, run: n, first, ...(repaired && { repaired }) });
      const final = repaired ?? first;
      const mark = (a: Attempt) => `${a.json ? 'json' : '----'} ${a.valid ? 'valid' : '-----'} ${a.behaves ? 'behaves' : '-------'}`;
      console.log(
        `${c.id.padEnd(9)} #${n}  ${mark(first)}${repaired ? `  → ${mark(repaired)}` : ''}  uses ${final.uses.join(', ') || 'none'}`,
      );
      for (const line of [...final.faults, ...final.wrong].slice(0, 3)) console.log(`            ${line.trim().slice(0, 160)}`);
    }
  }

  const out = join(import.meta.dir, 'out');
  mkdirSync(out, { recursive: true });
  save(join(out, process.env.OUT ?? 'results.json'), results);
}

/** Scores a recorded run again from the specs it kept, as when the tests change. */
async function rescore(file: string) {
  const recorded = JSON.parse(await Bun.file(file).text()) as { results: Result[] };
  const again = (c: Case, a: Attempt): Attempt => (a.spec ? score(c, { text: JSON.stringify(a.spec), ms: a.ms, tokens: a.tokens }) : a);
  const results = recorded.results.map((r) => {
    const c = CASES.find((x) => x.id === r.id)!;
    return { ...r, first: again(c, r.first), ...(r.repaired && { repaired: again(c, r.repaired) }) };
  });
  save(file, results);
}

function save(file: string, results: readonly Result[]) {
  const count = (pick: (r: Result) => boolean) => results.filter(pick).length;
  const summary = {
    model: MODEL,
    runs: results.length,
    first: {
      json: count((r) => r.first.json),
      valid: count((r) => r.first.valid),
      behaves: count((r) => r.first.behaves),
    },
    final: {
      json: count((r) => (r.repaired ?? r.first).json),
      valid: count((r) => (r.repaired ?? r.first).valid),
      behaves: count((r) => (r.repaired ?? r.first).behaves),
    },
    byConstruct: Object.fromEntries(
      [...new Set(results.map((r) => r.construct))].map((k) => {
        const of = results.filter((r) => r.construct === k);
        return [k, { runs: of.length, behaves: of.filter((r) => (r.repaired ?? r.first).behaves).length }];
      }),
    ),
  };
  console.log(`\n${JSON.stringify(summary, null, 2)}`);
  writeFileSync(file, `${JSON.stringify({ summary, results }, null, 2)}\n`);
}
