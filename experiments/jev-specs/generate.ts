/**
 * Generating fieldspec specs from a plain description with Jev, TypeSafe's System One model.
 *
 * Jev does not write text; it chooses. So code proposes and Jev picks:
 * 1. Code splits the description into phrases ("work email", "meal choice (beef, fish…)").
 * 2. One request asks, for every phrase, whether it is a field, which kind, whether it may be
 *    left blank, which catalog field it is if any, and which known option list fits; and, for
 *    every catalog field, whether a form like this would ask for it (for vague descriptions).
 * 3. A second request, once the fields are known, asks when each is shown.
 * 4. Code assembles the spec and fieldspec's checker validates it.
 *
 *   bun experiments/jev-specs/generate.ts            (the key is read from .env.local)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSpec, createForm, SCHEMA_URL, type FieldDecl, type Spec } from '#src/index.ts';
import { CATALOG, SECTIONS } from './catalog.ts';

// ── TypeSafe ─────────────────────────────────────────────────────────────────────────────

const MODEL = 'jev-latest';
/** How likely a vague form is to ask for a catalog field before it is taken. */
const PICK = 0.7;
/** How likely a condition must be before a field is hidden by it. */
const SHOWN_WHEN = 0.5;

export type Question = { type: 'noul' | 'choice'; instructions: unknown; criteria?: unknown };
export interface NoulAnswer {
  type: 'noul';
  noul: number;
}
export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export type Answer = NoulAnswer | ChoiceAnswer;
export interface Call {
  answers: Record<string, Answer>;
  model: string;
  tokens: number;
  ms: number;
  questions: number;
}

