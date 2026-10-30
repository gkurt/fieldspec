/**
 * DialKit interop. `toDialKit` turns a spec into a DialKit panel config: numbers with bounds
 * become sliders, booleans toggles, enums selects, colours colour pickers, other text-valued
 * kinds text fields, objects and groups folders. `read` turns the panel's values back into the
 * spec's, through `parse`, so they come back decoded and checked. `useDialSpec` does both in a
 * React component.
 *
 * DialKit tunes values; it has no lists, unions or conditions. Fields it cannot show are listed
 * in `dropped` and keep the values they had. Conditions are not applied to the panel: every
 * field shows, and `read` still checks them.
 */
import { useMemo } from "react";
import { useDialKitController, type DialConfig, type DialKitController, type DialKitValueUpdates, type UseDialOptions } from "dialkit";
import type { Dropped } from "./common.ts";
import { deref, type Lookup } from "./defs.ts";
import { createForm } from "./form.ts";
import { formatOf, type Format } from "./format.ts";
import type { Infer } from "./infer.ts";
import { defaultControl } from "./layout.ts";
import { escapeSegment, getAt, setAt } from "./pointer.ts";
import type { EnumField, FieldDecl, GroupDecl, Json, NumberField, ObjectField, OptionValue, RenderNode, Resolved, Result, Spec } from "./types.ts";
import { encode, parse, type ValueOptions } from "./values.ts";

export interface ToDialKitOptions extends ValueOptions {
  /** The values the panel starts from; the spec's defaults otherwise. */
  readonly values?: unknown;
  /** Draw groups as folders. Default true. */
  readonly folders?: boolean;
}

export interface DialKitPanel<S extends Spec = Spec> {
  /** What `useDialKit` and `useDialKitController` take. */
  readonly config: DialConfig;
  /** Fields left out of the panel, at pointers into the values, and why. */
  readonly dropped: readonly Dropped[];
  /**
   * The spec's values from the panel's: decoded, defaulted and checked. Fields the panel does
   * not show are taken from `base` (JSON, as `encode` gives it), or the values it started from.
   */
  read(dial: unknown, base?: Json): Result<Infer<S>>;
  /** The spec's values as an update for the panel: `controller.setValues(panel.updates(values))`. */
  updates(values: unknown): DialKitValueUpdates<DialConfig>;
}

/** A panel control and the value it edits. */
interface Leaf {
  readonly dial: readonly string[];
  readonly pointer: string;
  readonly kind: "number" | "int" | "boolean" | "enum" | "text";
  readonly options?: readonly OptionValue[];
  readonly optional: boolean;
}

interface Cx {
  readonly format: Format;
  readonly lookup: Lookup;
  readonly folders: boolean;
  readonly leaves: Leaf[];
  readonly dropped: Dropped[];
  readonly json: Json;
}

/** Kinds whose JSON is a string, edited as text. */
const TEXT_KINDS = new Set(["string", "url", "date", "bigint", "regexp"]);

export function toDialKit<S extends Spec>(spec: S, options: ToDialKitOptions = {}): DialKitPanel<S> {
  const format = options.format ?? formatOf(spec);
  const json = createForm(spec, { values: options.values, format, ...(options.fns && { fns: options.fns }) }).json();
  const cx: Cx = { format, lookup: { defs: spec.defs, presets: format.presets }, folders: options.folders ?? true, leaves: [], dropped: [], json };
  const config = scope(cx, spec.fields, spec.groups, "", []);
  const { leaves } = cx;

  return {
    config,
    dropped: cx.dropped,
    read(dial, base = json) {
      let values: unknown = base;
      for (const leaf of leaves) {
        const raw = valueAt(dial, leaf.dial);
        if (raw === undefined) continue;
        values = setAt(values, leaf.pointer, fromDial(leaf, raw));
      }
      return parse(spec, values, options);
    },
    updates(values) {
      const encoded = encode(spec, values, options);
      const out: Record<string, unknown> = {};
      for (const leaf of leaves) {
        const value = toDial(leaf, getAt(encoded, leaf.pointer));
        if (value !== undefined) place(out, leaf.dial, value);
      }
      return out as DialKitValueUpdates<DialConfig>;
    },
  };
}

export interface UseDialSpecOptions extends ToDialKitOptions, UseDialOptions {}

/**
 * A DialKit panel for a spec, in a React component. Returns `parse`'s result for what the panel
 * holds, the panel, and DialKit's controller for setting values from code. The spec is read
 * once, when the component mounts.
 */
export function useDialSpec<S extends Spec>(
  name: string,
  spec: S,
  options: UseDialSpecOptions = {},
): Result<Infer<S>> & { readonly panel: DialKitPanel<S>; readonly dial: DialKitController<DialConfig> } {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const panel = useMemo(() => toDialKit(spec, options), []);
  const dial = useDialKitController(name, panel.config, options);
  return { ...panel.read(dial.values), panel, dial };
}

// ── Building the config ──────────────────────────────────────────────────────────────────

