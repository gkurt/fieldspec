/**
 * Values against a spec: from JSON and back, defaults, and validation. `parse` is the one most
 * callers want: JSON (or already-decoded values) in, typed values or issues with paths out.
 */
import { evaluate, isDynamic, test, type Env, type Functions, type Scope } from "./expr.ts";
import { formatOf, functionsOf, type Format } from "./format.ts";
import type { Infer } from "./infer.ts";
import { CONTAINER_KINDS, isJson, type AnyKind } from "./kinds.ts";
import { deref, requiresItself, usedName, type Lookup } from "./defs.ts";
import { child, getAt, joinPointer, setAt } from "./pointer.ts";
import type {
  ArrayField,
  Condition,
  FieldDecl,
  GroupDecl,
  Issue,
  Json,
  MapField,
  ObjectField,
  RecordField,
  Resolved,
  Result,
  SetField,
  Spec,
  VariantField,
} from "./types.ts";

export interface ValueOptions {
  readonly format?: Format;
  readonly fns?: Functions;
}

/** What walking values needs besides the values: the vocabulary, the functions, the definitions. */
export interface ValueCtx {
  readonly format: Format;
  readonly fns: Functions | undefined;
  readonly defs?: Spec["defs"];
}
type Ctx = ValueCtx;

const lk = (ctx: Ctx): Lookup => ({ defs: ctx.defs, presets: ctx.format.presets });

export function ctxOf(spec: Spec, options: ValueOptions = {}): Ctx {
  return { format: options.format ?? formatOf(spec), fns: options.fns ?? functionsOf(spec), defs: spec.defs };
}

/** How deep defaults are filled. Only a definition that requires itself goes this deep, and the checker reports one. */
const MAX_DEPTH = 64;
const depthOf = (pointer: string) => pointer.split("/").length;

type Fields = { readonly [key: string]: FieldDecl };
type Groups = { readonly [id: string]: GroupDecl } | undefined;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/** The kind and the kinds it refines, most basic first. */
function kindChain(format: Format, type: string): AnyKind[] {
  const chain: AnyKind[] = [];
  const seen = new Set<string>();
  let name: string | undefined = type;
  while (name !== undefined && !seen.has(name)) {
    seen.add(name);
    const kind = format.kinds.get(name);
    if (!kind) break;
    chain.unshift(kind);
    name = kind.base;
  }
  return chain;
}

/** The fields and groups that apply to an object or variant value. */
export function fieldsOf(decl: FieldDecl, value: unknown): { fields: Fields; groups: Groups } | undefined {
  if (decl.type === "object") {
    const o = decl as ObjectField;
    return { fields: o.fields, groups: o.groups };
  }
  if (decl.type === "variant") {
    const v = decl as VariantField;
    const name = isPlainObject(value) ? value[v.key] : undefined;
    const chosen = typeof name === "string" ? v.variants[name] : undefined;
    return chosen ? { fields: chosen.fields, groups: chosen.groups } : undefined;
  }
  return undefined;
}

/** Whether a field's group, and that group's parents, are visible. */
function groupsVisible(groups: Groups, id: string | undefined, env: Env, scope: Scope): boolean {
  const seen = new Set<string>();
  while (id !== undefined && groups && !seen.has(id)) {
    seen.add(id);
    const group: GroupDecl | undefined = groups[id];
    if (!group) return true;
    if (!test(group.visible, env, scope)) return false;
    id = group.group;
  }
  return true;
}

export function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "number") return Number.isNaN(value);
  if (Array.isArray(value) || value instanceof Uint8Array) return value.length === 0;
  if (value instanceof Set || value instanceof Map) return value.size === 0;
  return false;
}

// ── Decoding ─────────────────────────────────────────────────────────────────────────────

/** JSON (or partly decoded values) to values: aliases renamed, built-ins revived. No defaults. */
export function decode(spec: Spec, json: unknown, options?: ValueOptions): unknown {
  return decodeFields(ctxOf(spec, options), spec.fields, json, "keep");
}

