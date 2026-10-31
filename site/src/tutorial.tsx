/**
 * The format, step by step: one spec grown a feature at a time. Each step shows what changed
 * since the one before, the form the library draws from it, and the value that form edits.
 */
import { StrictMode, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { htmlRenderers, htmlStyles } from '#examples/renderers/html.tsx';
import { toJSONSchema, type Form, type Spec } from '#src/index.ts';
import { FormView, useForm, useFormState } from '#src/react/index.tsx';
import { Footer, Nav, REPO } from './chrome.tsx';
import { Code, highlight, Json } from './Code.tsx';
import * as L from './lessons.ts';
import './styles.css';

interface Step {
  readonly id: Exclude<keyof typeof L, 'TYPES' | 'german' | 'STORED_V1'>;
  readonly title: string;
  readonly text: ReactNode;
  /** A layout to offer beside the default one. */
  readonly view?: string;
  /** A locale to offer beside the spec's own language. */
  readonly locale?: string;
  /** Stored values the form opens, shown beside the text, and the version they were written for. */
  readonly stored?: { readonly label: string; readonly json: unknown; readonly from: number };
}

/** Each step's spec, by the step's id. */
const LESSONS: Readonly<Record<Step['id'], Spec>> = L;

const LANGUAGES: Readonly<Record<string, string>> = { de: 'Deutsch' };

const STEPS: readonly Step[] = [
  {
    id: 'one',
    title: 'One field',
    text: (
      <>
        <p>
          A spec is a JSON object. Its <code>fields</code> say what the value holds, and each field names its kind with <code>type</code>.
        </p>
        <p>
          That is already enough for three things: TypeScript infers the value's type, <code>parse</code> checks a value against it, and a
          form edits it. The label comes from the key until you give one.
        </p>
      </>
    ),
  },
  {
    id: 'kinds',
    title: 'Kinds',
    text: (
      <>
        <p>
          A kind decides a value's shape, the checks it gets and the control that edits it. <code>int</code> takes <code>min</code> and{' '}
          <code>max</code>, an <code>enum</code> takes <code>options</code>, and <code>default</code> is what a new value starts with.
        </p>
        <p>
          The other kinds are <code>number</code>, <code>date</code>, <code>url</code>, <code>bigint</code>, <code>regexp</code>,{' '}
          <code>bytes</code> and <code>json</code>, and the containers that come later. Try 30 replicas: <code>max</code> is a check, so an
          issue appears under the value.
        </p>
      </>
    ),
  },
  {
    id: 'words',
    title: 'Words for people',
    text: (
      <>
        <p>
          <code>label</code>, <code>placeholder</code> and <code>hint</code> are for whoever fills the form in. An option can be{' '}
          <code>{'{ value, label }'}</code>: the value stays <code>"eu-west"</code>, the form reads Europe.
        </p>
        <p>
          <code>required</code> and <code>pattern</code> are checks like <code>max</code>. Leave the name empty, or type a capital letter. A
          form shows an issue once its field is touched; <code>parse</code> reports them all.
        </p>
      </>
    ),
  },
  {
    id: 'presets',
    title: 'Presets: use',
    text: (
      <>
        <p>
          Instead of a <code>type</code>, a field can <code>use</code> a named declaration and override what it needs. The built-in presets
          are <code>percent</code>, <code>email</code>, <code>password</code>, <code>multiline</code>, <code>port</code> and{' '}
          <code>color</code>.
        </p>
        <p>
          <code>percent</code> is a number from 0 to 1 drawn as a slider in percent. <code>cpu</code> keeps all of that and adds its own
          label and default.
        </p>
      </>
    ),
  },
  {
    id: 'controls',
    title: 'Controls: render',
    text: (
      <>
        <p>
          Every kind has a default control; <code>render</code> picks another. The controls are <code>input</code>, <code>textarea</code>,{' '}
          <code>select</code>, <code>radio</code>, <code>segmented</code>, <code>checkbox</code>, <code>switch</code>, <code>slider</code>,{' '}
          <code>date</code>, <code>color</code>, <code>file</code> and <code>checks</code>.
        </p>
        <p>
          The checker knows which controls edit which kinds, so <code>"render": "slider"</code> on a string is a fault you see before anyone
          draws the form.
        </p>
      </>
    ),
  },
  {
    id: 'conditions',
    title: 'Conditions',
    text: (
      <>
        <p>
          <code>visible</code>, <code>enabled</code> and <code>required</code> take a condition instead of <code>true</code>. A condition
          reads the value at a pointer and compares it: <code>eq</code>, <code>neq</code>, <code>in</code>, <code>not</code>, and{' '}
          <code>$and</code> and <code>$or</code> to combine them.
        </p>
        <p>
          Turn on <em>Reachable from the internet</em>: the domain appears and becomes required. Turn on <em>Scale with load</em> for its
          upper bound. The rules are data, so they survive being saved, sent and checked.
        </p>
      </>
    ),
  },
  {
    id: 'grouped',
    title: 'Groups and order',
    text: (
      <>
        <p>
          <code>group</code> gathers fields for display without changing the value's shape: the value on the right is still flat. A group
          has a label and a <code>render</code>, here a frame and a collapsible, and it draws where its first field does.
        </p>
        <p>
          Fields draw in the order they are declared. <code>order</code> moves one: lower draws first and a field without it counts as 0, so{' '}
          <code>"order": 1</code> sends the contact to the bottom.
        </p>
      </>
    ),
  },
  {
    id: 'objects',
    title: 'Objects',
    text: (
      <>
        <p>
          An <code>object</code> field has <code>fields</code> of its own, and its value nests. Its label sits on its frame.
        </p>
        <p>
          A pointer without a leading slash is relative to the enclosing object, so <code>"on"</code> is the health check's own switch.{' '}
          <code>"../public"</code> would climb out of it, and <code>"/public"</code> is absolute. That is what lets a piece of spec work
          wherever it is placed. <code>unit</code> is shown beside the value.
        </p>
      </>
    ),
  },
  {
    id: 'collections',
    title: 'Lists, records and sets',
    text: (
      <>
        <p>
          An <code>array</code> repeats its <code>items</code>: add, remove, and reorder by dragging the handle or with the arrow keys. A{' '}
          <code>record</code> maps keys you name to <code>values</code>, and renaming a key keeps its entry in place. A <code>set</code>{' '}
          holds each item once; <code>checks</code> draws it as checkboxes. A <code>map</code> is a record with keys of any kind.
        </p>
        <p>
          Values are real JS values: the features are a <code>Set</code> in code, and <code>encode</code> turns it into the JSON list on the
          right.
        </p>
      </>
    ),
  },
  {
    id: 'variants',
    title: 'Variants',
    text: (
      <>
        <p>
          A <code>variant</code> is a discriminated union. <code>key</code> names the field that says which variant a value is, and each
          variant has its own fields. Choose Container image: the fields change, and the type is a union TypeScript narrows on{' '}
          <code>from</code>.
        </p>
        <p>
          A <code>url</code> field holds a <code>URL</code>, and <code>protocols</code> limits which ones it takes.
        </p>
      </>
    ),
  },
  {
    id: 'definitions',
    title: 'Definitions',
    text: (
      <>
        <p>
          The health check becomes a definition in <code>defs</code>, used twice. <code>use</code> looks up capitalized names in the spec's
          own definitions, so a definition can never collide with a built-in, which are all lowercase.
        </p>
        <p>
          The readiness check is <code>optional</code>, so the form offers to add it instead of drawing it. A definition may also use
          itself, through a list or an optional field, which is how a menu holds menus. The checker rejects one whose value could never end.
        </p>
      </>
    ),
  },
  {
    id: 'expressions',
    title: 'Expressions',
    text: (
      <>
        <p>
          Labels, hints, defaults, options and element props can be expressions. <code>$state</code> reads a value, <code>$template</code>{' '}
          fills one into text, and <code>$cond</code> picks between two by a condition. <code>$computed</code> calls a function you pass at
          runtime by name, so the spec stays JSON.
        </p>
        <p>
          A <code>default</code> fills a value that is absent; a <code>value</code> decides it every time, so the field follows the others
          and nobody edits it. The address is worked out from the domain and the port.
        </p>
        <p>Type a service name and turn the internet on: the domain's label follows. Drag the replicas down to 1 for a warning.</p>
      </>
    ),
  },
  {
    id: 'checks',
    title: 'Checks',
    text: (
      <>
        <p>
          A field's <code>checks</code> are rules its value keeps beyond its kind's own, usually over other fields. Each is a condition,{' '}
          <code>assert</code>, that holds while the value is valid, and a <code>message</code> the field shows while it does not. Turn on{' '}
          <em>Scale with load</em> and set its bound below the replicas.
        </p>
        <p>
          What a condition cannot say, <code>$cel</code> can: a <a href="https://cel.dev">CEL</a> expression over the values it is given as{' '}
          <code>args</code>, typed by the fields they read, so the checker catches a mistake before anyone fills the form. The alert's
          target must suit its channel; the first one does not. A registry with <code>fieldspec/cel</code>'s language runs it.
        </p>
        <p>
          Past what CEL can say, <code>$js</code> runs a JavaScript expression the same way, sandboxed in QuickJS with a time and memory
          limit, from <code>fieldspec/js</code>. It is heavier, so reach for CEL first.
        </p>
      </>
    ),
  },
  {
    id: 'layouts',
    title: 'Layouts',
    view: 'tabs',
    text: (
      <>
        <p>
          <code>layouts</code> arrange the whole form, as many ways as you like, without touching the fields. Containers place a{' '}
          <code>field</code> or a <code>group</code>, and <code>rest</code> takes whatever is left, so a field added later still shows up.
        </p>
        <p>
          The layout elements are <code>stack</code>, <code>row</code>, <code>columns</code>, <code>collapsible</code>, <code>scroll</code>,{' '}
          <code>tabs</code>, <code>text</code> and <code>divider</code>. Switch between the groups and the tabs above the form.
        </p>
      </>
    ),
  },
  {
    id: 'translations',
    title: 'Translations',
    locale: 'de',
    text: (
      <>
        <p>
          <code>locales</code> carries the spec's text in other languages: for each locale, a table from a JSON Pointer into the spec to the
          text in its place. A pointer reaches a label, a hint, an option, a check's message, a tab's title, or a string inside a template.{' '}
          <code>texts(spec)</code> lists them all, including labels the spec only implies, ready for a translator or a model.
        </p>
        <p>
          Switch to Deutsch: <code>{'createForm(spec, { locale: "de" })'}</code> lays the table over the spec. The library's own messages,
          like <em>is required</em>, carry <code>params</code>, and a <code>messages</code> function says them in German. The checker
          reports a pointer that leads nowhere, and what a locale leaves as written.
        </p>
      </>
    ),
  },
  {
    id: 'versions',
    title: 'Versions',
    stored: { label: 'stored by version 1', json: L.STORED_V1, from: 1 },
    text: (
      <>
        <p>
          Values outlive the spec that wrote them. <code>version</code> says which version of its values a spec describes, and{' '}
          <code>migrations</code> bring older ones forward: for each version, JSON Patch operations over the stored JSON, where{' '}
          <code>*</code> stands for every item and a <code>value</code> may be an expression. Version 1 called the replicas{' '}
          <code>instances</code>, kept the CPU limit in millicores, and sent alerts <code>to</code> a target.
        </p>
        <p>
          The form opened the values below, stored before the spec had a version: <code>{'createForm(spec, { values, from: 1 })'}</code>{' '}
          migrated them on the way in, and what it writes says <code>"$version": 2</code>, so next time it needs no <code>from</code>.{' '}
          <code>migrate(spec, json)</code> does only the migrating, and <code>parse</code> reports a value a migration could not work out.
        </p>
      </>
    ),
  },
];

const FROM_CODE = `import { checkSpec, createRegistry, parse, texts, toJSONSchema, type Infer } from "fieldspec";
import { createCel } from "fieldspec/cel";
import { FormView, useForm } from "fieldspec/react";
import { htmlRenderers } from "./renderers/html"; // copied from fieldspec's examples/renderers

// The registry runs $cel. Its define keeps the spec's literal types for Infer.
const registry = createRegistry({ languages: [createCel()] });
const service = registry.define({ fields: { … }, groups: { … }, defs: { … }, layouts: { … } });

type Service = Infer<typeof service>;

const result = parse(service, json); // { ok, value, issues: [{ path, code, message }] }
const schema = toJSONSchema(service);

function Settings() {
  const form = useForm(service);
  return <FormView form={form} view="tabs" renderers={htmlRenderers} />;
}

// A spec that arrives as JSON, from a file or a model, is checked first:
const faults = checkSpec(JSON.parse(text), { registry }); // each at a pointer, phrased as the fix

// What there is to translate, by pointer; its translation goes under "locales".
const strings = texts(service); // { "/fields/name/label": "Service name", … }`;

const LINKS = [
  ['./', 'Home', true],
  ['#one', 'Steps'],
  ['#code', 'From code'],
  ['examples.html', 'Examples'],
  ['models.html', 'With AI models'],
] as const;

function App() {
  return (
    <>
      <style>{htmlStyles}</style>
      <Nav links={LINKS} home="./" />
      <main>
        <header className="hero tutorial-hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow">Tutorial · {STEPS.length} steps</p>
            <h1>
              Learn the format
              <br />
              <span className="accent-text">one field at a time.</span>
            </h1>
            <p className="lede">
              One spec, the settings of a web service, grows a feature at a time: kinds, presets, controls, conditions, groups, nesting,
              collections, unions, definitions, expressions, checks, layouts, translations and versions. Each step shows what changed, the
              form fieldspec draws from it, and the value that form edits. Every form is live.
            </p>
          </div>
          <ol className="toc" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>
                  <span>{i + 1}</span> {s.title}
                </a>
              </li>
            ))}
            <li>
              <a href="#code">
                <span>{STEPS.length + 1}</span> From code
              </a>
            </li>
          </ol>
        </header>
        {STEPS.map((s, i) => (
          <Lesson key={s.id} step={s} n={i + 1} before={i === 0 ? undefined : LESSONS[STEPS[i - 1]!.id]} />
        ))}
        <section className="section feature" id="code">
          <div className="feature-copy">
            <div className="heading">
              <p className="eyebrow">Step {STEPS.length + 1}</p>
              <h2>From code</h2>
            </div>
            <div className="lesson-text">
              <p>
                In TypeScript, <code>define</code> keeps the spec's literal types so <code>Infer</code> can read them. The same spec, as
                JSON, converts to JSON Schema, Zod, Standard Schema and json-render, and <code>prompt</code> and <code>metaSchema</code> let
                a model write specs of its own.
              </p>
              <p>
                <a href="./#playground">The playground</a> checks any spec you write, and the <a href={REPO}>README</a> has the rest.
              </p>
            </div>
            <Code code={FROM_CODE} label="service.tsx" />
          </div>
          <div className="feature-demo">
            <Json value={toJSONSchema(L.versions)} label="toJSONSchema(service)" className="lesson-out" />
          </div>
        </section>
      </main>
      <Footer>Every form on this page is drawn by FormView with the example renderers.</Footer>
    </>
  );
}