export async function systemOne(state: unknown, questions: Record<string, Question>): Promise<Call> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error('TYPESAFE_API_KEY is not set (put it in .env.local)');
  const start = performance.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions }),
    });
    if (res.status === 429 && attempt < 4) {
      await Bun.sleep(Number(res.headers.get('retry-after') ?? 1) * 1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`TypeSafe ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const body = (await res.json()) as { answers: Record<string, Answer>; model: string; usage: { input_tokens: number } };
    return {
      answers: body.answers,
      model: body.model,
      tokens: body.usage.input_tokens,
      ms: performance.now() - start,
      questions: Object.keys(questions).length,
    };
  }
}

const noul = (call: Call, id: string) => (call.answers[id] as NoulAnswer).noul;
const choice = (call: Call, id: string) => call.answers[id] as ChoiceAnswer;

// ── What Jev chooses from ────────────────────────────────────────────────────────────────

/** Field kinds, described for Jev, and the declaration each one starts from. */
const KINDS: Record<string, { describe: string; decl: Record<string, unknown> }> = {
  text: { describe: 'Short text on one line, such as a name, a title or a code', decl: { type: 'string' } },
  long_text: { describe: 'Text over several lines, such as a description, a message, notes or a request', decl: { use: 'multiline' } },
  email: { describe: 'An email address', decl: { use: 'email' } },
  password: { describe: 'A secret typed hidden, such as a password', decl: { use: 'password' } },
  web_address: { describe: 'A web address (URL)', decl: { type: 'url', protocols: ['https:', 'http:'] } },
  phone: { describe: 'A phone number', decl: { type: 'string', placeholder: '+31 6 1234 5678' } },
  whole_number: {
    describe: 'A count or other whole number, such as a quantity, a number of days or of people',
    decl: { type: 'int', min: 0 },
  },
  measurement: {
    describe: 'A measured amount that can have a fraction, such as a temperature, a length, a weight, a speed or a price',
    decl: { type: 'number' },
  },
  percentage: { describe: 'A percentage, or a share between none and all', decl: { use: 'percent' } },
  yes_no: { describe: 'A yes-or-no answer, an on/off setting, or a single checkbox', decl: { type: 'boolean', render: 'switch' } },
  one_choice: { describe: 'Exactly one choice out of a fixed list of options', decl: { type: 'enum' } },
  many_choices: { describe: 'Any number of choices out of a fixed list of options', decl: { type: 'set', render: 'checks' } },
  date: { describe: 'A calendar date', decl: { type: 'date' } },
  date_time: { describe: 'A date together with a time of day', decl: { type: 'date', time: true } },
  color: { describe: 'A colour', decl: { use: 'color' } },
  file: { describe: 'A file or picture to upload', decl: { type: 'bytes' } },
};

/** Option lists for a choice whose options the description does not give. */
const OPTION_SETS: Record<string, readonly string[]> = {
  frequency: ['Hourly', 'Daily', 'Weekly', 'Monthly'],
  priority: ['Low', 'Medium', 'High', 'Urgent'],
  size: ['Small', 'Medium', 'Large'],
  skill: ['Beginner', 'Intermediate', 'Advanced'],
  attendance: ['Yes', 'No', 'Maybe'],
  meal: ['Meat', 'Fish', 'Vegetarian', 'Vegan'],
  contact: ['Email', 'Phone', 'Text message'],
  appearance: ['Light', 'Dark', 'System'],
  quality: ['Poor', 'Fair', 'Good', 'Excellent'],
  delivery: ['Ship', 'Pick up'],
  weekday: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
const describeSet = (values: readonly string[]) => `The options ${values.join(', ')}`;

// ── Phrases ──────────────────────────────────────────────────────────────────────────────

interface Phrase {
  readonly text: string;
  /** For a label and key: no parentheses, articles or "optional". */
  readonly name: string;
  /** Options listed in parentheses, if any. */
  readonly options?: readonly string[];
}

const FILLER = /^(?:and|or|plus|with|including|also|then|a|an|the|optional(?:ly)?|some|their|your|his|her)\s+/i;

function phrasesOf(criteria: string): Phrase[] {
  // Split at commas, semicolons, colons, line breaks and " and ", but not inside parentheses.
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < criteria.length; i++) {
    const c = criteria[i];
    if (c === '(') depth++;
    if (c === ')') depth = Math.max(0, depth - 1);
    // " and " between two numbers ("between 5 and 300") joins a range, not two phrases.
    const and =
      depth === 0 && /^\sand\s/i.test(criteria.slice(i, i + 5)) && !(/\d\s*$/.test(current) && /^\s*\d/.test(criteria.slice(i + 5)));
    if (depth === 0 && (/[,;:\n•]/.test(c) || and)) {
      parts.push(current);
      current = '';
      if (and) i += 4;
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts
    .map((p) => p.trim().replace(/\.$/, ''))
    .filter((p) => p.length > 0)
    .map((text) => {
      // "(debug, info or warn, default info)": the default is not an option.
      const listed = /\(([^)]*)\)/.exec(text)?.[1]?.replace(/[;,]?\s*(?:\w+\s+)?(?:by\s+)?default\b.*$/i, '');
      let name = text.replace(/\([^)]*\)/g, '').trim();
      for (let prev = ''; prev !== name;) [prev, name] = [name, name.replace(FILLER, '')];
      const options = listed
        ?.split(/,|\bor\b|\band\b/)
        .map((o) => o.trim())
        .filter(Boolean);
      return { text, name: name.charAt(0).toUpperCase() + name.slice(1), ...(options && options.length > 1 && { options }) };
    });
}

const keyOf = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('') || 'field';

const valueOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ── Step 1: what the fields are ──────────────────────────────────────────────────────────

function firstQuestions(phrases: readonly Phrase[]): Record<string, Question> {
  const q: Record<string, Question> = {
    explicit: {
      type: 'noul',
      instructions:
        'Does `criteria` list the specific pieces of information the form asks for, rather than only saying what kind of form it is?',
    },
  };
  const catalog = Object.fromEntries([
    ...CATALOG.map((e) => [e.key, `A field for ${e.asks}`]),
    ['none', 'None of these: it asks for something else'],
  ]);
  phrases.forEach((_, i) => {
    const at = `\`phrases[${i}]\``;
    q[`field_${i}`] = {
      type: 'noul',
      // Not "what the person fills in": read literally, a setting does not feel filled in.
      instructions: `Does ${at} name something that gets a value in the form or settings described by \`criteria\`, rather than naming the form itself or its purpose?`,
      criteria: {
        yes: 'It names something the person answers, types, chooses or sets, even when it also states limits, options or a default.',
        no: 'It names the form itself, its purpose or its audience.',
      },
    };
    q[`kind_${i}`] = {
      type: 'choice',
      instructions: `What kind of answer does the person give for ${at}, in the form described by \`criteria\`?`,
      criteria: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.describe])),
    };
    q[`optional_${i}`] = {
      type: 'noul',
      instructions: `In the form described by \`criteria\`, may the person leave ${at} blank?`,
      criteria: {
        yes: '`criteria` calls it optional, or it is a nice-to-have the form works without, such as notes or comments.',
        no: 'The form cannot do its job without it.',
      },
    };
    q[`match_${i}`] = { type: 'choice', instructions: `Which of these fields asks for exactly what ${at} asks for?`, criteria: catalog };
    q[`options_${i}`] = {
      type: 'choice',
      instructions: `If ${at} is a choice from a list, which list of options fits it?`,
      criteria: {
        ...Object.fromEntries(Object.entries(OPTION_SETS).map(([k, v]) => [k, describeSet(v)])),
        none: 'None of these lists fits',
      },
    };
  });
  for (const e of CATALOG) {
    q[`pick_${e.key}`] = {
      type: 'noul',
      instructions: `Would the form described by \`criteria\` ask for ${e.asks}?`,
      criteria: {
        yes: '`criteria` names it, or a form of that kind almost always asks for it.',
        no: 'It is unrelated to that form, or only sometimes asked.',
      },
    };
    q[`blank_${e.key}`] = {
      type: 'noul',
      instructions: `In the form described by \`criteria\`, may the person leave ${e.asks} blank?`,
      criteria: { yes: 'It is optional or a nice-to-have.', no: 'The form cannot do its job without it.' },
    };
  }
  return q;
}

