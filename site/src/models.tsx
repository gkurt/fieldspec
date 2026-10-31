/**
 * Specs and filled forms from small models: recorded runs of the experiments in experiments/,
 * drawn with fieldspec. Nothing on this page calls a model.
 */
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { htmlRenderers, htmlStyles } from '#examples/renderers/html.tsx';
import generatedJev from '#experiments/clairic-specs/out/jev.json' with { type: 'json' };
import generatedBoth from '#experiments/clairic-specs/out/results.json' with { type: 'json' };
import delegation from '#experiments/delegate/out/delegate-gemma.json' with { type: 'json' };
import { CASES } from '#experiments/fill/cases.ts';
import filling from '#experiments/fill/out/fill.json' with { type: 'json' };
import round1 from '#experiments/writer-specs/out/round1.json' with { type: 'json' };
import round2 from '#experiments/writer-specs/out/round2.json' with { type: 'json' };
import round3 from '#experiments/writer-specs/out/round3.json' with { type: 'json' };
import round4 from '#experiments/writer-specs/out/round4.json' with { type: 'json' };
import { createForm, type Spec } from '#src/index.ts';
import { FormView } from '#src/react/index.tsx';
import { Footer, Heading, Nav, REPO } from './chrome.tsx';
import { Json } from './Code.tsx';
import './styles.css';

// ── The recorded runs ────────────────────────────────────────────────────────────────────

interface Generated {
  criteria: string;
  spec: Spec;
  explicit: boolean;
  sources: string[];
  shownWhen: Record<string, string>;
  applied: string[];
  notes: string[];
  valid: boolean;
  calls: { model: string; ms: number; tokens: number; questions: number }[];
  wallMs: number;
}
interface Mark {
  key: string;
  label: string;
  need: string;
  gold: unknown;
  value: unknown;
  correct: boolean;
  invented: boolean;
}
interface FillRun {
  id: string;
  filler: string;
  marks: Mark[];
  ms: number;
}
interface DelegateRun {
  way: string;
  values: Record<string, unknown>;
  marks: Mark[];
  delegated: string[];
  rejected: string[];
  ms: number;
}
interface DelegateCase {
  id: string;
  routes: Record<string, string>;
  checks: Record<string, number>;
  runs: DelegateRun[];
}

interface Attempt {
  json: boolean;
  valid: boolean;
  behaves: boolean;
  uses: string[];
}
interface Written {
  id: string;
  construct: string;
  run: number;
  first: Attempt;
  repaired?: Attempt;
}
type Counts = Record<'json' | 'valid' | 'behaves', number>;
interface Round {
  summary: { model: string; runs: number; first: Counts; final: Counts };
  results: Written[];
}

const GEN_BOTH = generatedBoth as unknown as Generated[];
const GEN_JEV = generatedJev as unknown as Generated[];
const FILL = filling as unknown as { runs: FillRun[]; summary: Record<string, Summary> };
/** The spec-writing runs, each after the change the one before called for. */
const ROUNDS: readonly { round: Round; change: string }[] = [
  { round: round1, change: 'The prompt as it was.' },
  {
    round: round2,
    change:
      "The prompt lists the CEL functions there are, and says when to add and when to replace; the checker shows a $cond's and a condition's shape.",
  },
  {
    round: round3,
    change: 'The prompt says a migration reads untyped JSON; the checker says a layout is not wrapped in render.',
  },
  {
    round: round4,
    change: 'An untyped whole number works in CEL as an int or a double; the checker reports an invented operator such as $multiply.',
  },
];
const DELEGATE = delegation as unknown as {
  writer: string;
  results: DelegateCase[];
  summary: Record<string, { right: number; of: number; invented: number; delegated: number; rejected: number; ms: number }>;
  signals: {
    jev: Signal;
    clairic: Signal;
    checks: { caught: number; wrong: number; falseAlarms: number; checked: number };
    routeRight: number;
    fields: number;
  };
};
interface Signal {
  caught: number;
  of: number;
  falseAlarms: number;
}
interface Summary {
  right: number;
  of: number;
  invented: number;
  needs: Record<string, { right: number; of: number }>;
  ms: number;
}

