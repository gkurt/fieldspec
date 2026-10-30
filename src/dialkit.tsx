/**
 * DialKit's controls as fieldspec renderers. fieldspec keeps the form (values, conditions,
 * validation, lists, layouts); DialKit draws it: sliders, toggles, selects, colours and text in
 * DialKit's panel style, objects, groups and collapsibles as its folders. Controls DialKit has
 * no counterpart for (lists, records, sets, variants, dates, files) keep fieldspec's own,
 * inside a folder.
 *
 * Use `DialKitView` in place of `FormView`, or `dialkitRenderers` with `FormView` inside your
 * own `dialkit-root`. Import "dialkit/styles.css" once.
 */
import { ColorControl, Folder, SelectControl, Slider, TextControl, Toggle } from "dialkit";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultControl } from "./layout.ts";
import {
  defaultRenderers,
  extendRenderers,
  FormView,
  parserFor,
  useParsedText,
  useRenderer,
  type ElementProps,
  type ElementRenderer,
  type FieldState,
  type Form,
  type Renderers,
  type ResolveRenderer,
} from "./react/index.tsx";

const CONTAINER_KINDS = new Set(["object", "variant", "array", "set", "record", "map"]);

const labelOf = (field: FieldState) => (field.required ? `${field.label} *` : field.label);

/** Editing off: DialKit's controls have no disabled state, so the row is made inert. */
function Row({ disabled, children }: { disabled?: boolean | undefined; children: ReactNode }) {
  return disabled ? (
    <div inert aria-disabled="true" className="fs-dial-disabled">
      {children}
    </div>
  ) : (
    <>{children}</>
  );
}

function Notes({ field }: { field: FieldState }) {
  const help = [field.description, field.hint].filter(Boolean).join(" ");
  const issues = field.showIssues ? field.issues : [];
  if (!help && issues.length === 0) return null;
  return (
    <>
      {help && <div className="fs-dial-help">{help}</div>}
      {issues.length > 0 && (
        <div className="fs-dial-errors" role="alert">
          {issues.map((i) => i.message).join(" ")}
        </div>
      )}
    </>
  );
}

function DialText(p: ElementProps) {
  const field = p.field!;
  const { draft, error, placeholder, change } = useParsedText(p, parserFor(p.form.format, field.decl.type));
  return (
    <Row disabled={p.disabled}>
      <div onBlur={p.touch}>
        <TextControl label={labelOf(field)} value={draft} onChange={change} {...(placeholder !== undefined && { placeholder })} />
      </div>
      {error && <div className="fs-dial-errors">{error}</div>}
    </Row>
  );
}

function DialSlider({ field, disabled, set, touch, props }: ElementProps) {
  const d = field!.decl as { min?: number; max?: number; step?: number; unit?: string };
  const value = typeof field!.value === "number" ? field!.value : (d.min ?? 0);
  // A percent is edited from 0 to 100, as it is shown.
  const k = props.format === "percent" ? 100 : 1;
  const step = d.step ?? (field!.decl.type === "int" ? 1 : undefined);
  return (
    <Row disabled={disabled}>
      <div onPointerUp={touch}>
        <Slider
          label={labelOf(field!)}
          value={value * k}
          min={(d.min ?? 0) * k}
          max={(d.max ?? 100) * k}
          {...(step !== undefined && { step: step * k })}
          {...((k === 100 || d.unit) && { unit: k === 100 ? "%" : d.unit })}
          onChange={(v) => set!(field!.decl.type === "int" ? Math.round(v) : v / k)}
        />
      </div>
    </Row>
  );
}

function DialToggle({ field, disabled, set, touch }: ElementProps) {
  return (
    <Row disabled={disabled}>
      <Toggle
        label={labelOf(field!)}
        checked={!field!.mixed && field!.value === true}
        onChange={(v) => {
          set!(v);
          touch!();
        }}
      />
    </Row>
  );
}

function DialSelect({ field, disabled, set, touch }: ElementProps) {
  const options = field!.options ?? [];
  const index = field!.mixed ? -1 : options.findIndex((o) => Object.is(o.value, field!.value));
  return (
    <Row disabled={disabled}>
      <SelectControl
        label={labelOf(field!)}
        value={String(index)}
        options={options.map((o, i) => ({ value: String(i), label: o.label }))}
        onChange={(v) => {
          set!(options[Number(v)]?.value);
          touch!();
        }}
      />
    </Row>
  );
}

function DialColor({ field, disabled, set, touch }: ElementProps) {
  return (
    <Row disabled={disabled}>
      <ColorControl
        label={labelOf(field!)}
        value={typeof field!.value === "string" && field!.value ? field!.value : "#000000"}
        onChange={(v) => {
          set!(v);
          touch!();
        }}
      />
    </Row>
  );
}

function DialInput(p: ElementProps) {
  return p.props.secret ? defaultRenderers.input!(p) : <DialText {...p} />;
}

/** The renderers that draw with DialKit's controls, which carry their own label. */
const DIAL_RENDERERS = new Set<ElementRenderer>([DialInput, DialText, DialSlider, DialToggle, DialSelect, DialColor]);

/**
 * A field: DialKit's controls carry their own label, so the field adds only its help and
 * issues. A container is a folder; any other control, fieldspec's or one laid over these
 * renderers, keeps fieldspec's frame.
 */