export interface Built {
  readonly key: string;
  readonly decl: Record<string, unknown>;
  readonly source: string;
  readonly section?: string;
  /** The kind Jev chose, for a field built from a phrase rather than taken from the catalog. */
  readonly kind?: string;
  /** Whether its options were read from parentheses in the description. */
  readonly listed?: boolean;
  /** The phrase it came from. */
  readonly phrase?: string;
}

/** A built field's label, or its key when it has none. */
export const labelOf = (f: Built) => (typeof f.decl.label === 'string' ? f.decl.label : f.key);

/** A request to another model, as the results record it. */
export interface CallInfo {
  readonly questions: number;
  readonly tokens: number;
  readonly ms: number;
  readonly model: string;
}

/** What another model adds, asked alongside Jev's requests so it costs no extra round trip. */
export interface Helpers {
  /** Short names for the phrases ("Request timeout" for "request timeout between 5 and 300 seconds"). */
  names?(criteria: string, phrases: readonly string[]): Promise<{ names: readonly (string | undefined)[]; call: CallInfo }>;
  /** Fills in the fields' declarations (ranges, defaults, units, options) once they are known. */
  enrich?(criteria: string, fields: readonly Built[]): Promise<{ applied: readonly string[]; call: CallInfo }>;
}

/** Leaves the required flag to kinds where "empty" means something. */
const fillable = (decl: Record<string, unknown>) =>
  ['string', 'url', 'date', 'bytes', 'set'].includes(String(decl.type)) || ['email', 'password', 'multiline'].includes(String(decl.use));