/** The ways of filling a form the page shows, in order. */
const WAYS = [
  { id: 'jev', name: 'Jev', about: 'Jev picks each value from candidates code finds in the message.' },
  { id: 'clairic', name: 'Clairic', about: 'Clairic reads each value off the message.' },
  { id: 'both', name: 'Both', about: 'Jev picks options and yes/no; Clairic reads the rest.' },
  {
    id: 'jev-checks',
    name: 'Both + writer',
    about: 'As Both, then Jev flags fields that must be written and checks every value; flagged fields go to a writer model.',
  },
  { id: 'writer', name: 'Writer alone', about: 'A writer model fills every field.' },
] as const;
type Way = (typeof WAYS)[number]['id'];

function runFor(caseId: string, way: Way): { marks: Mark[]; ms: number; delegated: string[]; rejected: string[] } {
  if (way === 'jev-checks' || way === 'writer') {
    const run = DELEGATE.results.find((r) => r.id === caseId)!.runs.find((r) => r.way === way)!;
    return { marks: run.marks, ms: run.ms, delegated: run.delegated, rejected: run.rejected };
  }
  const run = FILL.runs.find((r) => r.id === caseId && r.filler === way)!;
  return { marks: run.marks, ms: run.ms, delegated: [], rejected: [] };
}

// ── Page ─────────────────────────────────────────────────────────────────────────────────

const LINKS = [
  ['#generate', 'Generate'],
  ['#fill', 'Fill', true],
  ['#delegate', 'Hand over'],
  ['#write', 'Write'],
  ['tutorial.html', 'Tutorial'],
  ['examples.html', 'Examples'],
  ['./', 'fieldspec', true],
] as const;

function App() {
  const both = DELEGATE.summary['jev-checks']!;
  return (
    <>
      <style>{htmlStyles}</style>
      <Nav links={LINKS} home="./" />
      <main>
        <header className="hero models-hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow">Experiments · small models</p>
            <h1>
              Specs and filled forms
              <br />
              <span className="accent-text">from models that don't write.</span>
            </h1>
            <p className="lede">
              <a href="https://docs.typesafe.ai">Jev</a> (TypeSafe) answers with choices and probabilities.{' '}
              <a href="https://developers.cloudflare.com/workers-ai/models/clairic/">Clairic</a> (Cloudflare) reads values out of text.
              Neither writes, so code proposes, they decide, and fieldspec's checker and validation have the last word. Where neither is
              enough, they hand the field to a model that does write.
            </p>
            <p className="caption">
              Recorded runs of the scripts in <a href={`${REPO}/tree/main/experiments`}>experiments/</a>. Nothing on this page calls a
              model.
            </p>
          </div>
          <div className="stats hero-stats">
            <div className="stat">
              <strong>
                {GEN_BOTH.filter((g) => g.valid).length}/{GEN_BOTH.length}
              </strong>
              <span>descriptions became valid specs</span>
            </div>
            <div className="stat">
              <strong>
                {both.right}/{both.of}
              </strong>
              <span>form fields right with verify-and-escalate</span>
            </div>
            <div className="stat">
              <strong>{FILL.summary.both!.invented}</strong>
              <span>values invented for fields the message never mentions</span>
            </div>
          </div>
        </header>
        <Generate />
        <Fill />
        <Delegate />
        <Write />
        <Lessons />
      </main>
      <Footer>Every form on this page is drawn by FormView with the example renderers.</Footer>
    </>
  );
}

// ── Generating specs ─────────────────────────────────────────────────────────────────────

const shortName = (g: Generated) =>
  (typeof g.spec.title === 'string' ? g.spec.title : (g.criteria.split(/[:.]/)[0] ?? '')).replace(/^(?:A|An|The)\s+/i, '');