function decodeFields(ctx: Ctx, fields: Fields, json: unknown, unknown: ObjectField["unknown"], extra?: string): unknown {
  if (!isPlainObject(json)) return json;
  const out: Record<string, unknown> = {};
  const byAlias = new Map<string, string>();
  for (const [key, decl] of Object.entries(fields)) for (const alias of deref(lk(ctx), decl).aliases ?? []) byAlias.set(alias, key);
  for (const [key, value] of Object.entries(json)) {
    const name = key in fields || key === extra ? key : byAlias.get(key);
    if (name === undefined) {
      if (unknown !== "strip") out[key] = value;
      continue;
    }
    if (name !== key && name in json) continue; // the canonical key wins over an alias
    out[name] = name === extra ? value : decodeField(ctx, fields[name]!, value);
  }
  return out;
}

export function decodeField(ctx: Ctx, decl: FieldDecl, json: unknown): unknown {
  if (json === undefined) return undefined;
  decl = deref(lk(ctx), decl);
  switch (decl.type) {
    case "object": {
      const o = decl as ObjectField;
      return decodeFields(ctx, o.fields, json, o.unknown);
    }
    case "variant": {
      const v = decl as VariantField;
      const chosen = fieldsOf(decl, json);
      return chosen ? decodeFields(ctx, chosen.fields, json, "keep", v.key) : json;
    }
    case "array": {
      const items = (decl as ArrayField).items;
      return Array.isArray(json) ? json.map((x) => decodeField(ctx, items, x)) : json;
    }
    case "set": {
      const items = (decl as SetField).items;
      if (json instanceof Set) return new Set([...json].map((x) => decodeField(ctx, items, x)));
      return Array.isArray(json) ? new Set(json.map((x) => decodeField(ctx, items, x))) : json;
    }
    case "record": {
      const values = (decl as RecordField).values;
      if (!isPlainObject(json)) return json;
      return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, decodeField(ctx, values, v)]));
    }
    case "map": {
      const m = decl as MapField;
      const entries =
        json instanceof Map
          ? [...json]
          : Array.isArray(json) && json.every((e) => Array.isArray(e) && e.length === 2)
            ? (json as [unknown, unknown][])
            : isPlainObject(json)
              ? Object.entries(json)
              : undefined;
      if (!entries) return json;
      return new Map(entries.map(([k, v]) => [decodeKey(ctx, m.keys, k), decodeField(ctx, m.values, v)]));
    }
    default: {
      let value: unknown = json;
      for (const kind of kindChain(ctx.format, decl.type)) if (kind.decode) value = kind.decode(value, decl as never);
      return value;
    }
  }
}

/** A map key arrives as a string from a JSON object; numeric kinds read it back as a number. */
function decodeKey(ctx: Ctx, decl: FieldDecl, key: unknown): unknown {
  if (typeof key === "string" && (decl.type === "int" || decl.type === "number") && key.trim() !== "" && !Number.isNaN(Number(key))) {
    return Number(key);
  }
  return decodeField(ctx, decl, key);
}

// ── Encoding ─────────────────────────────────────────────────────────────────────────────

/** Values to JSON. */
export function encode(spec: Spec, values: unknown, options?: ValueOptions): Json {
  return encodeFields(ctxOf(spec, options), spec.fields, values) as Json;
}

function encodeFields(ctx: Ctx, fields: Fields, value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[key] = fields[key] ? encodeField(ctx, fields[key]!, v) : v;
  }
  return out;
}

export function encodeField(ctx: Ctx, decl: FieldDecl, value: unknown): unknown {
  if (value === undefined) return undefined;
  decl = deref(lk(ctx), decl);
  switch (decl.type) {
    case "object":
    case "variant": {
      const chosen = fieldsOf(decl, value);
      return chosen ? encodeFields(ctx, chosen.fields, value) : value;
    }
    case "array":
      return Array.isArray(value) ? value.map((x) => encodeField(ctx, (decl as ArrayField).items, x)) : value;
    case "set":
      return value instanceof Set ? [...value].map((x) => encodeField(ctx, (decl as SetField).items, x)) : value;
    case "record": {
      if (!isPlainObject(value)) return value;
      const values = (decl as RecordField).values;
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeField(ctx, values, v)]));
    }
    case "map": {
      if (!(value instanceof Map)) return value;
      const m = decl as MapField;
      return [...value].map(([k, v]) => [encodeField(ctx, m.keys, k), encodeField(ctx, m.values, v)]);
    }
    default: {
      const chain = kindChain(ctx.format, decl.type);
      for (let i = chain.length - 1; i >= 0; i--) {
        const kind = chain[i]!;
        if (kind.encode) return kind.encode(value, decl as never);
      }
      return value;
    }
  }
}

