import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { checkSpec, formatFaults, prompt, SCHEMA_URL, toJSONSchema, toJsonRender } from "../../src/index.ts";
import { defaultStyles, defineRenderers, FormView, useForm, useFormVersion, type ControlProps } from "../../src/react/index.tsx";
import { design, type GradientValue } from "../../examples/design.ts";
import { JsonTree, jsonTreeStyles } from "./JsonTree.tsx";
import { Selection, selectionStyles } from "./Selection.tsx";

const spec = design.define(
  {
    $schema: SCHEMA_URL,
    title: "Workspace",
    fields: {
      firstName: { type: "string", label: "First name", group: "name", placeholder: "Ada" },
      lastName: { type: "string", label: "Last name", group: "name", placeholder: "Lovelace" },
      email: { use: "email", required: true, hint: "We send the invoice here." },
      plan: {
        type: "enum",
        options: [
          { value: "free", label: "Free" },
          { value: "pro", label: "Pro" },
          { value: "team", label: "Team" },
        ],
        default: "free",
        render: "segmented",
      },
      seats: {
        type: "int",
        min: 1,
        max: 50,
        default: 5,
        render: "slider",
        visible: { $state: "plan", eq: "team" },
        label: { $template: "Seats for ${/firstName}" },
      },
      renews: { type: "date", optional: true, visible: { $state: "plan", neq: "free" } },
      accent: { use: "Swatch", group: "look" },
      backdrop: { type: "Gradient", group: "look", default: { from: "#3b82f6", to: "#9333ea", angle: 135, shape: "linear" } },
      density: { use: "percent", default: 0.5, group: "look" },
      notify: { type: "set", label: "Notify me about", items: { type: "enum", options: [{ value: "billing", label: "Billing" }, { value: "security", label: "Security" }, { value: "product", label: "Product news" }] } },
      auth: {
        type: "variant",
        key: "method",
        label: "Sign-in",
        variants: {
          password: { label: "Password", fields: { minLength: { type: "int", label: "Minimum length", min: 8, max: 64, default: 12 } } },
          sso: { label: "Single sign-on", fields: { issuer: { type: "url", protocols: ["https:"] }, domains: { type: "array", items: { type: "string" } } } },
        },
      },
      menu: { use: "Entry", label: "Navigation menu", default: { label: "Home", kind: "folder" } },
      headers: { type: "record", label: "Request headers", values: { type: "string" }, group: "delivery", default: { "X-Team": "core", Accept: "application/json" } },
      webhooks: {
        type: "array",
        label: "Webhooks",
        group: "delivery",
        default: [
          { url: "https://hooks.example.com/billing", events: "billing" },
          { url: "https://hooks.example.com/all", events: "all" },
          { url: "https://hooks.example.com/audit", events: "all" },
        ],
        items: {
          type: "object",
          fields: {
            url: { type: "url", label: "URL", protocols: ["https:"] },
            events: { type: "enum", options: ["all", "billing"], default: "all", group: "opts" },
            secret: { use: "password", optional: true, group: "opts", visible: { $item: "events", eq: "billing" } },
          },
          groups: { opts: { render: "row" } },
        },
      },
    },
    defs: {
      // A menu entry: a link, or a folder of entries. Recursive through `children`.
      Entry: {
        type: "object",
        fields: {
          label: { type: "string", required: true, group: "head" },
          kind: { type: "enum", options: [{ value: "link", label: "Link" }, { value: "folder", label: "Folder" }], default: "link", group: "head" },
          url: { type: "url", label: "URL", optional: true, visible: { $state: "kind", eq: "link" } },
          // Shown only when the folder this entry sits in allows new tabs: ../.. climbs past the list to that folder.
          newTab: { type: "boolean", label: "Open in a new tab", render: "switch", visible: [{ $state: "kind", eq: "link" }, { $state: "../../allowNewTabs", eq: true }] },
          allowNewTabs: { type: "boolean", label: "Let links here open in new tabs", render: "switch", visible: { $state: "kind", eq: "folder" } },
          children: { type: "array", label: "Entries", items: { use: "Entry" }, visible: { $state: "kind", eq: "folder" } },
        },
        groups: { head: { render: "row" } },
      },
    },
    groups: {
      name: { label: "Name", render: "row" },
      look: { label: "Look", render: { type: "collapsible", props: { collapsed: false } } },
      // Past 18rem, the delivery settings scroll inside their box.
      delivery: { label: "Delivery", render: { type: "scroll", props: { maxHeight: "18rem" } } },
    },
    layouts: {
      tabs: {
        type: "tabs",
        children: [
          { type: "stack", props: { title: "Profile" }, children: [{ group: "name" }, { field: "email" }, { field: "notify" }] },
          { type: "stack", props: { title: "Billing" }, children: [{ field: "plan" }, { field: "seats" }, { field: "renews" }] },
          { type: "stack", props: { title: "Advanced" }, children: [{ type: "rest" }] },
        ],
      },
    },
  },
);