function Generate() {
  const [index, setIndex] = useState(8);
  const [withClairic, setWithClairic] = useState(true);
  const g = (withClairic ? GEN_BOTH : GEN_JEV)[index]!;
  const form = useMemo(() => createForm(g.spec), [g]);
  return (
    <section className="section" id="generate">
      <Heading kicker="Generating specs" title="From a sentence to a spec">
        Code splits the description into phrases. In one request Jev decides which are fields, of what kind, which may be left blank and
        which catalog field each matches, or, for a vague description, which fields a form like it needs. A second request decides when each
        is shown. Clairic, alongside, reads what the text states: short names, ranges, defaults, units, lengths and options.
      </Heading>
      <div className="pickers">
        <div className="seg" role="group" aria-label="Description">
          {GEN_BOTH.map((x, i) => (
            <button key={i} type="button" aria-pressed={i === index} onClick={() => setIndex(i)}>
              {shortName(x)}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Models">
          <button type="button" aria-pressed={!withClairic} onClick={() => setWithClairic(false)}>
            Jev alone
          </button>
          <button type="button" aria-pressed={withClairic} onClick={() => setWithClairic(true)}>
            Jev + Clairic
          </button>
        </div>
      </div>
      <blockquote className="quote">{g.criteria}</blockquote>
      <div className="split">
        <div className="card form-card" data-fieldspec="">
          <FormView key={`${index}-${withClairic}`} form={form} renderers={htmlRenderers} />
        </div>
        <div className="card notes">
          <p className="meta">
            <span className={`badge ${g.valid ? 'good' : 'bad'}`}>{g.valid ? 'valid spec' : 'invalid'}</span>{' '}
            {g.explicit ? 'fields named in the text' : 'vague: fields from the catalog'} · {g.calls.length} requests ·{' '}
            {(g.wallMs / 1000).toFixed(1)} s
          </p>
          <h3>What Jev decided</h3>
          <ul className="decisions">
            {g.sources.map((s) => {
              const [key, ...rest] = s.split(': ');
              return (
                <li key={s}>
                  <code>{key}</code> {rest.join(': ')}
                  {g.shownWhen[key!] && <em> · shown when {g.shownWhen[key!]}</em>}
                </li>
              );
            })}
          </ul>
          {withClairic && g.applied.length > 0 && (
            <>
              <h3>What Clairic read from the text</h3>
              <ul className="decisions mono">
                {g.applied.map((a) => (
                  <li key={a} className={a.includes('dropped') ? 'dropped' : undefined}>
                    {a}
                  </li>
                ))}
              </ul>
            </>
          )}
          {g.notes.map((n) => (
            <p key={n} className="caption">
              {n}
            </p>
          ))}
          <details>
            <summary>The spec</summary>
            <Json value={g.spec} label="spec.json" />
          </details>
        </div>
      </div>
    </section>
  );
}

// ── Filling forms ────────────────────────────────────────────────────────────────────────

const shown = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
const NEED: Record<string, string> = {
  copy: 'in the message',
  choose: 'an option',
  compute: 'worked out',
  write: 'to be written',
  absent: 'not in the message',
};

function Fill() {
  const [caseId, setCaseId] = useState('booking');
  const [way, setWay] = useState<Way>('jev-checks');
  const c = CASES.find((x) => x.id === caseId)!;
  const run = runFor(caseId, way);
  const routes = DELEGATE.results.find((r) => r.id === caseId)!.routes;
  const values = Object.fromEntries(run.marks.filter((m) => m.value !== null && m.value !== undefined).map((m) => [m.key, m.value]));
  const form = useMemo(() => createForm(c.spec, { values }), [caseId, way]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="section" id="fill">
      <Heading kicker="Filling forms" title="From a message to a filled form">
        Seven messages, each with a form and the right answers. Every field is tagged with what filling it takes: copying from the message,
        picking an option, working a value out, writing new text, or leaving it empty because the message says nothing.
      </Heading>
      <div className="pickers">
        <div className="seg" role="group" aria-label="Message">
          {CASES.map((x) => (
            <button key={x.id} type="button" aria-pressed={x.id === caseId} onClick={() => setCaseId(x.id)}>
              {x.title.split(' from ')[0]}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Filled by">
          {WAYS.map((w) => (
            <button key={w.id} type="button" aria-pressed={w.id === way} onClick={() => setWay(w.id)} title={w.about}>
              {w.name}
            </button>
          ))}
        </div>
      </div>
      <blockquote className="quote">
        {c.source}
        <cite>
          {c.title} · written {c.today}
        </cite>
      </blockquote>
      <div className="split">
        <div className="card form-card" data-fieldspec="">
          <FormView key={`${caseId}-${way}`} form={form} renderers={htmlRenderers} />
        </div>
        <div className="card notes">
          <p className="meta">
            {WAYS.find((w) => w.id === way)!.about} {run.marks.filter((m) => m.correct).length}/{run.marks.length} right ·{' '}
            {(run.ms / 1000).toFixed(1)} s
          </p>
          <table className="marks">
            <thead>
              <tr>
                <th>Field</th>
                <th>Takes</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {run.marks.map((m) => (
                <tr key={m.key} className={m.correct ? 'right' : 'wrong'}>
                  <th>
                    {m.label}
                    {run.delegated.includes(m.key) && way !== 'writer' && (
                      <span className="pill">{run.rejected.includes(m.key) ? 'writer refused' : 'to the writer'}</span>
                    )}
                  </th>
                  <td>
                    {NEED[m.need]}
                    <small> · Jev: {routes[m.key]}</small>
                  </td>
                  <td>
                    <span className="tick" aria-label={m.correct ? 'right' : 'wrong'}>
                      {m.correct ? '✓' : '✗'}
                    </span>{' '}
                    {shown(m.value)}
                    {!m.correct && <small> · wanted {shown(m.gold)}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Scoreboard />
    </section>
  );
}

function Scoreboard() {
  const rows = WAYS.map((w) => {
    const runs = (
      w.id === 'jev-checks' || w.id === 'writer'
        ? DELEGATE.results.map((r) => r.runs.find((x) => x.way === w.id)!)
        : FILL.runs.filter((r) => r.filler === w.id)
    ) as { marks: Mark[]; ms: number }[];
    const marks = runs.flatMap((r) => r.marks);
    const need = (n: string) => {
      const m = marks.filter((x) => x.need === n);
      return `${m.filter((x) => x.correct).length}/${m.length}`;
    };
    return {
      w,
      right: marks.filter((m) => m.correct).length,
      of: marks.length,
      need,
      invented: marks.filter((m) => m.invented).length,
      ms: runs.reduce((n, r) => n + r.ms, 0) / runs.length,
    };
  });
  return (
    <div className="table-wrap">
      <table className="names scoreboard">
        <thead>
          <tr>
            <th>Filled by</th>
            <th>Right</th>
            <th>In the message</th>
            <th>An option</th>
            <th>Worked out</th>
            <th>To be written</th>
            <th>Left empty</th>
            <th>Invented</th>
            <th>Per form</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.w.id}>
              <th>{r.w.name}</th>
              <td>
                <strong>
                  {r.right}/{r.of}
                </strong>
              </td>
              <td>{r.need('copy')}</td>
              <td>{r.need('choose')}</td>
              <td>{r.need('compute')}</td>
              <td>{r.need('write')}</td>
              <td>{r.need('absent')}</td>
              <td>{r.invented}</td>
              <td>{(r.ms / 1000).toFixed(1)} s</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption">
        The writer is {DELEGATE.writer.includes('gemma') ? 'Gemma 4 (26B) on Workers AI' : 'Claude Haiku 5.5'}; the scripts use Claude Haiku
        5.5 when given an Anthropic key. Times include starting Cloudflare's CLI for each Clairic and writer call, about a second of each.
      </p>
    </div>
  );
}

// ── Handing over ─────────────────────────────────────────────────────────────────────────

function Delegate() {
  const s = DELEGATE.signals;
  const ways = ['both', 'jev-routes', 'clairic-unsure', 'jev-checks', 'writer'] as const;
  const names: Record<(typeof ways)[number], [string, string]> = {
    both: ['Jev and Clairic', 'No writer.'],
    'jev-routes': [
      '+ Jev routes',
      'Jev is asked, per field, whether the value can be taken from the message, must be written, or is missing. Written fields go to the writer.',
    ],
    'clairic-unsure': ['+ Clairic unsure', 'Text fields Clairic left empty or answered with confidence under 0.5 go to the writer.'],
    'jev-checks': [
      '+ Jev checks',
      "Jev's routes, and Jev checks each filled value against the message; doubtful ones go to the writer too.",
    ],
    writer: ['Writer alone', 'The writer fills every field.'],
  };
  return (
    <section className="section" id="delegate">
      <Heading kicker="Knowing their limits" title="Handing over what they cannot do">
        Can a model that only chooses or reads tell when a field needs more? Jev was asked, field by field, in the same round trip as the
        fill. Every value the writer returned then had to pass the spec's own rules through <code>parse</code>.
      </Heading>
      <div className="grid three">
        <article className="tile">
          <h3>Jev routes</h3>
          <code>
            {s.jev.caught}/{s.jev.of} caught
          </code>
          <p>
            Every field that had to be written was flagged, with {s.jev.falseAlarms} false alarms among {s.fields - s.jev.of}. Its three-way
            call matched the tags on {s.routeRight} of {s.fields} fields.
          </p>
        </article>
        <article className="tile">
          <h3>Clairic's own uncertainty</h3>
          <code>
            {s.clairic.caught}/{s.clairic.of} caught
          </code>
          <p>
            A weaker signal: {s.clairic.falseAlarms} false alarms, and empty answers send fields the message never mentions to the writer,
            which then invented one.
          </p>
        </article>
        <article className="tile">
          <h3>Jev checks</h3>
          <code>
            {s.checks.caught}/{s.checks.wrong} wrong values caught
          </code>
          <p>
            Checking {s.checks.checked} filled values against the message caught a wrong date with {s.checks.falseAlarms} false alarms, but
            missed two wrong passages of text.
          </p>
        </article>
      </div>
      <div className="table-wrap">
        <table className="names scoreboard">
          <thead>
            <tr>
              <th>Way</th>
              <th>Right</th>
              <th>Invented</th>
              <th>To the writer</th>
              <th>Refused by the spec</th>
              <th>Per form</th>
            </tr>
          </thead>
          <tbody>
            {ways.map((w) => {
              const x = DELEGATE.summary[w]!;
              return (
                <tr key={w}>
                  <th>
                    {names[w][0]}
                    <small>{names[w][1]}</small>
                  </th>
                  <td>
                    <strong>
                      {x.right}/{x.of}
                    </strong>
                  </td>
                  <td>{x.invented}</td>
                  <td>{x.delegated}</td>
                  <td>{x.rejected}</td>
                  <td>{(x.ms / 1000).toFixed(1)} s</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Writing specs ────────────────────────────────────────────────────────────────────────

const CONSTRUCTS: Record<string, string> = {
  checks: 'a rule over fields',
  value: 'a derived value',
  condition: 'a condition',
  locales: 'translations',
  migrations: 'a migration',
};

const outcome = (a: Attempt) =>
  !a.json ? 'not JSON' : a.valid ? (a.behaves ? 'behaves' : 'misbehaves') : a.behaves ? 'rejected, behaves' : 'rejected';

function Write() {
  const latest = ROUNDS.at(-1)!.round;
  const cases = [...new Set(latest.results.map((r) => r.id))];
  return (
    <section className="section" id="write">
      <Heading kicker="Writing specs" title="The newer vocabulary, from a model that writes">
        Gemma 4 (Workers AI) wrote whole specs from <code>prompt(registry)</code> for ten descriptions that call for rules over several
        fields, derived values, translations and a migration, twice each. Every spec was held to a test of how it behaves, which the model
        never saw; one the checker rejected went back once with its faults. Where it failed, the prompt or the checker changed, and the runs
        were made again.
      </Heading>
      <div className="table-wrap">
        <table className="names scoreboard">
          <thead>
            <tr>
              <th>Round</th>
              <th>Behaved, first try</th>
              <th>After the faults went back</th>
              <th>Accepted by the checker</th>
            </tr>
          </thead>
          <tbody>
            {ROUNDS.map(({ round, change }, i) => (
              <tr key={change}>
                <th>
                  {i + 1}
                  <small>{change}</small>
                </th>
                <td>
                  {round.summary.first.behaves}/{round.summary.runs}
                </td>
                <td>
                  <strong>
                    {round.summary.final.behaves}/{round.summary.runs}
                  </strong>
                </td>
                <td>
                  {round.summary.final.valid}/{round.summary.runs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="names scoreboard">
          <thead>
            <tr>
              <th>Description, round {ROUNDS.length}</th>
              <th>Calls for</th>
              <th>Runs</th>
              <th>Used</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((id) => {
              const runs = latest.results.filter((r) => r.id === id);
              return (
                <tr key={id}>
                  <th>{id}</th>
                  <td>{CONSTRUCTS[runs[0]!.construct] ?? runs[0]!.construct}</td>
                  <td>
                    {runs.map((r) => (
                      <div key={r.run}>
                        {outcome(r.first)}
                        {r.repaired && ` → ${outcome(r.repaired)}`}
                      </div>
                    ))}
                  </td>
                  <td>{[...new Set(runs.flatMap((r) => (r.repaired ?? r.first).uses))].join(', ') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Lessons ──────────────────────────────────────────────────────────────────────────────

const LESSONS: readonly [string, string][] = [
  [
    'Code proposes, the model decides',
    'Jev never writes a declaration or a value: it picks among fields from a catalog, kinds, options and spans of the message that code offers. Its answers are typed, so the spec is valid by construction.',
  ],
  [
    'Each model to what it is for',
    'Jev for what the field is, which option and whether a value holds; Clairic for what the text states, from limits and defaults to dates. Neither alone does both.',
  ],
  [
    'The spec has the last word',
    "fieldspec's checker catches a broken spec, and parse refuses a written value over a field's length limit, whichever model produced it.",
  ],
  [
    'Ask one model at a time',
    'Asked about many similar things in one pass, Clairic blurred them: split words, borrowed names, numbers the text does not state. Asked one at a time, it was right.',
  ],
  [
    'Read literally',
    'Jev answers the question as written. "What the person fills in" made it doubt settings; asking whether a phrase gets a value fixed it.',
  ],
  [
    'A fault that shows the shape',
    'Gemma, writing whole specs, put $cond branches inside $cond and invented $gte and $multiply. Told the rule, it tried again the same way; shown the shape, it fixed the spec. Its first tries barely changed over four rounds; its repairs went from 12 of 20 to all of them.',
  ],
  [
    'Small models leave the field empty',
    'Across 49 fields none of them invented a value the message does not give, which a writer asked to fill everything cannot promise.',
  ],
];

function Lessons() {
  return (
    <section className="section" id="lessons">
      <Heading kicker="What we learned" title="Small models, kept honest by a spec">
        On this small set a general model alone was the most accurate, at several times the time and cost. The small models are fast and
        calibrated, and with a spec checking their work they hand over only the few fields that need writing.
      </Heading>
      <div className="grid">
        {LESSONS.map(([title, text]) => (
          <article key={title} className="tile">
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