// ── Defaults ─────────────────────────────────────────────────────────────────────────────

/**
 * Fill every absent field: its default, else its kind's zero. Defaults that are expressions
 * are computed after the literal ones, each reading the others as resolved, in any order;
 * a cycle leaves the fields in it absent.
 */
export function resolve(spec: Spec, values: unknown, options?: ValueOptions): Record<string, unknown> {
  const ctx = ctxOf(spec, options);
  const pending: Pending[] = [];
  let root = fillFields(ctx, spec.fields, isPlainObject(values) ? values : {}, "", pending) as Record<string, unknown>;
  computePending(ctx, pending, () => root, (next) => (root = next as Record<string, unknown>));
  return root;
}

/** The starting value of one declaration, e.g. for a new array item. */
export function initialValue(spec: Spec, decl: FieldDecl, root: unknown, at: string, options?: ValueOptions): unknown {
  const ctx = ctxOf(spec, options);
  const pending: Pending[] = [];
  let tree = setAt(root, at, fillField(ctx, decl, undefined, at, pending));
  computePending(ctx, pending, () => tree, (next) => (tree = next));
  return getAt(tree, at);
}

interface Pending {
  readonly pointer: string;
  readonly decl: FieldDecl;
  readonly scope: Scope;
}

/**
 * The definitions the values around a field are of, outermost first. A definition that requires
 * itself (the checker says so) is not filled in again inside itself: its value would never end,
 * on two branches it would double at each step, and each later fill would add a level.
 */
type Trail = readonly string[];

const loops = new WeakMap<object, Map<string, boolean>>();
/** Whether a definition requires itself, worked out once per spec. */
function loopsBack(ctx: Ctx, name: string): boolean {
  if (!ctx.defs) return false;
  let known = loops.get(ctx.defs);
  if (!known) loops.set(ctx.defs, (known = new Map()));
  let answer = known.get(name);
  if (answer === undefined) known.set(name, (answer = requiresItself(ctx.defs, name) !== undefined));
  return answer;
}

const along = (trail: Trail, decl: FieldDecl): Trail => {
  const name = usedName(decl);
  return name === undefined ? trail : [...trail, name];
};

function fillFields(ctx: Ctx, fields: Fields, value: Record<string, unknown>, at: string, pending: Pending[], extra?: string, trail: Trail = []) {
  const out: Record<string, unknown> = { ...value };
  for (const [key, decl] of Object.entries(fields)) {
    if (key === extra) continue;
    const pointer = joinPointer(at, key);
    const filled = fillField(ctx, decl, value[key], pointer, pending, { base: at }, trail);
    if (filled === undefined) delete out[key];
    else out[key] = filled;
  }
  return out;
}

function fillField(ctx: Ctx, raw: FieldDecl, value: unknown, at: string, pending: Pending[], scope: Scope = { base: at }, trail: Trail = []): unknown {
  const decl = deref(lk(ctx), raw);
  if (depthOf(at) > MAX_DEPTH) return value;
  if (value === undefined) {
    if (decl.default !== undefined) {
      if (isDynamic(decl.default)) {
        pending.push({ pointer: at, decl, scope });
        return undefined;
      }
      value = decodeField(ctx, decl, decl.default);
    } else if (decl.optional) {
      return undefined;
    } else {
      const name = usedName(raw);
      if (name !== undefined && trail.includes(name) && loopsBack(ctx, name)) return undefined;
      value = zeroOf(ctx, decl);
      if (value === undefined) return undefined;
    }
  }
  return fillInside(ctx, decl, value, at, pending, along(trail, raw));
}

