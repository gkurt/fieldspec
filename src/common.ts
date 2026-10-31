/**
 * The fields several specs have in common, as one spec a single form edits: the settings every
 * selected item shares, say. Each common field is declared as narrowly as every spec needs
 * (bounds tightened, options intersected, patterns combined), so a value valid for it is valid
 * for all of them. Where the specs' values differ the field is mixed: the form shows the first
 * value, and an edit writes back only what changed, to every spec that has the field.
 */
import { deref, lookUp, usedName, type Lookup } from './defs.ts';
import { equal } from './expr.ts';
import { isBuiltinName } from './names.ts';
import { formatPointer, getAt, joinPointer, resolveSegments, setAt } from './pointer.ts';
import { registryOf, type Registry } from './registry.ts';
import type { FieldDecl, FunctionDecl, GroupDecl, Resolved, Spec, Variant } from './types.ts';
import { resolve } from './values.ts';

export interface CommonOptions {
  /** Each spec's current values, decoded, in the order of the specs. Absent ones take the spec's defaults. */
  readonly values?: readonly unknown[];
  /** `"all"` (the default): the fields every spec has. `"some"`: the fields any spec has; an edit reaches only the specs that have the field. */
  readonly match?: 'all' | 'some';
  readonly registry?: Registry;
}

/** A field left out, at a JSON Pointer into the values, and why. */
export interface Dropped {
  readonly path: string;
  readonly reason: string;
}

export interface Common {
  /** One spec of the common fields. */
  readonly spec: Spec;
  /** The values to edit: where the specs' values differ, the first spec's. */
  readonly values: { readonly [key: string]: unknown };
  /** Pointers whose values differ between the specs. */
  readonly mixed: readonly string[];
  /** For each common field, the indexes of the specs that have it. */
  readonly sources: { readonly [key: string]: readonly number[] };
  readonly dropped: readonly Dropped[];
  /** Each spec's values (by default the ones given) with what changed between {@link values} and `edited` written in. */
  apply(edited: unknown, values?: readonly unknown[]): unknown[];
}

type Fields = { readonly [key: string]: FieldDecl };
type Groups = { readonly [id: string]: GroupDecl };
type Props = Record<string, unknown>;

class Conflict {
  readonly reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
}

interface Cx {
  /** Where each spec's `use` names are looked up, by spec index. */
  readonly lookups: readonly Lookup[];
  readonly dropped: Dropped[];
  /** The definitions the common fields still use, copied from the specs. */
  readonly defs: Map<string, FieldDecl>;
  /** The `use` names being expanded, so a recursive definition that differs ends. */
  readonly expanding: string[];
}

const SHOWN_FROM_FIRST = new Set(['label', 'description', 'hint', 'placeholder']);
/** Kept when every spec says the same, left out otherwise: none of them limits the value. */
const KEPT_IF_EQUAL = new Set([
  'patternMessage',
  'examples',
  'aliases',
  'deprecated',
  'meta',
  'render',
  'group',
  'order',
  'default',
  'value',
  'visible',
  'enabled',
  'required',
  'step',
  'unknown',
]);
const LOWER = new Set(['min', 'minLength', 'minItems']);
const UPPER = new Set(['max', 'maxLength', 'maxItems', 'maxBytes']);
const BOUNDS = [
  ['min', 'max'],
  ['minLength', 'maxLength'],
  ['minItems', 'maxItems'],
] as const;

const isObject = (v: unknown): v is Props =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const specs = (idx: readonly number[]) => (idx.length === 1 ? `spec ${idx[0]}` : `specs ${idx.slice(0, -1).join(', ')} and ${idx.at(-1)}`);
const a = (kind: string) => `${/^(?:[aeio]|u(?!r|s))/i.test(kind) ? 'an' : 'a'} ${kind}`;

