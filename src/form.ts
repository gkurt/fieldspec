/**
 * The headless form: values, what each field currently is (visible, enabled, required, its
 * evaluated label and options, its issues), edits and patches, and change notification.
 * Renderers for any framework subscribe to it and draw a {@link LayoutNode} tree with it.
 */
import { evaluate, test, type Env, type Functions, type Scope } from "./expr.ts";
import { formatOf, functionsOf, type Format } from "./format.ts";
import type { Infer } from "./infer.ts";
import { optionsOf } from "./kinds.ts";
import { layout, type LayoutNode } from "./layout.ts";
import { applyPatch, type PatchOp } from "./patch.ts";
import { getAt, joinPointer, parsePointer, setAt, splitPointer } from "./pointer.ts";
import type { Condition, EnumField, Expr, FieldDecl, GroupDecl, Issue, Json, Resolved, Result, Spec, Text } from "./types.ts";
import { declAt, decode, decodeField, encode, initialValue, resolve, validate } from "./values.ts";

export interface FieldOption {
  readonly value: unknown;
  readonly label: string;
  readonly description?: string;
}

/** A field as it is right now. */
export interface FieldState {
  readonly path: string;
  readonly key: string;
  readonly decl: Resolved;
  readonly value: unknown;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly required: boolean;
  readonly readOnly: boolean;
  readonly label: string;
  readonly description?: string;
  readonly hint?: string;
  readonly placeholder?: string;
  /** For enums: the options, evaluated, hidden ones left out. */
  readonly options?: readonly FieldOption[];
  readonly issues: readonly Issue[];
  /** Whether to show the issues yet: after the field is touched or the form submitted. */
  readonly showIssues: boolean;
  /** The values it stands for differ (see {@link FormOptions.mixed}) and it has not been edited since. */
  readonly mixed: boolean;
  /** Where the field's own expressions are evaluated. */
  readonly scope: Scope;
}

export interface FormOptions {
  readonly values?: unknown;
  readonly format?: Format;
  readonly fns?: Functions;
  /**
   * Pointers whose value differs between the things the form edits at once, as
   * `commonFields` gives them. A field is mixed until it, or a field in or around it, is edited.
   */
  readonly mixed?: readonly string[];
}

export interface Form<V = unknown> {
  readonly spec: Spec;
  readonly format: Format;
  readonly values: V;
  readonly issues: readonly Issue[];
  /** Bumps on every change; cheap to compare. */
  readonly version: number;
  readonly submitted: boolean;
  get(path: string): unknown;
  set(path: string, value: unknown): void;
  touch(path: string): void;
  /** Apply a JSON Patch whose values are JSON; they are decoded against the spec. Throws on a bad op. */
  apply(patch: readonly PatchOp[]): void;
  reset(values?: unknown): void;
  field(path: string): FieldState | undefined;
  /** A new item at the end of a list (or a given value). */
  addItem(path: string, value?: unknown): void;
  removeItem(path: string): void;
  moveItem(path: string, from: number, to: number): void;
  test(condition: Condition | undefined, scope: Scope): boolean;
  evaluate(expr: Expr | undefined, scope: Scope): unknown;
  text(text: Text | undefined, scope: Scope): string | undefined;
  layout(view?: string): LayoutNode;
  /** Mark the form submitted and validate it. */
  submit(): Result<V>;
  /** The values as JSON. */
  json(): Json;
  subscribe(listener: () => void): () => void;
}