/** Fill the inside of a container value. */
function fillInside(ctx: Ctx, decl: FieldDecl, value: unknown, at: string, pending: Pending[], trail: Trail = []): unknown {
  decl = deref(lk(ctx), decl);
  if (depthOf(at) > MAX_DEPTH) return value;
  switch (decl.type) {
    case "object":
      return isPlainObject(value) ? fillFields(ctx, (decl as ObjectField).fields, value, at, pending, undefined, trail) : value;
    case "variant": {
      const v = decl as VariantField;
      const chosen = fieldsOf(decl, value);
      return chosen && isPlainObject(value) ? fillFields(ctx, chosen.fields, value, at, pending, v.key, trail) : value;
    }
    case "array": {
      if (!Array.isArray(value)) return value;
      const items = (decl as ArrayField).items;
      const inner = along(trail, items);
      return value.map((x, i) => {
        const pointer = joinPointer(at, i);
        return x === undefined ? x : fillInside(ctx, items, x, pointer, pending, inner);
      });
    }
    default:
      return value;
  }
}

function zeroOf(ctx: Ctx, decl: FieldDecl): unknown {
  decl = deref(lk(ctx), decl);
  switch (decl.type) {
    case "object":
      return {};
    case "variant": {
      const v = decl as VariantField;
      const first = Object.keys(v.variants)[0];
      return first === undefined ? undefined : { [v.key]: first };
    }
    case "array":
      return [];
    case "set":
      return new Set();
    case "record":
      return {};
    case "map":
      return new Map();
    default: {
      const chain = kindChain(ctx.format, decl.type);
      for (let i = chain.length - 1; i >= 0; i--) {
        const zero = chain[i]!.zero;
        if (zero) return zero(decl as never);
      }
      return undefined;
    }
  }
}

function computePending(ctx: Ctx, pending: Pending[], get: () => unknown, set: (root: unknown) => void) {
  const state = new Map<string, "busy" | "done">();
  const byPointer = new Map(pending.map((p) => [p.pointer, p]));
  const compute = (p: Pending) => {
    if (state.has(p.pointer)) return;
    state.set(p.pointer, "busy");
    const env: Env = {
      values: get(),
      fns: ctx.fns,
      get(pointer) {
        // A default reading another default not computed yet computes that one first.
        for (const [at, other] of byPointer) {
          if ((pointer === at || pointer.startsWith(`${at}/`)) && !state.has(at)) compute(other);
        }
        return getAt(get(), pointer);
      },
    };
    let value: unknown;
    try {
      value = evaluate(p.decl.default, env, p.scope);
    } catch {
      value = undefined;
    }
    if (value !== undefined) {
      const more: Pending[] = [];
      const filled = fillInside(ctx, p.decl, decodeField(ctx, p.decl, value), p.pointer, more);
      set(setAt(get(), p.pointer, filled));
      for (const m of more) {
        byPointer.set(m.pointer, m);
        pending.push(m);
      }
    } else if (!p.decl.optional) {
      const zero = zeroOf(ctx, p.decl);
      if (zero !== undefined) set(setAt(get(), p.pointer, zero));
    }
    state.set(p.pointer, "done");
  };
  for (let i = 0; i < pending.length; i++) compute(pending[i]!);
}

// ── Validation ───────────────────────────────────────────────────────────────────────────

/** Check resolved values. Hidden fields are skipped; required-ness and options are evaluated. */
export function validate(spec: Spec, values: unknown, options?: ValueOptions): Issue[] {
  const ctx = ctxOf(spec, options);
  const issues: Issue[] = [];
  const env: Env = { values, fns: ctx.fns };
  if (!isPlainObject(values)) return [{ path: "", code: "type", message: "must be an object" }];
  checkFields(ctx, env, spec.fields, spec.groups, values, "", "error", issues);
  return issues;
}

function safeTest(condition: Condition | undefined, env: Env, scope: Scope, issues: Issue[], at: string): boolean {
  try {
    return test(condition, env, scope);
  } catch (error) {
    issues.push({ path: at, code: "condition", message: (error as Error).message });
    return true;
  }
}