/** The fields `specs` have in common, as one spec, with their values summarized when given. */
export function commonFields(list: readonly Spec[], options: CommonOptions = {}): Common {
  const registry = options.registry ?? (list[0] ? registryOf(list[0]) : undefined);
  const presets = registry?.presets;
  const cx: Cx = { lookups: list.map((s) => ({ defs: s.defs, presets })), dropped: [], defs: new Map(), expanding: [] };
  const some = options.match === 'some';

  const fields: Record<string, FieldDecl> = {};
  const sources: Record<string, number[]> = {};
  for (const key of unionKeys(list.map((s) => s.fields))) {
    const have = list.flatMap((s, i) => (s.fields[key] !== undefined ? [i] : []));
    const path = formatPointer([key]);
    if (!some && have.length < list.length) {
      cx.dropped.push({ path, reason: `is not in ${specs(list.flatMap((_, i) => (have.includes(i) ? [] : [i])))}` });
      continue;
    }
    try {
      fields[key] = merge(
        cx,
        have.map((i) => list[i]!.fields[key]!),
        have,
        path,
        false,
      );
      sources[key] = have;
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      cx.dropped.push({ path, reason: e.reason });
    }
  }

  const groups = mergeGroups(
    list.map((s) => s.groups),
    !some,
  );
  const functions: Record<string, FunctionDecl> = {};
  for (const s of list) for (const [name, fn] of Object.entries(s.functions ?? {})) functions[name] ??= fn;
  const defs = Object.fromEntries(cx.defs);
  const lookup: Lookup = { defs, presets };
  const root = { type: 'object', fields } as Resolved;
  const spec: Spec = {
    fields: pruneFields(lookup, root, fields, groups, []),
    ...(groups && { groups }),
    ...(cx.defs.size > 0 && { defs }),
    ...(Object.keys(functions).length > 0 && { functions }),
  };

  // Each spec's own defaults and zeros fill its values first, so they compare as a form shows them.
  const given = (options.values ?? []).map((v, i) => resolve(list[i]!, v, { registry }));
  const mixed: string[] = [];
  const values: Record<string, unknown> = {};
  for (const [key, decl] of Object.entries(spec.fields)) {
    const idx = sources[key]!;
    const value = summarize(
      lookup,
      decl,
      idx.map((i) => getAt(given[i], formatPointer([key]))),
      formatPointer([key]),
      mixed,
    );
    if (value !== undefined) values[key] = value;
  }

  return {
    spec,
    values,
    mixed,
    sources,
    dropped: cx.dropped,
    apply(edited, targets = options.values ?? list.map(() => ({}))) {
      const out = targets.slice();
      for (const [key, decl] of Object.entries(spec.fields)) {
        const at = formatPointer([key]);
        writeBack(lookup, decl, at, values[key], getAt(edited, at), sources[key]!, targets, out);
      }
      return out;
    },
  };
}

function unionKeys(maps: readonly (object | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const map of maps) for (const key of Object.keys(map ?? {})) keys.add(key);
  return [...keys];
}

// ── Declarations ──────────────────────────────────────────────────────────────────────────

/**
 * One declaration every value of which each of `decls` accepts. `idx` gives the spec each came
 * from. Inside a collection (`strict`), losing a nested field is a conflict, since a whole
 * item is written back.
 */
function merge(cx: Cx, decls: readonly FieldDecl[], idx: readonly number[], at: string, strict: boolean): FieldDecl {
  const first = decls[0]!;
  if (decls.every((d) => equal(d, first))) {
    const uses = usesOf(cx, first, idx);
    if (uses) return (keep(cx, idx, uses), first);
  }

  const names = decls.map(usedName);
  const expanding = names.every((n) => n !== undefined) ? names.join(' & ') : undefined;
  if (expanding !== undefined && cx.expanding.includes(expanding))
    throw new Conflict(`differs inside the recursive definition ${names[0]}`);

  if (expanding !== undefined) cx.expanding.push(expanding);
  try {
    const merged = mergeResolved(
      cx,
      decls.map((d, i) => deref(cx.lookups[idx[i]!]!, d)),
      idx,
      at,
      strict,
    );
    return names.every((n) => n !== undefined && n === names[0]) ? reuse(cx, names[0]!, idx, merged) : merged;
  } finally {
    if (expanding !== undefined) cx.expanding.pop();
  }
}

/** The `use` names reachable from `decl`, if every one means the same in each spec (and as any definition already kept). */
function usesOf(cx: Cx, decl: FieldDecl, idx: readonly number[]): string[] | undefined {
  const names = new Set<string>();
  const lookup = cx.lookups[idx[0]!]!;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isObject(node)) return;
    const name = node.type === undefined && typeof node.use === 'string' ? node.use : undefined;
    if (name !== undefined && !names.has(name)) {
      names.add(name);
      visit(lookUp(lookup, name));
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(decl);
  for (const name of names) {
    const target = lookUp(lookup, name);
    if (!idx.every((i) => equal(lookUp(cx.lookups[i]!, name), target))) return undefined;
    if (isDef(lookup, name) && cx.defs.has(name) && !equal(cx.defs.get(name), target)) return undefined;
  }
  return [...names];
}

/** Keeps the definitions among `names`. */
function keep(cx: Cx, idx: readonly number[], names: readonly string[]): void {
  const lookup = cx.lookups[idx[0]!]!;
  for (const name of names) if (isDef(lookup, name)) cx.defs.set(name, lookUp(lookup, name)!);
}

