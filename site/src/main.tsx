/** fieldspec's homepage. Every form, fault and output on it comes from the library, live. */
import { StrictMode, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { htmlRenderers, htmlStyles } from '#examples/renderers/html.tsx';
import { parse, prompt, toJSONSchema, toJsonRender, VERSION, type Form } from '#src/index.ts';
import { FormView, useForm, useFormState } from '#src/react/index.tsx';
import { toZod } from '#src/zod.ts';
import { Canvas } from './Canvas.tsx';
import { Footer, Heading, Nav, Page, REPO } from './chrome.tsx';
import { Code, Json } from './Code.tsx';
import { Playground } from './Playground.tsx';
import {
  account,
  accountSource,
  accountType,
  collections,
  menu,
  menuSource,
  menuValues,
  settings,
  shipping,
  shippingSource,
} from './specs.ts';
import './styles.css';
import './home.css';

const TOC = [
  ['outputs', 'One spec'],
  ['conditions', 'Conditions and checks'],
  ['layouts', 'Layout'],
  ['collections', 'Lists, maps and unions'],
  ['definitions', 'Definitions'],
  ['multi', 'Editing many at once'],
  ['playground', 'Playground'],
  ['interop', 'Interop'],
  ['extend', 'Extending'],
  ['sturdy', 'Robustness'],
  ['start', 'Get started'],
] as const;

function App() {
  const hero = useForm(account, { values: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@' } });
  return (
    <>
      <style>{htmlStyles}</style>
      <Nav />
      <Page toc={TOC}>
        <Hero form={hero} />
        <Outputs />
        <Feature
          id="conditions"
          kicker="Conditions, checks and expressions"
          title="Rules are data, not callbacks"
          text={
            <>
              <code>visible</code>, <code>enabled</code> and <code>required</code> take conditions; labels, defaults and options take
              expressions; <code>checks</code> hold a value to rules over the others. What a condition cannot say, <code>$cel</code> can,
              and <code>$js</code> past that. Pointers without a leading slash are relative, so a definition works wherever it is placed.
              Try picking up instead, or choosing the US.
            </>
          }
          code={<Code code={shippingSource} label="spec.json" />}
          demo={<LiveForm spec={shipping} />}
        />
        <Layouts />
        <Feature
          id="collections"
          kicker="Lists, maps, sets and unions"
          title="Every shape a config takes"
          text={
            <>
              Lists add, remove and reorder by dragging their handle. A record's keys rename in place, keeping each entry where it was. A{' '}
              <code>variant</code> is a discriminated union: pick one, get its fields. Values are real JS values: <code>Map</code>,{' '}
              <code>Set</code>, <code>Date</code>, <code>URL</code>, <code>bigint</code>.
            </>
          }
          demo={<LiveForm spec={collections} />}
          wide
        />
        <Feature
          id="definitions"
          kicker="Definitions"
          title="Reuse a shape, or nest it in itself"
          text={
            <>
              <code>use</code> builds on a built-in preset like <code>percent</code> or <code>email</code>, or on the spec's own
              definitions, which may contain themselves. The checker rejects one whose value could never end, <code>Infer</code> follows the
              recursion, and the form draws only as deep as the values go.
            </>
          }
          code={<Code code={menuSource} label="spec.json" />}
          demo={<LiveForm spec={menu} values={menuValues} />}
          flip
        />
        <section className="section" id="multi">
          <Heading kicker="Editing many at once" title="Select three things, edit what they share">
            <code>commonFields</code> merges several specs into one: bounds tightened, options intersected, differing values marked{' '}
            <em>Mixed</em> until edited. Each edit is written back only where it changed, so what each node has of its own is kept.
          </Heading>
          <Canvas />
        </section>
        <section className="section" id="playground">
          <Heading kicker="Playground" title="A checker that says how to fix it">
            Write a spec, or break one. Faults point at the exact spot and are phrased as the fix, with a "did you mean" where one fits. Try
            the broken example.
          </Heading>
          <Playground />
        </section>
        <Interop form={hero} />
        <Extend />
        <Sturdy />
        <Start />
      </Page>
      <Footer>Every form on this page is drawn by FormView with the example renderers.</Footer>
    </>
  );
}

const HERO_TABS = [
  ['spec', 'account.ts'],
  ['type', 'Infer<typeof account>'],
  ['json', 'values.json'],
] as const;

function Hero({ form }: { form: Form }) {
  const [view, setView] = useState<(typeof HERO_TABS)[number][0]>('spec');
  const { json } = useFormState(form);
  const result = parse(account, json);
  return (
    <header className="hero" id="top">
      <div className="hero-copy">
        <p className="hero-badge">
          <span className="pulse" aria-hidden="true" />
          experimental <span>v{VERSION}</span>
          <span>MIT</span>
        </p>
        <h1>
          Describe a config once.
          <br />
          <span className="accent-text">Get the types, the checks and the form.</span>
          <span className="caret" aria-hidden="true" />
        </h1>
      </div>
      <div className="hero-side">
        <p className="lede">
          fieldspec is a typed, serializable, headless format for configs and the forms that edit them. One JSON document says what the
          values are and how a form for them is drawn. TypeScript, validation, React, JSON Schema, Zod and json-render all read it.
        </p>
        <Install />
        <div className="ctas">
          <a className="button primary" href="#playground">
            Try the playground
          </a>
          <a className="button" href="tutorial.html">
            Take the tutorial
          </a>
          <a className="button" href={REPO}>
            Read the docs
          </a>
        </div>
      </div>
      <div className="window hero-window">
        <div className="window-bar">
          <span className="dots" aria-hidden="true" />
          <div className="tabs" role="tablist">
            {HERO_TABS.map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="window-body">
          <div className="pane pane-code">
            {view === 'json' ? <Json value={json} numbered /> : <Code code={view === 'spec' ? accountSource : accountType} numbered />}
          </div>
          <div className="pane pane-form" data-fieldspec="">
            <p className="pane-label">
              <code>&lt;FormView form=&#123;form&#125; /&gt;</code>
              <span>live</span>
            </p>
            <FormView form={form} renderers={htmlRenderers} />
          </div>
        </div>
        <div className={`status ${result.ok ? 'good' : 'bad'}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          <code>parse(account, json)</code>
          <span className="status-text">{result.ok ? 'ok: true' : result.issues.map((i) => `${i.path} ${i.message}`).join(' · ')}</span>
          <span className="status-meta">
            {Object.keys(account.fields).length} fields · {result.ok ? 0 : result.issues.length} issues
          </span>
        </div>
      </div>
    </header>
  );
}

const INSTALL = ['npm install fieldspec', 'pnpm add fieldspec', 'bun add fieldspec'] as const;

function Install() {
  const [command, setCommand] = useState<(typeof INSTALL)[number]>(INSTALL[0]);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="install">
      <div className="install-tabs" role="tablist" aria-label="Package manager">
        {INSTALL.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={c === command} onClick={() => setCommand(c)}>
            {c.split(' ')[0]}
          </button>
        ))}
      </div>
      <div className="install-line">
        <span className="prompt" aria-hidden="true">
          $
        </span>
        <code>{command}</code>
        <button type="button" onClick={copy}>
          {copied ? 'copied ✓' : 'copy'}
        </button>
      </div>
    </div>
  );
}

const OUTPUTS: readonly [string, string, string][] = [
  ['TypeScript', 'Infer<typeof spec>', 'The value type, inferred through presets, definitions, variants and recursion.'],
  ['Validation', 'parse(spec, json)', 'Typed values, or every issue with a JSON Pointer path and a code.'],
  ['Forms', 'layout(spec)', 'A headless tree any renderer walks. FormView draws it in React with renderers you bring.'],
  ['JSON Schema', 'toJSONSchema(spec)', 'Draft 2020-12, both ways, with x- keywords for what it cannot say.'],
  ['Zod', 'toZod(spec)', "A Zod schema refined with the spec's own conditions and checks. fromZod goes back."],
  ['Standard Schema', 'spec["~standard"]', 'Every defined spec validates wherever Standard Schema is accepted.'],
  ['json-render', 'toJsonRender(spec)', "The whole form for json-render's shadcn components, bound to its state."],
  ['Agents', 'prompt(registry)', 'A system prompt and a meta-schema for structured output, from the registry itself.'],
  ['Translations', 'localize(spec, "de")', "The spec's text in other languages, carried in the spec by JSON Pointer."],
  ['Migrations', 'migrate(spec, json)', 'Values stored by an earlier version, brought forward by the operations the spec carries.'],
];

function Outputs() {
  return (
    <section className="section" id="outputs">
      <Heading kicker="One spec" title="Everything else is derived">
        A spec is plain JSON: store it, send it, diff it, let an agent write it. Behaviour that cannot be JSON is named, and supplied at
        runtime.
      </Heading>
      <div className="pipeline">
        <div className="pipe-source window">
          <div className="window-bar">
            <span className="dots" aria-hidden="true" />
            <span className="window-title">account · spec.json</span>
          </div>
          <ul className="tree">
            {Object.entries(account.fields).map(([name, field]) => (
              <li key={name}>
                <span className="tree-name">{name}</span>
                <span className="tree-kind">{'type' in field ? field.type : field.use}</span>
                <span className="tree-flags">
                  {'required' in field && <span>required</span>}
                  {'render' in field && <span>{field.render}</span>}
                  {'visible' in field && <span>visible if</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <ol className="pipe-outputs">
          {OUTPUTS.map(([title, call, text], i) => (
            <li key={title} style={{ '--i': i } as CSSProperties}>
              <span className="out-name">{title}</span>
              <code>{call}</code>
              <span className="out-text">{text}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Feature({
  id,
  kicker,
  title,
  text,
  code,
  demo,
  flip,
  wide,
}: {
  id: string;
  kicker: string;
  title: string;
  text: ReactNode;
  code?: ReactNode;
  demo: ReactNode;
  flip?: boolean;
  wide?: boolean;
}) {
  return (
    <section className={`section feature ${flip ? 'flip' : ''} ${wide ? 'wide' : ''}`} id={id}>
      <div className="feature-copy">
        <Heading kicker={kicker} title={title}>
          {text}
        </Heading>
        {code}
      </div>
      <div className="feature-demo">{demo}</div>
    </section>
  );
}

function LiveForm({ spec, values, view }: { spec: Parameters<typeof useForm>[0]; values?: unknown; view?: string }) {
  const form = useForm(spec, values === undefined ? undefined : { values });
  return (
    <div className="card form-card" data-fieldspec="">
      <FormView key={view ?? ''} form={form} view={view} renderers={htmlRenderers} />
    </div>
  );
}

const LAYOUTS = [
  [undefined, 'Groups'],
  ['tabs', 'Tabs'],
  ['columns', 'Columns'],
] as const;

function Layouts() {
  const [view, setView] = useState<string | undefined>(undefined);
  const shown =
    view === undefined ? { groups: settings.groups } : { layouts: { [view]: (settings.layouts as Record<string, unknown>)[view] } };
  return (
    <section className="section feature" id="layouts">
      <div className="feature-copy">
        <Heading kicker="Layout" title="Arrangement is part of the spec">
          <code>render</code> is one grammar everywhere: on a field it picks the control, on a group it is the container, and in{' '}
          <code>layouts</code> it arranges the whole form. Rows, columns, tabs, collapsible and scrolling sections are built in. The same
          values, three ways:
        </Heading>
        <div className="seg" role="group" aria-label="Layout">
          {LAYOUTS.map(([v, label]) => (
            <button key={label} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </div>
        <Json value={shown} label="spec.json" className="short" />
      </div>
      <div className="feature-demo">
        <LiveForm spec={settings} view={view} />
      </div>
    </section>
  );
}

const INTEROP = ['JSON Schema', 'Zod', 'json-render', 'Agent prompt'] as const;

function Interop({ form }: { form: Form }) {
  const [tab, setTab] = useState<(typeof INTEROP)[number]>('JSON Schema');
  const { values } = useFormState(form);
  const zod = useMemo(() => toZod(account), []);
  const body = (() => {
    switch (tab) {
      case 'JSON Schema':
        return <Json value={toJSONSchema(account)} />;
      case 'Zod': {
        const r = zod.safeParse(values);
        return (
          <>
            <Code code={`import { toZod } from "fieldspec/zod";\n\nconst schema = toZod(account);\nschema.safeParse(values);`} />
            <Json
              value={
                r.success
                  ? { success: true }
                  : { success: false, issues: r.error.issues.map((i) => ({ path: i.path, message: i.message })) }
              }
              label="safeParse of the hero form's values, live"
            />
          </>
        );
      }
      case 'json-render':
        return <Json value={toJsonRender(account, { values })} />;
      case 'Agent prompt':
        return <Code code={prompt().split('\n').slice(0, 60).join('\n') + '\n…'} />;
    }
  })();
  return (
    <section className="section" id="interop">
      <Heading kicker="Interop" title="Speaks the schemas you already use">
        The account spec from the top of the page, converted live. Edit the form up there and the json-render state and the Zod result
        follow.
      </Heading>
      <div className="card interop">
        <div className="tabs" role="tablist">
          {INTEROP.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="interop-body">{body}</div>
      </div>
    </section>
  );
}

const EXTEND = `const Gradient = defineKind<GradientValue>()({
  name: "Gradient", control: "GradientPicker", check, …
});
const GradientPicker = defineElement({
  name: "GradientPicker", role: "control", kinds: ["Gradient"],
});

const design = createRegistry({
  kinds: [Gradient],
  elements: [GradientPicker],
  presets: { Swatch: { use: "color", render: "color" } },
});

const spec = design.define({
  fields: { backdrop: { type: "Gradient" }, accent: { use: "Swatch" } },
});`;

function Extend() {
  return (
    <section className="section feature flip" id="extend">
      <div className="feature-copy">
        <Heading kicker="Extending" title="Your kinds, your controls, one naming rule">
          Add kinds, elements and presets to a registry; types, checks, JSON Schema and the agent prompt pick them up. Built-in names are
          lowercase and yours are capitalized, so a built-in added later never collides with yours.
        </Heading>
        <table className="names">
          <thead>
            <tr>
              <th />
              <th>Built-in</th>
              <th>Yours</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Kinds</th>
              <td>
                <code>string</code>, <code>variant</code>
              </td>
              <td>
                <code>Gradient</code>
              </td>
            </tr>
            <tr>
              <th>Elements</th>
              <td>
                <code>row</code>, <code>slider</code>
              </td>
              <td>
                <code>GradientPicker</code>
              </td>
            </tr>
            <tr>
              <th>Presets</th>
              <td>
                <code>percent</code>, <code>email</code>
              </td>
              <td>
                <code>Swatch</code>
              </td>
            </tr>
            <tr>
              <th>Definitions</th>
              <td />
              <td>
                <code>Address</code>, <code>Entry</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="feature-demo">
        <Code code={EXTEND} label="design.ts" />
      </div>
    </section>
  );
}

/** [command, its findings as [count, what]]. */
const RUNS: readonly [string, readonly (readonly [string, string])[]][] = [
  [
    'bun run test',
    [
      ['199', "tests, run against json-render's own validators and renderer"],
      ['33', 'specs written to break things: rings of definitions, groups in cycles, renders that place themselves'],
    ],
  ],
  ['bun run stress', [['1,000', 'random specs per stress run, each through every entry point with a time limit']]],
];

function Sturdy() {
  return (
    <section className="section" id="sturdy">
      <Heading kicker="Robustness" title="Wrong specs are reported, not run forever">
        A spec may come from an agent. Every entry point is driven with specs built to loop, explode or overflow: the checker names the
        problem, and nothing hangs.
      </Heading>
      <div className="window terminal">
        <div className="window-bar">
          <span className="dots" aria-hidden="true" />
          <span className="window-title">~/fieldspec</span>
        </div>
        <div className="terminal-body">
          {RUNS.map(([command, findings]) => (
            <div key={command}>
              <p className="term-cmd">
                <span className="prompt">$</span> {command}
              </p>
              {findings.map(([n, text]) => (
                <p key={n} className="term-out">
                  <span className="tick">✓</span>
                  <strong>{n}</strong>
                  <span>{text}</span>
                </p>
              ))}
            </div>
          ))}
          <p className="term-cmd">
            <span className="prompt">$</span> <span className="caret" aria-hidden="true" />
          </p>
        </div>
      </div>
    </section>
  );
}

const START = `import { define, parse } from "fieldspec";
import { FormView, useForm } from "fieldspec/react";
import { htmlRenderers } from "./renderers/html"; // copied from fieldspec's examples/renderers

const settings = define({
  fields: {
    name: { type: "string", required: true },
    theme: { type: "enum", options: ["light", "dark"], render: "segmented" },
  },
});

function Settings({ values }) {
  const form = useForm(settings, { values });
  return <FormView form={form} renderers={htmlRenderers} />;
}`;

function Start() {
  return (
    <section className="section feature" id="start">
      <div className="feature-copy">
        <Heading kicker="Get started" title="Define, parse, draw">
          <code>define</code> checks the spec and keeps its type. <code>parse</code> turns JSON into typed values. <code>FormView</code>{' '}
          draws it with renderers you bring: copy a set from the repository's <code>examples/renderers</code> (plain HTML, DialKit, React
          Aria or shadcn/ui; see them in <a href="examples.html">the examples</a>) and make it yours, or walk <code>layout(spec)</code>{' '}
          yourself.
        </Heading>
        <div className="ctas">
          <a className="button primary" href={REPO}>
            View on GitHub
          </a>
          <a className="button" href="#playground">
            Open the playground
          </a>
        </div>
      </div>
      <div className="feature-demo">
        <Code code={START} label="settings.tsx" />
      </div>
    </section>
  );
}

const host = window as unknown as { __fieldspecSite?: ReturnType<typeof createRoot> };
host.__fieldspecSite ??= createRoot(document.getElementById('root')!);
host.__fieldspecSite.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