function scope(cx: Cx, fields: ObjectField["fields"], groups: ObjectField["groups"], pointer: string, dial: readonly string[]): DialConfig {
  const out: DialConfig = {};
  const folders = new Map<string, { config: DialConfig; dial: readonly string[] }>();
  const entries = Object.entries(fields)
    .map(([key, decl], i) => ({ key, decl: deref(cx.lookup, decl), i }))
    .sort((a, b) => (a.decl.order ?? 0) - (b.decl.order ?? 0) || a.i - b.i);

  for (const { key, decl } of entries) {
    const at = `${pointer}/${escapeSegment(key)}`;
    let target = out;
    let path = dial;
    const group = cx.folders && decl.group !== undefined ? groups?.[decl.group] : undefined;
    if (group && decl.group !== undefined) {
      let folder = folders.get(decl.group);
      if (!folder) {
        const name = nameOf(out, group.label, decl.group);
        if (name === undefined) {
          cx.dropped.push({ path: at, reason: `is in group "${decl.group}", whose name is taken in the panel` });
          continue;
        }
        const config: DialConfig = collapsed(group.render) ? { _collapsed: true } : {};
        out[name] = config;
        folder = { config, dial: [...dial, name] };
        folders.set(decl.group, folder);
      }
      target = folder.config;
      path = folder.dial;
    }
    field(cx, key, decl, target, at, path);
  }
  return out;
}

function field(cx: Cx, key: string, decl: Resolved, out: DialConfig, at: string, dial: readonly string[]) {
  const name = nameOf(out, decl.label, key);
  if (name === undefined) return void cx.dropped.push({ path: at, reason: "has a name the panel already uses, or one with a dot" });
  const path = [...dial, name];
  const value = getAt(cx.json, at);
  const optional = decl.optional === true;
  const leaf = (kind: Leaf["kind"], options?: readonly OptionValue[]) => cx.leaves.push({ dial: path, pointer: at, kind, optional, ...(options && { options }) });

  switch (decl.type) {
    case "object": {
      if (value === undefined) return void cx.dropped.push({ path: at, reason: "is absent, and the panel cannot add it" });
      const o = decl as ObjectField;
      const config = scope(cx, o.fields, o.groups, at, path);
      out[name] = collapsed(decl.render) ? { _collapsed: true, ...config } : config;
      return;
    }
    case "boolean":
      out[name] = value === true;
      return leaf("boolean");
    case "int":
    case "number": {
      const { min, max, step } = decl as NumberField;
      const start = typeof value === "number" ? value : (min ?? 0);
      const by = step ?? (decl.type === "int" ? 1 : undefined);
      // Without both bounds DialKit picks a range around the value.
      out[name] = min === undefined || max === undefined ? start : by === undefined ? [start, min, max] : [start, min, max, by];
      return leaf(decl.type);
    }
    case "enum": {
      const options = (decl as EnumField).options;
      if (!Array.isArray(options)) return void cx.dropped.push({ path: at, reason: "has options that depend on other values" });
      const values = options.map((o: OptionValue | { value: OptionValue }) => (typeof o === "object" ? o.value : o));
      const labelled = options.map((o: OptionValue | { value: OptionValue; label?: unknown }) =>
        typeof o === "object" ? { value: String(o.value), label: typeof o.label === "string" ? o.label : String(o.value) } : String(o),
      );
      out[name] = { type: "select", options: labelled, default: String(value ?? values[0]) };
      return leaf("enum", values);
    }
  }
  if (typeof value === "string" || (value === undefined && TEXT_KINDS.has(decl.type))) {
    const text = typeof value === "string" ? value : "";
    if (controlOf(cx.format, decl) === "color") out[name] = { type: "color", default: text };
    else out[name] = { type: "text", default: text, ...(typeof decl.placeholder === "string" && { placeholder: decl.placeholder }) };
    return leaf("text");
  }
  cx.dropped.push({ path: at, reason: `is ${article(decl.type)} ${decl.type}, which the panel has no control for` });
}

/**
 * The key a control is listed under. DialKit labels a control by its key, so a field's own
 * label is used where DialKit would print it as written, and the field's key otherwise.
 */
function nameOf(out: DialConfig, label: unknown, key: string): string | undefined {
  for (const name of [typeof label === "string" ? label : undefined, key]) {
    if (name && name !== "_collapsed" && !name.includes(".") && !(name in out) && (name === key || dialLabel(name) === name)) return name;
  }
  return undefined;
}

/** How DialKit prints a key as a label. */
function dialLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
}

function controlOf(format: Format, decl: Resolved): string {
  const render = decl.render as RenderNode | undefined;
  const name = typeof render === "string" ? render : render && "type" in render ? render.type : undefined;
  return name !== undefined && format.elements.get(name)?.role === "control" ? name : defaultControl(format, decl);
}

function collapsed(render: RenderNode | GroupDecl["render"] | FieldDecl["render"] | undefined): boolean {
  return typeof render === "object" && render !== null && "type" in render && render.type === "collapsible" && (render.props as { collapsed?: unknown } | undefined)?.collapsed === true;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

// ── Moving values ────────────────────────────────────────────────────────────────────────

function fromDial(leaf: Leaf, raw: unknown): unknown {
  switch (leaf.kind) {
    case "int":
      return typeof raw === "number" ? Math.round(raw) : raw;
    case "enum":
      return leaf.options?.find((o) => String(o) === raw) ?? raw;
    case "text":
      return raw === "" && leaf.optional ? undefined : raw;
    default:
      return raw;
  }
}

function toDial(leaf: Leaf, value: unknown): unknown {
  if (value === undefined) return leaf.kind === "text" ? "" : undefined;
  return leaf.kind === "enum" ? String(value) : value;
}

function valueAt(values: unknown, path: readonly string[]): unknown {
  let node = values;
  for (const key of path) node = node !== null && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined;
  return node;
}

function place(out: Record<string, unknown>, path: readonly string[], value: unknown) {
  let node = out;
  for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>;
  node[path[path.length - 1]!] = value;
}