function isDef(lookup: Lookup, name: string): boolean {
  return !isBuiltinName(name) && lookup.defs?.[name] !== undefined;
}

/** `merged` as `{ use: name, …what differs from the base }`, when the base means the same everywhere and nothing of it was left out. */
function reuse(cx: Cx, name: string, idx: readonly number[], merged: Resolved): FieldDecl {
  const uses = usesOf(cx, { use: name }, idx);
  if (!uses) return merged;
  const base = deref(cx.lookups[idx[0]!]!, { use: name }) as Props;
  const out: Props = { use: name };
  for (const key of Object.keys(base)) if (!(key in merged)) return merged;
  for (const [key, value] of Object.entries(merged)) {
    if (equal(value, base[key])) continue;
    if (key === 'type') return merged;
    out[key] = value;
  }
  keep(cx, idx, uses);
  return out as FieldDecl;
}

function mergeResolved(cx: Cx, decls: readonly Resolved[], idx: readonly number[], at: string, strict: boolean): Resolved {
  const types = decls.map((d) => d.type);
  let type = types[0]!;
  const other = types.findIndex((t) => t !== type);
  if (other >= 0) {
    // Every int is a number.
    if (!types.every((t) => t === 'int' || t === 'number'))
      throw new Conflict(`is ${a(type)} in spec ${idx[0]} but ${a(types[other]!)} in spec ${idx[other]}`);

    type = 'int';
  }
  const out: Props = { type };
  for (const key of unionKeys(decls)) {
    if (key === 'type') continue;
    const value = mergeProp(
      cx,
      type,
      key,
      decls.map((d) => (d as Props)[key]),
      idx,
      at,
      strict,
    );
    if (value !== undefined) out[key] = value;
  }
  for (const [lo, hi] of BOUNDS) {
    if (out[lo] !== undefined && out[hi] !== undefined && order(type, out[lo]) > order(type, out[hi]))
      throw new Conflict(`has no value within every spec's ${lo} and ${hi}`);
  }
  return out as Resolved;
}

function order(type: string, bound: unknown): number | bigint {
  if (type === 'date') return Date.parse(String(bound));
  if (type === 'bigint') return BigInt(String(bound));
  return Number(bound);
}

function mergeProp(
  cx: Cx,
  type: string,
  key: string,
  values: readonly unknown[],
  idx: readonly number[],
  at: string,
  strict: boolean,
): unknown {
  const given = values.filter((v) => v !== undefined);
  const same = values.every((v) => equal(v, values[0]));
  if (SHOWN_FROM_FIRST.has(key)) return given[0];
  if (KEPT_IF_EQUAL.has(key)) return same ? values[0] : undefined;
  if (LOWER.has(key) || UPPER.has(key))
    return given.reduce((tight, v) => (order(type, v) > order(type, tight) === LOWER.has(key) ? v : tight), given[0]);

  switch (key) {
    case 'readOnly':
      return values.some((v) => v === true) || undefined;
    case 'optional':
      return values.every((v) => v === true) || undefined;
    case 'pattern':
    case 'keyPattern': {
      // Every pattern matches the whole value: all but the last are lookaheads.
      const patterns = [...new Set(given as string[])];
      return patterns.length <= 1
        ? patterns[0]
        : patterns
            .slice(0, -1)
            .map((p) => `(?=(?:${p})$)`)
            .join('') + `(?:${patterns.at(-1)})`;
    }
    case 'format': {
      const formats = [...new Set(given as string[])];
      if (formats.length > 1) throw new Conflict(`is formatted as ${formats.join(' and ')} in different specs`);
      return formats[0];
    }
    case 'protocols':
    case 'accept': {
      const lists = given as (readonly string[])[];
      const kept = lists[0]?.filter((v) => lists.every((list) => list.includes(v)));
      if (kept?.length === 0) throw new Conflict(`has no ${key === 'accept' ? 'file type' : 'protocol'} every spec allows`);
      return kept;
    }
    case 'options': {
      if (!values.every(Array.isArray)) {
        if (same) return values[0];
        throw new Conflict('takes its options from different places in different specs');
      }
      const lists = values as readonly (readonly unknown[])[];
      const valueOf = (o: unknown) => (isObject(o) ? o.value : o);
      const kept = lists[0]!.filter((o) => lists.every((list) => list.some((p) => Object.is(valueOf(p), valueOf(o)))));
      if (kept.length === 0) throw new Conflict('has no option every spec allows');
      return kept;
    }
    case 'items':
    case 'keys':
    case 'values':
      try {
        return merge(cx, values as FieldDecl[], idx, at, true);
      } catch (e) {
        if (e instanceof Conflict) throw new Conflict(`its ${key.replace(/s$/, '')} declaration ${e.reason}`);
        throw e;
      }
    case 'fields':
      return mergeFields(cx, values as Fields[], idx, at, strict);
    case 'groups':
      return mergeGroups(values as (Groups | undefined)[], true);
    case 'key':
      if (!same) throw new Conflict('is switched by different keys in different specs');
      return values[0];
    case 'variants': {
      const maps = values as Record<string, Variant>[];
      const names = Object.keys(maps[0]!).filter((name) => maps.every((m) => m[name] !== undefined));
      if (names.length === 0) throw new Conflict('has no variant every spec allows');
      return Object.fromEntries(
        names.map((name) => {
          const variants = maps.map((m) => m[name]!);
          const groups = mergeGroups(
            variants.map((v) => v.groups),
            true,
          );
          const { label, description } = variants[0]!;
          return [
            name,
            {
              ...(label !== undefined && { label }),
              ...(description !== undefined && { description }),
              fields: mergeFields(
                cx,
                variants.map((v) => v.fields),
                idx,
                at,
                strict,
                name,
              ),
              ...(groups && { groups }),
            },
          ];
        }),
      );
    }
    default:
      // A property only some kind knows: it may limit the value, so it must agree.
      if (!same) throw new Conflict(`has a different ${key} in different specs`);
      return values[0];
  }
}