/** "firstName" → "First name": a label for fields that do not give one. */
export function humanize(key: string): string {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function createForm<S extends Spec>(spec: S, options: FormOptions = {}): Form<Infer<S>> {
  const format = options.format ?? formatOf(spec);
  const fns = options.fns ?? functionsOf(spec);
  const vo = { format, fns, defs: spec.defs };
  const listeners = new Set<() => void>();
  const touched = new Set<string>();
  const mixed = new Set(options.mixed);
  const edited = new Set<string>();
  const isMixed = (path: string) =>
    mixed.has(path) && ![...edited].some((e) => e === path || e.startsWith(`${path}/`) || path.startsWith(`${e}/`));
  const layouts = new Map<string, LayoutNode>();
  let values = resolve(spec, decode(spec, options.values ?? {}, vo), vo);
  let issues: Issue[] | undefined;
  let issuesByPath: Map<string, Issue[]> | undefined;
  let fieldCache = new Map<string, FieldState | undefined>();
  let version = 0;
  let submitted = false;

  const env = (): Env => ({ values, fns });
  const changed = () => {
    version++;
    issues = undefined;
    issuesByPath = undefined;
    fieldCache = new Map();
    for (const listener of listeners) listener();
  };
  const commit = (next: unknown) => {
    values = resolve(spec, next, vo);
    changed();
  };
  const currentIssues = () => (issues ??= validate(spec, values, vo));
  const safeTest = (condition: Condition | undefined, scope: Scope) => {
    try {
      return test(condition, env(), scope);
    } catch {
      return true;
    }
  };
  const text = (t: Text | undefined, scope: Scope): string | undefined => {
    if (t === undefined) return undefined;
    try {
      const v = evaluate(t as Expr, env(), scope);
      return v === undefined || v === null ? undefined : String(v);
    } catch {
      return undefined;
    }
  };

  /** Whether a field's group chain is visible, in the scope it is declared in. */
  const groupsVisible = (groups: { readonly [id: string]: GroupDecl } | undefined, id: string | undefined, scope: Scope) => {
    const seen = new Set<string>();
    while (id !== undefined && groups?.[id] && !seen.has(id)) {
      seen.add(id);
      if (!safeTest(groups[id]!.visible, scope)) return false;
      id = groups[id]!.group;
    }
    return true;
  };

  const computeField = (path: string): FieldState | undefined => {
    const located = declAt(spec, values, path, format);
    if (!located) return undefined;
    const { decl, scope, groups } = located;
    const [parent, key] = splitPointer(path);
    const parentState = parent === "" ? undefined : form.field(parent);
    const ownVisible = safeTest(decl.visible, scope) && groupsVisible(groups, decl.group, scope);
    const visible = (parentState?.visible ?? true) && ownVisible;
    const enabled = (parentState?.enabled ?? true) && safeTest(decl.enabled, scope);
    const label = text(decl.label, scope) ?? (/^\d+$/.test(key) ? `#${Number(key) + 1}` : humanize(key));
    let fieldOptions: FieldOption[] | undefined;
    if (decl.type === "enum") {
      fieldOptions = optionsOf(decl as EnumField, env(), scope)
        .filter((o) => safeTest(o.visible, scope))
        .map((o) => ({
          value: o.value,
          label: text(o.label, scope) ?? String(o.value),
          ...(o.description !== undefined && { description: text(o.description, scope) }),
        }));
    }
    if (!issuesByPath) {
      issuesByPath = new Map();
      for (const issue of currentIssues()) {
        const list = issuesByPath.get(issue.path);
        if (list) list.push(issue);
        else issuesByPath.set(issue.path, [issue]);
      }
    }
    const own = issuesByPath.get(path) ?? [];
    return {
      path,
      key,
      decl,
      value: getAt(values, path),
      visible,
      enabled,
      required: decl.required !== undefined && safeTest(decl.required, scope),
      readOnly: decl.readOnly === true || (parentState?.readOnly ?? false),
      label,
      description: text(decl.description, scope),
      hint: text(decl.hint, scope),
      placeholder: text(decl.placeholder, scope),
      ...(fieldOptions && { options: fieldOptions }),
      issues: own,
      showIssues: submitted || touched.has(path),
      mixed: isMixed(path),
      scope,
    };
  };

  const decodeAt = (path: string, value: unknown): unknown => {
    const [parent, last] = splitPointer(path);
    const target = last === "-" ? joinPointer(parent, 0) : path;
    let located = declAt(spec, values, target, format);
    if (!located && last === "-") {
      // An empty list has no item 0 yet; its items declaration is what we want.
      const list = declAt(spec, values, parent, format);
      if (list && "items" in list.decl) return decodeField(vo, list.decl.items as FieldDecl, value);
    }
    return located ? decodeField(vo, located.decl, value) : value;
  };

  const form: Form<Infer<S>> = {
    spec,
    format,
    get values() {
      return values as Infer<S>;
    },
    get issues() {
      return currentIssues();
    },
    get version() {
      return version;
    },
    get submitted() {
      return submitted;
    },
    get: (path) => getAt(values, path),
    set(path, value) {
      touched.add(path);
      edited.add(path);
      commit(setAt(values, path, value));
    },
    touch(path) {
      if (touched.has(path)) return;
      touched.add(path);
      changed();
    },
    apply(patch) {
      const decoded = patch.map((op) => ("value" in op ? { ...op, value: decodeAt(op.path, op.value) } : op)) as PatchOp[];
      for (const op of patch) edited.add(op.path);
      commit(applyPatch(values, decoded));
    },
    reset(next) {
      touched.clear();
      edited.clear();
      submitted = false;
      values = resolve(spec, decode(spec, next ?? {}, vo), vo);
      changed();
    },
    field(path) {
      if (!fieldCache.has(path)) fieldCache.set(path, computeField(path));
      return fieldCache.get(path);
    },
    addItem(path, value) {
      const list = getAt(values, path);
      const located = declAt(spec, values, path, format);
      if (!located) return;
      const decl = located.decl;
      if (decl.type === "set") {
        const set = new Set(list instanceof Set ? list : []);
        set.add(value);
        return form.set(path, set);
      }
      if (decl.type !== "array") return;
      const items = Array.isArray(list) ? list : [];
      const at = joinPointer(path, items.length);
      const item = value !== undefined ? value : initialValue(spec, decl.items as FieldDecl, values, at, vo);
      form.set(path, [...items, item]);
    },
    removeItem(path) {
      const [parent, last] = splitPointer(path);
      const list = getAt(values, parent);
      if (list instanceof Set) {
        const set = new Set(list);
        set.delete([...list][Number(last)]);
        return form.set(parent, set);
      }
      touched.add(parent);
      edited.add(parent);
      commit(setAt(values, path, undefined));
    },
    moveItem(path, from, to) {
      const list = getAt(values, path);
      if (!Array.isArray(list) || to < 0 || to >= list.length) return;
      const copy = list.slice();
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      form.set(path, copy);
    },
    test: safeTest,
    evaluate(expr, scope) {
      try {
        return evaluate(expr, env(), scope);
      } catch {
        return undefined;
      }
    },
    text,
    layout(view) {
      const key = view ?? "";
      if (!layouts.has(key)) layouts.set(key, layout(spec, view));
      return layouts.get(key)!;
    },
    submit() {
      submitted = true;
      changed();
      const found = currentIssues();
      return (found.length === 0 ? { ok: true, value: values, issues: [] } : { ok: false, value: values, issues: found }) as unknown as Result<Infer<S>>;
    },
    json: () => encode(spec, values, vo),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return form;
}

export { parsePointer };