function DialField(p: ElementProps) {
  const field = p.field!;
  const control = p.node.control?.type ?? defaultControl(p.form.format, field.decl);
  const drawer = useRenderer({ element: control, role: "control", explicit: p.node.control?.explicit === true, node: p.node, field, form: p.form });
  if (CONTAINER_KINDS.has(field.decl.type)) {
    return (
      <Folder title={field.label}>
        {p.control!()}
        <Notes field={field} />
      </Folder>
    );
  }
  if (!DIAL_RENDERERS.has(drawer) || (control === "input" && p.node.control?.props?.secret)) return defaultRenderers.field!(p);
  return (
    <div className="fs-dial-field" data-invalid={field.showIssues && field.issues.length > 0 ? "" : undefined}>
      {p.control!()}
      <Notes field={field} />
    </div>
  );
}

/** A container with a title is a folder around the container without it. */
function titled(element: string) {
  return (p: ElementProps) => {
    const plain = defaultRenderers[element]!;
    if (p.props.title === undefined) return plain(p);
    return (
      <Folder title={String(p.props.title)}>
        <div className="fs-dial-column">{plain({ ...p, props: { ...p.props, title: undefined, description: undefined } })}</div>
        {p.props.description !== undefined && <div className="fs-dial-help">{String(p.props.description)}</div>}
      </Folder>
    );
  };
}

/** The default renderers, with DialKit's controls and folders laid over. */
export const dialkitRenderers: Renderers = {
  ...defaultRenderers,
  field: DialField,
  stack: titled("stack"),
  row: titled("row"),
  columns: titled("columns"),
  collapsible: (p) => (
    <Folder title={String(p.props.title ?? "Details")} defaultOpen={!p.props.collapsed}>
      <div className="fs-dial-column">{p.children}</div>
    </Folder>
  ),
  input: DialInput,
  textarea: DialText,
  slider: DialSlider,
  checkbox: DialToggle,
  switch: DialToggle,
  select: DialSelect,
  radio: DialSelect,
  segmented: DialSelect,
  color: DialColor,
};

/** How fieldspec's own pieces sit among DialKit's. */
export const dialkitStyles = `
.dialkit-root .fs-form, .dialkit-root .fs-dial-column { display: flex; flex-direction: column; gap: var(--dial-row-gap); }
.dialkit-root .fs-dial-help { padding: 2px 10px 0; font-size: 11px; color: var(--dial-text-tertiary); }
.dialkit-root .fs-dial-errors { padding: 2px 10px 0; font-size: 11px; color: #ff7b72; }
.dialkit-root[data-theme="light"] .fs-dial-errors { color: #c2362f; }
.dialkit-root .fs-dial-disabled { opacity: 0.45; }
.dialkit-root .fs-field, .dialkit-root .fs-label, .dialkit-root .fs-help { color: var(--dial-text-label); font-size: 12px; }
.dialkit-root .fs-input, .dialkit-root .fs-select, .dialkit-root .fs-textarea {
  background: var(--dial-surface); color: var(--dial-text-primary); border: 1px solid var(--dial-border); border-radius: var(--dial-radius); padding: 6px 10px; font: inherit; font-size: 12px;
}
.dialkit-root .fs-form button:not([class*="dialkit-"]) {
  background: var(--dial-surface); color: var(--dial-text-label); border: 0; border-radius: var(--dial-radius); padding: 6px 10px; font: inherit; font-size: 12px; cursor: pointer;
}
.dialkit-root .fs-form button:not([class*="dialkit-"]):hover { background: var(--dial-surface-hover); color: var(--dial-text-primary); }
.dialkit-root .fs-item { display: flex; gap: 6px; align-items: flex-start; }
.dialkit-root .fs-item > :not(.fs-handle):not(button) { flex: 1; min-width: 0; }
.dialkit-root .fs-handle { color: var(--dial-text-tertiary); padding: 10px 2px; }
`;

export interface DialKitViewProps {
  readonly form: Form<unknown>;
  /** The panel's title. */
  readonly title: string;
  /** A layout from the spec's `layouts`. */
  readonly view?: string;
  /** A function laid over the DialKit renderers; its `next()` is theirs. */
  readonly renderers?: ResolveRenderer;
  /** "system" follows the device. Default "system". */
  readonly theme?: "light" | "dark" | "system";
  readonly className?: string;
}

/** A form drawn as an inline DialKit panel. */
export function DialKitView({ form, title, view, renderers, theme = "system", className }: DialKitViewProps) {
  const resolved = useResolvedTheme(theme);
  const drawn = useMemo(() => (renderers ? extendRenderers(dialkitRenderers, renderers) : dialkitRenderers), [renderers]);
  return (
    <div className={className ? `dialkit-root ${className}` : "dialkit-root"} data-mode="inline" data-theme={resolved}>
      <style>{dialkitStyles}</style>
      <div className="dialkit-panel" data-mode="inline">
        <Folder title={title} isRoot inline>
          <FormView form={form} renderers={drawn} {...(view !== undefined && { view })} />
        </Folder>
      </div>
    </div>
  );
}

function useResolvedTheme(theme: "light" | "dark" | "system"): "light" | "dark" {
  const query = typeof matchMedia === "undefined" ? undefined : matchMedia("(prefers-color-scheme: dark)");
  const [dark, setDark] = useState(query?.matches ?? true);
  useEffect(() => {
    if (!query) return;
    const update = () => setDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [query]);
  return theme === "system" ? (dark ? "dark" : "light") : theme;
}