/** The fields every one of `maps` has, merged. The others, and those that conflict, are dropped (or, `strict`, a conflict). */
function mergeFields(cx: Cx, maps: readonly Fields[], idx: readonly number[], at: string, strict: boolean, variant?: string): Fields {
  const out: Record<string, FieldDecl> = {};
  for (const key of unionKeys(maps)) {
    const missing = idx.filter((_, i) => maps[i]![key] === undefined);
    const where = variant === undefined ? '' : ` (variant ${variant})`;
    try {
      if (missing.length > 0) throw new Conflict(`is not in ${specs(missing)}`);
      out[key] = merge(
        cx,
        maps.map((m) => m[key]!),
        idx,
        joinPointer(at, key),
        strict,
      );
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
      if (strict) throw new Conflict(`has a field ${key}${where} that ${e.reason}`);
      cx.dropped.push({ path: joinPointer(at, key), reason: `${e.reason}${where}` });
    }
  }
  return out;
}

/** The groups the specs declare alike. With `all`, only those every spec declares. */
function mergeGroups(maps: readonly (Groups | undefined)[], all: boolean): Groups | undefined {
  const out: Record<string, GroupDecl> = {};
  for (const id of unionKeys(maps)) {
    const decls = maps.map((m) => m?.[id]);
    const given = decls.filter((d) => d !== undefined);
    if ((all && given.length < maps.length) || !given.every((d) => equal(d, given[0]))) continue;
    out[id] = given[0]!;
  }
  for (const [id, group] of Object.entries(out)) {
    if (group.group !== undefined && !(group.group in out)) {
      const { group: _parent, ...rest } = group;
      out[id] = rest;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ── Pruning: what refers to fields that were left out ─────────────────────────────────────

const CONDITIONS = ['visible', 'enabled', 'required', 'default', 'value'] as const;

/**
 * The fields, without conditions and defaults that read a field no longer there, and without
 * groups no longer declared. Definitions kept whole are left as they are.
 */
function pruneFields(lookup: Lookup, root: Resolved, fields: Fields, groups: Groups | undefined, at: readonly string[]): Fields {
  return Object.fromEntries(Object.entries(fields).map(([key, decl]) => [key, prune(lookup, root, decl, groups, [...at, key])]));
}

function prune(lookup: Lookup, root: Resolved, decl: FieldDecl, groups: Groups | undefined, at: readonly string[]): FieldDecl {
  const out: Props = { ...decl };
  const scope = at.slice(0, -1);
  for (const key of CONDITIONS)
    if (out[key] !== undefined && !refsOf(out[key]).every((ref) => declared(lookup, root, resolveSegments(ref, scope)))) delete out[key];

  if (typeof out.group === 'string' && !(out.group in (groups ?? {}))) delete out.group;
  if (usedName(decl) !== undefined) return out as FieldDecl;
  const item = (key: string, segment: string) => {
    if (isObject(out[key])) out[key] = prune(lookup, root, out[key] as FieldDecl, undefined, [...at, segment]);
  };
  item('items', '0');
  item('values', '*');
  item('keys', '*');
  if (isObject(out.fields)) out.fields = pruneFields(lookup, root, out.fields as Fields, out.groups as Groups | undefined, at);
  if (isObject(out.variants)) {
    out.variants = Object.fromEntries(
      Object.entries(out.variants as Record<string, Variant>).map(([name, v]) => [
        name,
        { ...v, fields: pruneFields(lookup, root, v.fields, v.groups, at) },
      ]),
    );
  }
  return out as FieldDecl;
}

/** The pointers an expression or condition reads. */
function refsOf(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => refsOf(n, out));
  } else if (isObject(node)) {
    if (typeof node.$state === 'string') out.push(node.$state);
    if (typeof node.$template === 'string') for (const [, ref] of node.$template.matchAll(/\$\{([^}]*)\}/g)) out.push(ref!);
    for (const value of Object.values(node)) refsOf(value, out);
  }
  return out;
}