/** The design pack's own control element, drawn by the app. */
function GradientPicker({ field, disabled, set, props }: ControlProps) {
  const g = field.value as GradientValue;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ width: 120, height: 28, borderRadius: 6, background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }} />
      <input type="color" aria-label="From" value={g.from} disabled={disabled} onChange={(e) => set({ ...g, from: e.target.value })} />
      <input type="color" aria-label="To" value={g.to} disabled={disabled} onChange={(e) => set({ ...g, to: e.target.value })} />
      {props.angle !== false && (
        <input type="range" aria-label="Angle" min={0} max={360} value={g.angle} disabled={disabled} onChange={(e) => set({ ...g, angle: Number(e.target.value) })} />
      )}
    </div>
  );
}

const renderers = defineRenderers({ GradientPicker });

const TABS = ["Values", "Spec", "JSON Schema", "json-render", "Prompt"] as const;

function App() {
  const [page, setPage] = useState<"form" | "selection">("form");
  return (
    <main>
      <style>{defaultStyles + jsonTreeStyles + selectionStyles + pageStyles}</style>
      <header>
        <h1>fieldspec</h1>
        <div role="group" aria-label="Page">
          <button type="button" aria-pressed={page === "form"} onClick={() => setPage("form")}>One form</button>
          <button type="button" aria-pressed={page === "selection"} onClick={() => setPage("selection")}>Multi-select</button>
        </div>
      </header>
      {page === "form" ? <Workspace /> : <Selection />}
    </main>
  );
}

function Workspace() {
  const form = useForm(spec);
  useFormVersion(form);
  const [view, setView] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Values");
  const faults = useMemo(() => checkSpec(spec), []);
  const output = (() => {
    switch (tab) {
      case "Values":
        return <JsonTree key="values" value={{ values: form.json(), issues: form.issues }} depth={3} />;
      case "Spec":
        return <JsonTree key="spec" value={JSON.parse(JSON.stringify(spec))} />;
      case "JSON Schema":
        return <JsonTree key="schema" value={toJSONSchema(spec)} />;
      case "json-render":
        return <JsonTree key="json-render" value={toJsonRender(spec, { values: form.json() })} />;
      case "Prompt":
        return <pre>{prompt(design)}</pre>;
    }
  })();
  return (
    <>
      <div role="group" aria-label="Layout" className="chips">
        <button type="button" aria-pressed={view === undefined} onClick={() => setView(undefined)}>Default layout</button>
        <button type="button" aria-pressed={view === "tabs"} onClick={() => setView("tabs")}>“tabs” layout</button>
      </div>
      {faults.length > 0 && <pre className="faults">{formatFaults(faults).join("\n")}</pre>}
      <div className="split">
        <section className="pane" data-fieldspec="">
          <FormView key={view ?? "default"} form={form} view={view} renderers={renderers} />
          <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => form.submit()}>Save</button>
            <span className="status">{form.submitted ? (form.issues.length ? `${form.issues.length} to fix` : "Saved") : ""}</span>
          </div>
        </section>
        <section className="pane output">
          <div role="tablist">
            {TABS.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
          <div className="output-body">{output}</div>
        </section>
      </div>
    </>
  );
}

const pageStyles = `
:root { color-scheme: light dark; --bg: #fafafa; --fg: #18181b; --pane: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #111113; --fg: #e4e4e7; --pane: #18181b; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 16px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 1.25rem; margin: 8px 0; }
header button[aria-pressed="true"] { background: color-mix(in srgb, currentColor 12%, transparent); }
.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 860px) { .split { grid-template-columns: minmax(0, 1fr); } }
.pane { background: var(--pane); border-radius: 12px; padding: 16px; border: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
.output pre { font-size: 12px; overflow: auto; max-height: 75vh; margin: 12px 0 0; white-space: pre-wrap; word-break: break-word; }
.output-body { margin-top: 12px; }
.output [role="tablist"] { display: flex; gap: 4px; flex-wrap: wrap; }
.output button, header button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; color: inherit; cursor: pointer; }
.output [aria-selected="true"] { background: color-mix(in srgb, currentColor 12%, transparent); }
.faults { color: #d14343; }
.status { font-size: 0.875rem; opacity: 0.8; }
`;

// One root across hot reloads, which re-run this module.
const host = window as unknown as { __fieldspecRoot?: ReturnType<typeof createRoot> };
host.__fieldspecRoot ??= createRoot(document.getElementById("root")!);
host.__fieldspecRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