function assemble(phrases: readonly Phrase[], call: Call): { fields: Built[]; explicit: boolean; notes: string[] } {
  const notes: string[] = [];
  const explicit = noul(call, 'explicit') >= 0.5;
  const fields: Built[] = [];
  const taken = new Set<string>();
  const add = (b: Built) => {
    let key = b.key;
    for (let n = 2; taken.has(key); n++) key = `${b.key}${n}`;
    taken.add(key);
    fields.push({ ...b, key });
  };

  phrases.forEach((p, i) => {
    if (noul(call, `field_${i}`) < 0.5) return;
    const blank = noul(call, `optional_${i}`) >= 0.5;
    const match = choice(call, `match_${i}`);
    const entry =
      match.choice !== 'none' && (match.probabilities[match.choice] ?? 0) >= 0.5 ? CATALOG.find((e) => e.key === match.choice) : undefined;
    if (entry && !taken.has(entry.key)) {
      // The catalog's declaration, under the description's own words.
      const decl: Record<string, unknown> = { ...(entry.decl as Record<string, unknown>), label: p.name };
      if (!blank && fillable(decl)) decl.required = true;
      add({ key: entry.key, decl, source: `"${p.text}" → catalog ${entry.key}`, section: entry.section, phrase: p.text });
      return;
    }
    const kind = choice(call, `kind_${i}`).choice;
    const decl: Record<string, unknown> = { ...KINDS[kind].decl, label: p.name };
    let source = `"${p.text}" → ${kind}`;
    if (kind === 'one_choice' || kind === 'many_choices') {
      const set = choice(call, `options_${i}`);
      const listed = p.options ?? (set.choice !== 'none' ? OPTION_SETS[set.choice] : undefined);
      if (!listed) {
        notes.push(`"${p.text}": a choice, but no options were listed and no known list fits; drawn as text instead.`);
        Object.assign(decl, { type: 'string' });
        delete decl.render;
      } else {
        const options = listed.map((o) => ({ value: valueOf(o), label: o.charAt(0).toUpperCase() + o.slice(1) }));
        if (kind === 'one_choice') Object.assign(decl, { options, ...(options.length <= 3 && { render: 'segmented' }) });
        else Object.assign(decl, { items: { type: 'enum', options } });
        source += p.options ? ' (options from the text)' : ` (options: ${set.choice})`;
      }
    }
    if (!blank && fillable(decl)) decl.required = true;
    add({ key: keyOf(p.name), decl, source, kind, listed: !!p.options, phrase: p.text });
  });

  // A vague description names no fields: take what a form of that kind would ask for, and of
  // fields asking for nearly the same thing, only the likeliest.
  if (!explicit) {
    const best = new Map<string, number>();
    for (const e of CATALOG) if (e.slot) best.set(e.slot, Math.max(best.get(e.slot) ?? 0, noul(call, `pick_${e.key}`)));
    for (const e of CATALOG) {
      const p = noul(call, `pick_${e.key}`);
      if (
        taken.has(e.key) ||
        p < PICK ||
        (e.slot && (p < best.get(e.slot)! || fields.some((f) => CATALOG.find((c) => c.key === f.key)?.slot === e.slot)))
      )
        continue;
      const decl: Record<string, unknown> = { ...(e.decl as Record<string, unknown>) };
      if (noul(call, `blank_${e.key}`) < 0.5 && fillable(decl)) decl.required = true;
      add({ key: e.key, decl, source: `catalog ${e.key} (${p.toFixed(2)})`, section: e.section });
    }
    if (fields.length === 0) notes.push('Nothing in the description or the catalog fits.');
  }
  return { fields, explicit, notes };
}

// ── Step 2: when each field is shown ─────────────────────────────────────────────────────

interface Trigger {
  readonly id: string;
  readonly describe: string;
  readonly visible: unknown;
}

function triggersFor(fields: readonly Built[], self: string): Trigger[] {
  const out: Trigger[] = [];
  for (const f of fields) {
    if (f.key === self) continue;
    const label = labelOf(f);
    if (f.decl.type === 'boolean')
      out.push({ id: `${f.key}=yes`, describe: `Only asked when "${label}" is answered yes`, visible: { $state: f.key, eq: true } });
    if (f.decl.type === 'enum') {
      for (const o of f.decl.options as { value: string; label: string }[]) {
        out.push({
          id: `${f.key}=${o.value}`,
          describe: `Only asked when "${label}" is "${o.label}"`,
          visible: { $state: f.key, eq: o.value },
        });
      }
    }
  }
  return out;
}