function checkFields(
  ctx: Ctx,
  env: Env,
  fields: Fields,
  groups: Groups,
  value: Record<string, unknown>,
  at: string,
  unknown: ObjectField["unknown"],
  issues: Issue[],
  extra?: string,
  item?: Pick<Scope, "item" | "index">,
) {
  const scope: Scope = { base: at, ...item };
  for (const [key, raw] of Object.entries(fields)) {
    const decl = deref(lk(ctx), raw);
    const pointer = joinPointer(at, key);
    if (!safeTest(decl.visible, env, scope, issues, pointer)) continue;
    if (!groupsVisible(groups, decl.group, env, scope)) continue;
    checkField(ctx, env, decl, value[key], pointer, scope, issues);
  }
  if (unknown === "keep" || unknown === "strip") return;
  for (const key of Object.keys(value)) {
    if (key in fields || key === extra) continue;
    const near = suggest(key, Object.keys(fields));
    issues.push({
      path: joinPointer(at, key),
      code: "unknown",
      message: `is not a field here${near ? `; did you mean "${near}"?` : ""}`,
    });
  }
}

export function checkField(ctx: Ctx, env: Env, decl: FieldDecl, value: unknown, at: string, scope: Scope, issues: Issue[]) {
  decl = deref(lk(ctx), decl);
  const issue = (code: string, message: string, path = at) => issues.push({ path, code, message });
  if (value === undefined || value === null) {
    const required = decl.required !== undefined && safeTest(decl.required, env, scope, issues, at);
    if (required || (!decl.optional && value === undefined)) issue("required", "is required");
    else if (value === null && !decl.optional && decl.type !== "json") issue("type", "must not be null");
    return;
  }
  if (decl.required !== undefined && isEmpty(value) && safeTest(decl.required, env, scope, issues, at)) {
    return issue("required", "is required");
  }
  switch (decl.type) {
    case "object":
    case "variant": {
      if (!isPlainObject(value)) return issue("type", "must be an object");
      if (decl.type === "variant") {
        const v = decl as VariantField;
        const name = value[v.key];
        if (typeof name !== "string" || !(name in v.variants)) {
          return issue("variant", `must be one of ${Object.keys(v.variants).map((n) => JSON.stringify(n)).join(", ")}`, joinPointer(at, v.key));
        }
      }
      const chosen = fieldsOf(decl, value)!;
      const unknown = decl.type === "object" ? (decl as ObjectField).unknown : "error";
      const extra = decl.type === "variant" ? (decl as VariantField).key : undefined;
      const item = scope.item === undefined ? undefined : { item: scope.item, index: scope.index };
      return checkFields(ctx, env, chosen.fields, chosen.groups, value, at, unknown, issues, extra, item);
    }
    case "array":
    case "set": {
      const list = decl.type === "array" ? value : value instanceof Set ? [...value] : undefined;
      if (!Array.isArray(list)) return issue("type", decl.type === "array" ? "must be a list" : "must be a set");
      const d = decl as ArrayField;
      if (d.minItems !== undefined && list.length < d.minItems) issue("minItems", `needs at least ${d.minItems} items`);
      if (d.maxItems !== undefined && list.length > d.maxItems) issue("maxItems", `takes at most ${d.maxItems} items`);
      list.forEach((x, i) => {
        const pointer = joinPointer(at, i);
        const itemScope: Scope = { base: ["object", "variant"].includes(deref(lk(ctx), d.items).type) ? pointer : scope.base, item: pointer, index: i };
        checkField(ctx, env, d.items, x, pointer, itemScope, issues);
      });
      return;
    }
    case "record": {
      if (!isPlainObject(value)) return issue("type", "must be an object");
      const r = decl as RecordField;
      const pattern = r.keyPattern === undefined ? undefined : new RegExp(`^(?:${r.keyPattern})$`, "u");
      for (const [k, v] of Object.entries(value)) {
        const pointer = joinPointer(at, k);
        if (pattern && !pattern.test(k)) issue("key", `key must match ${r.keyPattern}`, pointer);
        checkField(ctx, env, r.values, v, pointer, { ...scope, item: pointer }, issues);
      }
      return;
    }
    case "map": {
      if (!(value instanceof Map)) return issue("type", "must be a map");
      const m = decl as MapField;
      for (const [k, v] of value) {
        const pointer = joinPointer(at, String(k));
        checkField(ctx, env, m.keys, k, pointer, scope, issues);
        checkField(ctx, env, m.values, v, pointer, { ...scope, item: pointer }, issues);
      }
      return;
    }
    default: {
      const chain = kindChain(ctx.format, decl.type);
      if (chain.length === 0) return issue("kind", `has a kind this format does not know: "${decl.type}"`);
      for (const kind of chain) {
        if (CONTAINER_KINDS.has(kind.name)) continue;
        let failed = false;
        kind.check?.(value, decl as never, {
          env,
          scope,
          issue: (code, message) => {
            failed = true;
            issue(code, message);
          },
        });
        if (failed) return;
      }
    }
  }
}

