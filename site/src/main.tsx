/** fieldspec's homepage. Every form, fault and output on it comes from the library, live. */
import { StrictMode, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { parse, prompt, toJSONSchema, toJsonRender, VERSION, type Form } from "../../src/index.ts";
import { defaultStyles, FormView, useForm, useFormVersion } from "../../src/react/index.tsx";
import { toZod } from "../../src/zod.ts";
import { Canvas } from "./Canvas.tsx";
import { cardSource, DialKitDemo } from "./DialKit.tsx";
import { Footer, Heading, Nav, REPO } from "./chrome.tsx";
import { Code, Json } from "./Code.tsx";
import { Playground } from "./Playground.tsx";
import { account, accountSource, accountType, collections, menu, menuSource, menuValues, settings, shipping, shippingSource } from "./specs.ts";
import "./styles.css";

const LINKS = [
  ["#conditions", "Features"],
  ["tutorial.html", "Tutorial", true],
  ["#playground", "Playground", true],
  ["#interop", "Interop"],
  ["#dialkit", "DialKit"],
  ["models.html", "With AI models", true],
  ["#start", "Get started"],
] as const;

function App() {
  const hero = useForm(account, { values: { firstName: "Ada", lastName: "Lovelace", email: "ada@" } });
  return (
    <>
      <style>{defaultStyles}</style>
      <Nav links={LINKS} />
      <main>
        <Hero form={hero} />
        <Outputs />
        <Feature
          id="conditions"
          kicker="Conditions and expressions"
          title="Rules are data, not callbacks"
          text={
            <>
              <code>visible</code>, <code>enabled</code> and <code>required</code> take conditions; labels, defaults and options take expressions.
              Pointers without a leading slash are relative, so a definition works wherever it is placed. Try picking up instead, or choosing the US.
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
              Lists add, remove and reorder by dragging their handle. A record's keys rename in place, keeping each entry where it was.
              A <code>variant</code> is a discriminated union: pick one, get its fields. Values are real JS values: <code>Map</code>, <code>Set</code>, <code>Date</code>, <code>URL</code>, <code>bigint</code>.
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
              <code>use</code> builds on a built-in preset like <code>percent</code> or <code>email</code>, or on the spec's own definitions, which may contain themselves.
              The checker rejects one whose value could never end, <code>Infer</code> follows the recursion, and the form draws only as deep as the values go.
            </>
          }
          code={<Code code={menuSource} label="spec.json" />}
          demo={<LiveForm spec={menu} values={menuValues} />}
          flip
        />
        <section className="section" id="multi">
          <Heading kicker="Editing many at once" title="Select three things, edit what they share">
            <code>commonFields</code> merges several specs into one: bounds tightened, options intersected, differing values marked <em>Mixed</em> until edited.
            Each edit is written back only where it changed, so what each node has of its own is kept.
          </Heading>
          <Canvas />
        </section>
        <section className="section" id="playground">
          <Heading kicker="Playground" title="A checker that says how to fix it">
            Write a spec, or break one. Faults point at the exact spot and are phrased as the fix, with a "did you mean" where one fits. Try the broken example.
          </Heading>
          <Playground />
        </section>
        <Interop form={hero} />
        <section className="section" id="dialkit">
          <Heading kicker="With DialKit" title="The same spec, as a tuning panel">
            <code>fieldspec/dialkit</code> turns a spec into a <a href="https://github.com/joshpuckett/dialkit">DialKit</a> panel: bounded numbers become sliders, enums
            selects, colours pickers, objects and groups folders. What the panel holds comes back through <code>parse</code>, decoded and checked. Both panels below edit
            the same values; drag either one.
          </Heading>
          <DialKitDemo />
          <Code code={cardSource} label="card.tsx" className="dial-code" />
        </section>
        <Extend />
        <Sturdy />
        <Start />
      </main>
      <Footer>Every form on this page is drawn by fieldspec's own React renderer.</Footer>
    </>
  );
}

function Hero({ form }: { form: Form<unknown> }) {
  const [view, setView] = useState<"spec" | "type">("spec");
  useFormVersion(form);
  const result = parse(account, form.json());
  return (
    <header className="hero" id="top">
      <div className="hero-copy">
        <p className="eyebrow">Experimental · v{VERSION}</p>
        <h1>
          Describe a config once.
          <br />
          <span className="accent-text">Get the types, the checks and the form.</span>
        </h1>
        <p className="lede">
          fieldspec is a typed, serializable, headless format for configs and the forms that edit them. One JSON document says what the values are and how a form for them is drawn.
          TypeScript, validation, React, JSON Schema, Zod and json-render all read it.
        </p>
        <div className="ctas">
          <a className="button primary" href="#playground">Try the playground</a>
          <a className="button" href="tutorial.html">Take the tutorial</a>
          <a className="button" href={REPO}>Read the docs</a>
        </div>
      </div>
      <div className="hero-demo">
        <div className="card code-card">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={view === "spec"} onClick={() => setView("spec")}>account.ts</button>
            <button type="button" role="tab" aria-selected={view === "type"} onClick={() => setView("type")}>Infer&lt;typeof account&gt;</button>
          </div>
          <Code code={view === "spec" ? accountSource : accountType} />
        </div>
        <div className="card form-card hero-form" data-fieldspec="">
          <FormView form={form} />
          <div className={`result ${result.ok ? "good" : "bad"}`}>
            <code>parse(account, json)</code>
            <span>{result.ok ? "ok: true" : result.issues.map((i) => `${i.path} ${i.message}`).join(" · ")}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

const OUTPUTS: readonly [string, string, string][] = [
  ["TypeScript", "Infer<typeof spec>", "The value type, inferred through presets, definitions, variants and recursion."],
  ["Validation", "parse(spec, json)", "Typed values, or every issue with a JSON Pointer path and a code."],
  ["Forms", "layout(spec)", "A headless tree any renderer walks. A React renderer comes with it."],
  ["JSON Schema", "toJSONSchema(spec)", "Draft 2020-12, both ways, with x- keywords for what it cannot say."],
  ["Zod", "toZod(spec)", "A Zod schema refined with the spec's own conditional rules. fromZod goes back."],
  ["Standard Schema", "spec[\"~standard\"]", "Every defined spec validates wherever Standard Schema is accepted."],
  ["json-render", "toJsonRender(spec)", "The whole form for json-render's shadcn components, bound to its state."],
  ["Agents", "prompt(format)", "A system prompt and a meta-schema for structured output, from the format itself."],
];

function Outputs() {
  return (
    <section className="section" id="outputs">
      <Heading kicker="One spec" title="Everything else is derived">
        A spec is plain JSON: store it, send it, diff it, let an agent write it. Behaviour that cannot be JSON is named, and supplied at runtime.
      </Heading>
      <div className="grid">
        {OUTPUTS.map(([title, call, text]) => (
          <article key={title} className="tile">
            <h3>{title}</h3>
            <code>{call}</code>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Feature({ id, kicker, title, text, code, demo, flip, wide }: { id: string; kicker: string; title: string; text: ReactNode; code?: ReactNode; demo: ReactNode; flip?: boolean; wide?: boolean }) {
  return (
    <section className={`section feature ${flip ? "flip" : ""} ${wide ? "wide" : ""}`} id={id}>
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
      <FormView key={view ?? ""} form={form} view={view} />
    </div>
  );
}

const LAYOUTS = [
  [undefined, "Groups"],
  ["tabs", "Tabs"],
  ["columns", "Columns"],
] as const;

function Layouts() {
  const [view, setView] = useState<string | undefined>(undefined);
  const shown = view === undefined ? { groups: settings.groups } : { layouts: { [view]: (settings.layouts as Record<string, unknown>)[view] } };
  return (
    <section className="section feature" id="layouts">
      <div className="feature-copy">
        <Heading kicker="Layout" title="Arrangement is part of the spec">
          <code>render</code> is one grammar everywhere: on a field it picks the control, on a group it is the container, and in <code>layouts</code> it arranges the whole form.
          Rows, columns, tabs, collapsible and scrolling sections are built in. The same values, three ways:
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

const INTEROP = ["JSON Schema", "Zod", "json-render", "Agent prompt"] as const;

function Interop({ form }: { form: Form<unknown> }) {
  const [tab, setTab] = useState<(typeof INTEROP)[number]>("JSON Schema");
  useFormVersion(form);
  const zod = useMemo(() => toZod(account), []);
  const body = (() => {
    switch (tab) {
      case "JSON Schema":
        return <Json value={toJSONSchema(account)} />;
      case "Zod": {
        const r = zod.safeParse(form.values);
        return (
          <>
            <Code code={`import { toZod } from "fieldspec/zod";\n\nconst schema = toZod(account);\nschema.safeParse(values);`} />
            <Json value={r.success ? { success: true } : { success: false, issues: r.error.issues.map((i) => ({ path: i.path, message: i.message })) }} label="safeParse of the hero form's values, live" />
          </>
        );
      }
      case "json-render":
        return <Json value={toJsonRender(account, { values: form.values })} />;
      case "Agent prompt":
        return <Code code={prompt().split("\n").slice(0, 60).join("\n") + "\n…"} />;
    }
  })();
  return (
    <section className="section" id="interop">
      <Heading kicker="Interop" title="Speaks the schemas you already use">
        The account spec from the top of the page, converted live. Edit the form up there and the json-render state and the Zod result follow.
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

const design = createFormat({
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
          Add kinds, elements and presets to a format; types, checks, JSON Schema and the agent prompt pick them up. Built-in names are lowercase and yours are capitalized,
          so a built-in added later never collides with yours.
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
            <tr><th>Kinds</th><td><code>string</code>, <code>variant</code></td><td><code>Gradient</code></td></tr>
            <tr><th>Elements</th><td><code>row</code>, <code>slider</code></td><td><code>GradientPicker</code></td></tr>
            <tr><th>Presets</th><td><code>percent</code>, <code>email</code></td><td><code>Swatch</code></td></tr>
            <tr><th>Definitions</th><td /><td><code>Address</code>, <code>Entry</code></td></tr>
          </tbody>
        </table>
      </div>
      <div className="feature-demo">
        <Code code={EXTEND} label="design.ts" />
      </div>
    </section>
  );
}

const STATS: readonly [string, string][] = [
  ["168", "tests, run against json-render's own validators and renderer"],
  ["33", "specs written to break things: rings of definitions, groups in cycles, renders that place themselves"],
  ["1,000", "random specs per stress run, each through every entry point with a time limit"],
];

function Sturdy() {
  return (
    <section className="section" id="sturdy">
      <Heading kicker="Robustness" title="Wrong specs are reported, not run forever">
        A spec may come from an agent. Every entry point is driven with specs built to loop, explode or overflow: the checker names the problem, and nothing hangs.
      </Heading>
      <div className="stats">
        {STATS.map(([n, text]) => (
          <div key={n} className="stat">
            <strong>{n}</strong>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const START = `import { define, parse } from "fieldspec";
import { FormView, useForm, defaultStyles } from "fieldspec/react";

const settings = define({
  fields: {
    name: { type: "string", required: true },
    theme: { type: "enum", options: ["light", "dark"], render: "segmented" },
  },
});

function Settings({ values }) {
  const form = useForm(settings, { values });
  return <FormView form={form} />;
}`;

function Start() {
  return (
    <section className="section feature" id="start">
      <div className="feature-copy">
        <Heading kicker="Get started" title="Define, parse, draw">
          <code>define</code> checks the spec and keeps its type. <code>parse</code> turns JSON into typed values. <code>FormView</code> draws the form; or walk <code>layout(spec)</code> with a renderer of your own.
        </Heading>
        <div className="ctas">
          <a className="button primary" href={REPO}>View on GitHub</a>
          <a className="button" href="#playground">Open the playground</a>
        </div>
      </div>
      <div className="feature-demo">
        <Code code={START} label="settings.tsx" />
      </div>
    </section>
  );
}

const host = window as unknown as { __fieldspecSite?: ReturnType<typeof createRoot> };
host.__fieldspecSite ??= createRoot(document.getElementById("root")!);
host.__fieldspecSite.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