async function conditions(criteria: string, fields: Built[]): Promise<{ call?: Call; chosen: Record<string, string> }> {
  const state = { criteria, fields: fields.map((f) => ({ name: labelOf(f) })) };
  const questions: Record<string, Question> = {};
  // Worked out once: a helper may change options while the request is out.
  const asked = fields.map((f) => triggersFor(fields, f.key));
  fields.forEach((f, j) => {
    const triggers = asked[j];
    if (triggers.length === 0) return;
    questions[`when_${j}`] = {
      type: 'choice',
      instructions: `In the form described by \`criteria\`, when is \`fields[${j}].name\` asked?`,
      criteria: { always: 'Asked of everyone filling in the form', ...Object.fromEntries(triggers.map((t) => [t.id, t.describe])) },
    };
  });
  if (Object.keys(questions).length === 0) return { chosen: {} };
  const call = await systemOne(state, questions);
  const chosen: Record<string, string> = {};
  fields.forEach((f, j) => {
    const a = call.answers[`when_${j}`] as ChoiceAnswer | undefined;
    if (!a || a.choice === 'always' || a.probabilities[a.choice] < SHOWN_WHEN) return;
    const trigger = asked[j].find((t) => t.id === a.choice)!;
    f.decl.visible = trigger.visible;
    chosen[f.key] = `${a.choice} (${a.probabilities[a.choice].toFixed(2)})`;
  });
  return { call, chosen };
}

// ── Putting it together ──────────────────────────────────────────────────────────────────

export interface Result {
  readonly criteria: string;
  readonly spec: Spec;
  readonly explicit: boolean;
  readonly phrases: readonly { text: string; field: number; kind: string; kindConfidence: number; blank: number; match: string }[];
  readonly picks: readonly { key: string; p: number }[];
  readonly sources: readonly string[];
  readonly shownWhen: Record<string, string>;
  readonly notes: readonly string[];
  readonly faults: readonly string[];
  readonly valid: boolean;
  readonly calls: readonly CallInfo[];
  /** What the helpers changed. */
  readonly applied: readonly string[];
  /** Start to finish, with parallel requests overlapping. */
  readonly wallMs: number;
}