// ── Parsing ──────────────────────────────────────────────────────────────────────────────

/** JSON or values in; typed, defaulted values out, or every issue with its path. */
export function parse<S extends Spec>(spec: S, input: unknown, options?: ValueOptions): Result<Infer<S>> {
  const values = resolve(spec, decode(spec, input, options), options);
  const issues = validate(spec, values, options);
  return (issues.length === 0 ? { ok: true, value: values, issues: [] } : { ok: false, value: values, issues }) as unknown as Result<Infer<S>>;
}

/** Like {@link parse}, but throws a readable error. */
export function parseOrThrow<S extends Spec>(spec: S, input: unknown, options?: ValueOptions): Infer<S> {
  const result = parse(spec, input, options);
  if (result.ok) return result.value;
  throw new Error(`Invalid values:\n${result.issues.map((i) => `  ${i.path || "/"}: ${i.message}`).join("\n")}`);
}

// ── Navigation ───────────────────────────────────────────────────────────────────────────

export interface Located {
  readonly decl: Resolved;
  /** The scope expressions on this field evaluate in. */
  readonly scope: Scope;
  /** The groups of the scope the field is declared in. */
  readonly groups: Groups;
}

/** The declaration at a pointer into the values, following variants by their current value. */
export function declAt(spec: Spec, values: unknown, pointer: string, format: Format = formatOf(spec)): Located | undefined {
  const lookup: Lookup = { defs: spec.defs, presets: format.presets };
  if (pointer === "") return undefined;
  const segments = pointer.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let fields: Fields | undefined = spec.fields;
  let groups: Groups = spec.groups;
  let decl: FieldDecl | undefined;
  let at = "";
  let node: unknown = values;
  let scope: Scope = { base: "" };
  for (const segment of segments) {
    const parentAt = at;
    at = joinPointer(at, segment);
    node = child(node, segment);
    if (fields) {
      const variantKey = decl?.type === "variant" ? (decl as VariantField).key : undefined;
      if (segment === variantKey) {
        const v = decl as VariantField;
        decl = {
          type: "enum",
          label: v.label,
          options: Object.entries(v.variants).map(([value, variant]) => ({ value, label: variant.label ?? value })),
        };
      } else {
        decl = fields[segment] && deref(lookup, fields[segment]!);
      }
      scope = { ...scope, base: parentAt };
    } else if (decl && (decl.type === "array" || decl.type === "set")) {
      const index = Number(segment);
      decl = deref(lookup, (decl as ArrayField).items);
      scope = { base: decl.type === "object" || decl.type === "variant" ? at : scope.base, item: at, index };
      groups = undefined;
    } else if (decl && (decl.type === "record" || decl.type === "map")) {
      decl = deref(lookup, (decl as RecordField).values);
      scope = { ...scope, item: at };
      groups = undefined;
    } else return undefined;
    if (!decl) return undefined;
    const inner = fieldsOf(decl, node);
    const located = { decl, scope, groups };
    if (at === pointer) return located;
    fields = inner?.fields;
    if (inner) groups = inner.groups;
  }
  return undefined;
}

/** The closest name, for "did you mean". */
export function suggest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Math.max(2, Math.floor(word.length / 3));
  for (const c of candidates) {
    // The distance is at least the difference in length, so far longer or shorter names are skipped unmeasured.
    if (Math.abs(c.length - word.length) > bestScore) continue;
    const d = distance(word.toLowerCase(), c.toLowerCase());
    if (d <= bestScore) {
      best = c;
      bestScore = d - 1;
    }
  }
  return best;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length]!;
}

export { isJson };