function Lesson({ step, n, before }: { step: Step; n: number; before?: Spec }) {
  const spec = LESSONS[step.id];
  return (
    <section className="section feature lesson" id={step.id}>
      <div className="feature-copy">
        <div className="heading">
          <p className="eyebrow">Step {n}</p>
          <h2>{step.title}</h2>
        </div>
        <div className="lesson-text">{step.text}</div>
        {step.stored && <Json value={step.stored.json} label={step.stored.label} className="lesson-out" />}
        <Diff before={before} after={spec} />
      </div>
      <div className="feature-demo lesson-demo">
        <Live
          spec={spec}
          view={step.view}
          locale={step.locale}
          values={step.stored?.json}
          from={step.stored?.from}
          type={(L.TYPES as Record<string, string>)[step.id]}
        />
      </div>
    </section>
  );
}

interface LiveProps {
  readonly spec: Spec;
  readonly view?: string;
  readonly locale?: string;
  readonly values?: unknown;
  readonly from?: number;
  readonly type?: string;
}

/** A form for the spec, in its own language or, at a switch, in the step's locale. */
function Live(props: LiveProps) {
  const [locale, setLocale] = useState<string | undefined>(undefined);
  return (
    <>
      {props.locale && (
        <div className="seg" role="group" aria-label="Language">
          <button type="button" aria-pressed={locale === undefined} onClick={() => setLocale(undefined)}>
            English
          </button>
          <button type="button" aria-pressed={locale === props.locale} onClick={() => setLocale(props.locale)}>
            {LANGUAGES[props.locale] ?? props.locale}
          </button>
        </div>
      )}
      <LiveForm key={locale ?? ''} {...props} locale={locale} />
    </>
  );
}