export async function generate(criteria: string, helpers: Helpers = {}): Promise<Result> {
  const started = performance.now();
  const raw = phrasesOf(criteria);
  const [first, named] = await Promise.all([
    systemOne({ criteria, phrases: raw.map((p) => p.text) }, firstQuestions(raw)),
    helpers.names?.(
      criteria,
      raw.map((p) => p.text),
    ),
  ]);
  const phrases = raw.map((p, i) => {
    const name = named?.names[i];
    return name ? { ...p, name: name.charAt(0).toUpperCase() + name.slice(1) } : p;
  });
  const { fields, explicit, notes } = assemble(phrases, first);
  const [{ call: second, chosen }, enriched] = await Promise.all([conditions(criteria, fields), helpers.enrich?.(criteria, fields)]);
  // A helper may have replaced the options a condition names; such a condition is dropped.
  for (const f of fields) {
    const when = f.decl.visible as { $state?: string; eq?: unknown } | undefined;
    const on = when?.$state === undefined ? undefined : fields.find((t) => t.key === when.$state);
    if (on?.decl.type === 'enum' && !(on.decl.options as { value: unknown }[]).some((o) => o.value === when!.eq)) {
      delete f.decl.visible;
      delete chosen[f.key];
    }
  }

  // A vague form drawn from several catalog sections is grouped by them.
  const sections = new Set(fields.map((f) => f.section).filter(Boolean));
  const grouped = !explicit && sections.size > 1 && fields.length >= 5;
  const title = phrases.find((_, i) => noul(first, `field_${i}`) < 0.5)?.name ?? criteria.split(/[:.]/)[0];
  const spec = {
    $schema: SCHEMA_URL,
    title,
    fields: Object.fromEntries(fields.map((f) => [f.key, { ...f.decl, ...(grouped && f.section && { group: f.section }) }])) as Record<
      string,
      FieldDecl
    >,
    ...(grouped && { groups: Object.fromEntries([...sections].map((s) => [s!, { label: SECTIONS[s!] }])) }),
  } as Spec;

  const faults = checkSpec(spec).map((f) => `${f.severity} ${f.path}: ${f.message}`);
  let valid = !faults.some((f) => f.startsWith('error'));
  try {
    createForm(spec);
  } catch (e) {
    faults.push(`createForm: ${(e as Error).message}`);
    valid = false;
  }
  return {
    criteria,
    spec,
    explicit,
    phrases: phrases.map((p, i) => ({
      text: p.text,
      field: noul(first, `field_${i}`),
      kind: choice(first, `kind_${i}`).choice,
      kindConfidence: choice(first, `kind_${i}`).confidence,
      blank: noul(first, `optional_${i}`),
      match: `${choice(first, `match_${i}`).choice} (${(choice(first, `match_${i}`).probabilities[choice(first, `match_${i}`).choice] ?? 0).toFixed(2)})`,
    })),
    picks: CATALOG.map((e) => ({ key: e.key, p: noul(first, `pick_${e.key}`) }))
      .sort((a, b) => b.p - a.p)
      .slice(0, 12),
    sources: fields.map((f) => `${f.key}: ${f.source}`),
    shownWhen: chosen,
    notes,
    faults,
    valid,
    calls: [first, ...(second ? [second] : []), ...(named ? [named.call] : []), ...(enriched ? [enriched.call] : [])].map(
      ({ questions, tokens, ms, model }) => ({ questions, tokens, ms: Math.round(ms), model }),
    ),
    applied: enriched?.applied ?? [],
    wallMs: Math.round(performance.now() - started),
  };
}

export const CRITERIA = [
  'A sign-up form for a B2B SaaS: work email, password, company name, team size, and an optional newsletter opt-in.',
  'Checkout delivery step for an online shop: delivery method (ship or pick up in store), shipping address, preferred delivery date, gift wrapping, and a note for the courier.',
  'Settings for a scheduled backup job: how often it runs (hourly, daily or weekly), retention in days, compress archives, encrypt backups, and an email to notify when a backup fails.',
  'Wedding RSVP: guest name, attending or not, number of guests, meal choice (beef, fish or vegetarian), dietary restrictions, and a song request.',
  '3D printer profile: nozzle temperature, bed temperature, layer height, infill percentage, print speed, filament color.',
  'A bug report form for a mobile app.',
  "Contact form for a dentist's website.",
  'Newsletter preferences page.',
];

if (import.meta.main) {
  const out = join(import.meta.dir, 'out');
  mkdirSync(out, { recursive: true });
  const results: Result[] = [];
  for (const criteria of process.argv.slice(2).length > 0 ? process.argv.slice(2) : CRITERIA) {
    const r = await generate(criteria);
    results.push(r);
    const fields = Object.keys(r.spec.fields);
    console.log(
      `\n■ ${criteria}\n  ${r.explicit ? 'explicit' : 'vague'} · ${r.valid ? 'valid' : 'INVALID'} · ${fields.length} fields · ${r.calls.map((c) => `${c.questions}q/${c.tokens}tok/${c.ms}ms`).join(' + ')}`,
    );
    for (const s of r.sources)
      console.log(`  - ${s}${r.shownWhen[s.split(':')[0]] ? `  [shown when ${r.shownWhen[s.split(':')[0]]}]` : ''}`);
    for (const n of r.notes) console.log(`  ! ${n}`);
    for (const f of r.faults) console.log(`  ✗ ${f}`);
  }
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
}