/** Whether a value path (array indexes and map keys as any segment) is declared. */
function declared(lookup: Lookup, root: Resolved, segments: readonly string[]): boolean {
  let at = root;
  for (const segment of segments) {
    const d = at as Props;
    let next: unknown;
    if (d.type === 'object') {
      next = (d.fields as Fields)[segment];
    } else if (d.type === 'array' || d.type === 'set') {
      next = d.items;
    } else if (d.type === 'record' || d.type === 'map') {
      next = d.values;
    } else if (d.type === 'variant') {
      next =
        segment === d.key
          ? { type: 'string' }
          : Object.values(d.variants as Record<string, Variant>)
              .map((v) => v.fields[segment])
              .find(Boolean);
    }
    if (next === undefined) return false;
    at = deref(lookup, next as FieldDecl);
  }
  return true;
}

/** `equal`, either way round: it reads a JSON form (a URL's string, a date's ISO text) on its right only. */
const same = (a: unknown, b: unknown) => equal(a, b) || equal(b, a);

// ── Values ────────────────────────────────────────────────────────────────────────────────

/** The value to show for `values` (one per spec that has the field): the first, mixed if they differ. Objects and variants are summarized field by field. */
function summarize(lookup: Lookup, decl: FieldDecl, values: readonly unknown[], at: string, mixed: string[]): unknown {
  const d = deref(lookup, decl) as Props;
  if (values.every((v) => v === undefined)) return undefined;
  const byField = (fields: Fields, out: Props) => {
    for (const [key, field] of Object.entries(fields)) {
      const value = summarize(
        lookup,
        field,
        values.map((v) => (isObject(v) ? v[key] : undefined)),
        joinPointer(at, key),
        mixed,
      );
      if (value !== undefined) out[key] = value;
    }
    return out;
  };
  if (d.type === 'object' && values.every((v) => v === undefined || isObject(v))) return byField(d.fields as Fields, {});
  if (d.type === 'variant' && values.every(isObject)) {
    const key = d.key as string;
    const name = (values[0] as Props)[key];
    const variant = (d.variants as Record<string, Variant>)[String(name)];
    if (variant && values.every((v) => v[key] === name)) return byField(variant.fields, { [key]: name });
  }
  const first = values.find((v) => v !== undefined);
  if (!values.every((v) => same(v, first))) mixed.push(at);
  return first;
}

/** Writes what changed from `before` to `after` into `out[i]` for each spec in `idx`, field by field through objects and unchanged variants. */
function writeBack(
  lookup: Lookup,
  decl: FieldDecl,
  at: string,
  before: unknown,
  after: unknown,
  idx: readonly number[],
  targets: readonly unknown[],
  out: unknown[],
): void {
  const d = deref(lookup, decl) as Props;
  const byField = (fields: Fields, to: readonly number[]) => {
    const old = isObject(before) ? before : {};
    for (const [key, field] of Object.entries(fields))
      writeBack(lookup, field, joinPointer(at, key), old[key], (after as Props)[key], to, targets, out);
  };
  if (d.type === 'object' && isObject(after)) return byField(d.fields as Fields, idx);
  if (d.type === 'variant' && isObject(after) && isObject(before)) {
    const key = d.key as string;
    const variant = (d.variants as Record<string, Variant>)[String(after[key])];
    if (variant && before[key] === after[key]) {
      // Only the specs whose value is this variant take edits to its fields.
      return byField(
        variant.fields,
        idx.filter((i) => (getAt(targets[i], at) as Props | undefined)?.[key] === after[key]),
      );
    }
  }
  if (same(before, after)) return;
  for (const i of idx) out[i] = setAt(out[i], at, after);
}