function LiveForm({ spec, view, locale, values, from, type }: LiveProps) {
  const form = useForm(spec, { locale, values, from, ...(locale && { messages: L.german }) }) as Form;
  const [shown, setShown] = useState<string | undefined>(view);
  const [tab, setTab] = useState<'value' | 'type'>('value');
  return (
    <>
      {view && (
        <div className="seg" role="group" aria-label="Layout">
          <button type="button" aria-pressed={shown === undefined} onClick={() => setShown(undefined)}>
            Groups
          </button>
          <button type="button" aria-pressed={shown === view} onClick={() => setShown(view)}>
            Tabs
          </button>
        </div>
      )}
      <div className="card form-card" data-fieldspec="">
        <FormView key={shown ?? ''} form={form} view={shown} renderers={htmlRenderers} />
      </div>
      <div className="card lesson-out-card">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'value'} onClick={() => setTab('value')}>
            value
          </button>
          {type && (
            <button type="button" role="tab" aria-selected={tab === 'type'} onClick={() => setTab('type')}>
              Infer
            </button>
          )}
        </div>
        {tab === 'type' && type ? <Code code={type} className="lesson-out" /> : <Value form={form} />}
      </div>
    </>
  );
}

function Value({ form }: { form: Form }) {
  const { json, issues } = useFormState(form);
  return (
    <>
      <Json value={json} className="lesson-out" />
      {issues.length > 0 && (
        <ul className="faults" aria-label="Issues">
          {issues.map((i) => (
            <li key={`${i.path}:${i.message}`} className="error">
              <code>{i.path}</code> {i.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ── What changed ─────────────────────────────────────────────────────────────────────────

/**
 * JSON as a spec is written by hand: the spec and its maps (`fields`, `groups`, …) one entry
 * per line, and anything below them on one line while it fits.
 */
function pretty(value: unknown, pad = '', lead = 0, depth = 0): string {
  const one = inline(value);
  if (value === null || typeof value !== 'object' || (depth > 1 && lead + one.length <= 78)) return one;
  const inner = `${pad}  `;
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + pretty(v, inner, inner.length, depth + 1)).join(',\n')}\n${pad}]`;
  const lines = Object.entries(value).map(([k, v]) => {
    const key = `${JSON.stringify(k)}: `;
    return inner + key + pretty(v, inner, inner.length + key.length, depth + 1);
  });
  return `{\n${lines.join(',\n')}\n${pad}}`;
}

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length > 0 ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

type Line = { text: string; change: 'same' | 'added' | 'removed' };

/**
 * A line diff by longest common subsequence: specs here are a few hundred lines at most. A
 * line that only gained or lost its trailing comma, because an entry was added after it, is
 * the same line.
 */
function diff(before: readonly string[], b: readonly string[]): Line[] {
  const a = before.map((l, i) => (b.includes(l) ? l : (b.find((m) => m.replace(/,$/, '') === l.replace(/,$/, '')) ?? before[i]!)));
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  }
  const out: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ text: b[j]!, change: 'same' });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      out.push({ text: b[j++]!, change: 'added' });
    } else {
      out.push({ text: a[i++]!, change: 'removed' });
    }
  }
  return out;
}

/** Unchanged runs longer than this fold away, keeping `CONTEXT` lines on either side. */
const CONTEXT = 2;

function Diff({ before, after }: { before?: Spec; after: Spec }) {
  const [whole, setWhole] = useState(false);
  const lines = useMemo(
    () =>
      before
        ? diff(pretty(before).split('\n'), pretty(after).split('\n')).filter((l) => !(whole && l.change === 'removed'))
        : pretty(after)
            .split('\n')
            .map((text): Line => ({ text, change: 'same' })),
    [before, after, whole],
  );
  const rows: ReactNode[] = [];
  for (let k = 0; k < lines.length;) {
    const l = lines[k]!;
    if (before && !whole && l.change === 'same') {
      let end = k;
      while (end < lines.length && lines[end]!.change === 'same') end++;
      const keepStart = k === 0 ? 0 : CONTEXT;
      const keepEnd = end === lines.length ? 0 : CONTEXT;
      if (end - k > keepStart + keepEnd + 1) {
        for (let m = k; m < k + keepStart; m++) rows.push(<Row key={m} line={lines[m]!} />);
        rows.push(
          <span key={`fold${k}`} className="fold">
            {'  '}⋯ {end - k - keepStart - keepEnd} unchanged lines{'\n'}
          </span>,
        );
        for (let m = end - keepEnd; m < end; m++) rows.push(<Row key={m} line={lines[m]!} />);
        k = end;
        continue;
      }
    }
    rows.push(<Row key={k} line={l} />);
    k++;
  }
  const changed = lines.some((l) => l.change !== 'same');
  return (
    <figure className="code diff">
      <figcaption>
        <span>{before ? 'spec.json, what changed' : 'spec.json'}</span>
        {before && changed && (
          <button type="button" className="link-button" onClick={() => setWhole(!whole)}>
            {whole ? 'Show changes' : 'Show whole spec'}
          </button>
        )}
      </figcaption>
      <pre>
        <code>{rows}</code>
      </pre>
    </figure>
  );
}

function Row({ line }: { line: Line }) {
  const mark = line.change === 'added' ? '+' : line.change === 'removed' ? '-' : ' ';
  return (
    <span className={`line ${line.change}`}>
      <span className="gutter" aria-hidden="true">
        {mark}
      </span>
      {line.change === 'removed' ? line.text : highlight(line.text)}
      {'\n'}
    </span>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
