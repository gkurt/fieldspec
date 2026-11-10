/**
 * The headless spec editor, the counterpart of the form: where `createForm` holds a spec's
 * values, `createSpecEditor` holds the spec itself while a person changes it, three ways over
 * one state: its fields as a tree, its JSON as text, and its description in plain words, from
 * which a model of the application writes it. Every edit is checked: the editor takes a spec the
 * checker finds no errors in, and otherwise says why and keeps the last good one. It knows
 * nothing of React and calls no model.
 */
import { checkSpec, type CheckOptions } from './check.ts';
import { deref, type Lookup } from './defs.ts';
import { isExpr } from './expr.ts';
import { humanize } from './form.ts';
import type { AnyKind, JsonSchema } from './kinds.ts';
import { descriptionOf, fingerprint, isDescriptionStale, withDescription } from './meta.ts';
import { isBuiltinName } from './names.ts';
import { escapeSegment, getAt, parsePointer, setAt, splitPointer, unescapeSegment } from './pointer.ts';
import { BASE_PROPS, registryOf, type Registry } from './registry.ts';
import type { ArrayField, Fault, FieldDecl, ObjectField, RecordField, Resolved, Spec, VariantField } from './types.ts';

// ── What the editor shows ────────────────────────────────────────────────────────────────

/** Why an edit was not taken: the text is not JSON (`parse`), or the spec it makes has these errors. */
export interface Refusal {
  /** The JSON parser's message, when the text of {@link SpecEditor.applyJson} is not JSON. */
  readonly parse?: string;
  /** The checker's errors in the spec the edit would make, each at a JSON Pointer into it. */
  readonly faults: readonly Fault[];
}

/** What an edit came to: taken, with the pointer of what it made or changed, or refused. */
export type Edit = { readonly ok: true; readonly path: string } | ({ readonly ok: false } & Refusal);

/** A spec read from JSON text, or why there is none. */
export type ReadSpec = { readonly ok: true; readonly spec: Spec; readonly warnings: readonly Fault[] } | ({ readonly ok: false } & Refusal);

/** A fields map and the fields in it, in order. `path` is where {@link SpecEditor.add} puts a new one. */
export interface SpecFields {
  readonly path: string;
  readonly nodes: readonly SpecNode[];
}

/** One variant of a variant field: its name and its own fields. */
export interface SpecVariant {
  readonly name: string;
  /** A JSON Pointer to the variant, `/fields/auth/variants/token`. */
  readonly path: string;
  readonly label: string;
  readonly fields: SpecFields;
}

/** A field declaration in the spec, with the declarations inside it. */
export interface SpecNode {
  /** A JSON Pointer to the declaration, `/fields/address/fields/street`: what every operation takes. */
  readonly path: string;
  /** Its key among its siblings, or `items`, `values` or `keys` for the declaration a container holds. */
  readonly key: string;
  /** Where it sits: a field of a fields map, a definition, or the declaration a container holds. */
  readonly slot: 'field' | 'def' | 'items' | 'values' | 'keys';
  readonly decl: FieldDecl;
  /** Its kind, with `use` followed. */
  readonly kind: string;
  /** The preset or definition it builds on, if it does. */
  readonly use?: string;
  /** Its label where that is plain text, else one made from its key. */
  readonly label: string;
  /** `required` is `true`. A condition is not: the form decides it. */
  readonly required: boolean;
  readonly optional: boolean;
  /** An object's fields. */
  readonly fields?: SpecFields;
  /** What every item of an array or set follows. */
  readonly items?: SpecNode;
  /** What every value of a record or map follows. */
  readonly values?: SpecNode;
  /** What every key of a map follows. */
  readonly keys?: SpecNode;
  /** A variant field's variants. */
  readonly variants?: readonly SpecVariant[];
}

/** One property a declaration may have, for drawing a control that sets it. */
export interface SpecProp {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the property's value. */
  readonly schema: JsonSchema;
  /** The kind needs it. */
  readonly required: boolean;
  /** It is the kind's own (`min`, `options`), not one every field may have (`label`, `default`). */
  readonly own: boolean;
  /** What the declaration says. */
  readonly value: unknown;
  /** What the preset or definition it builds on says, where the declaration says nothing. */
  readonly inherited?: unknown;
}

/** The editor as it is now. A new object on every change, unlike the editor itself. */
export interface SpecEditorState {
  readonly version: number;
  /** The last spec the checker found no errors in, with its description in `meta.description`. */
  readonly spec: Spec;
  /** The spec's top-level fields, each with what is inside it. */
  readonly fields: SpecFields;
  /** The spec's definitions. */
  readonly defs: SpecFields;
  /** What the checker says of the spec: warnings, and errors only in a spec the editor was created or reset with. */
  readonly faults: readonly Fault[];
  /** Why the last edit was not taken. Gone once an edit is. */
  readonly refused?: Refusal;
  /** The description's text, empty when there is none. */
  readonly description: string;
  /** The description no longer says what the spec is: the spec changed since, or the text was typed since. */
  readonly stale: boolean;
  /**
   * The keys of the top-level fields a generate would replace though no description wrote them:
   * every one, when the spec changed since it last matched its description or never matched one.
   * Empty when nothing would be lost, so ask before generating only while it is not.
   */
  readonly replaces: readonly string[];
  /** A call to the application's model is under way. */
  readonly pending?: 'generate' | 'describe';
}

export interface SpecEditorOptions {
  /** The spec to start from. Default: one without fields. */
  readonly spec?: Spec;
  readonly registry?: Registry;
  /** Passed to the checker with the registry: the function table, extra rules. */
  readonly check?: Omit<CheckOptions, 'registry'>;
  /**
   * Writes a spec from a description with the application's model, revising `spec` when the
   * editor has fields. `prompt(registry)` is the system prompt for it. A spec with errors is
   * refused, so check and retry inside.
   */
  readonly generate?: (description: string, spec: Spec | undefined) => Spec | Promise<Spec>;
  /** Writes a spec's description with the application's model; see `describePrompt`. */
  readonly describe?: (spec: Spec) => string | Promise<string>;
}

export interface AddOptions {
  /** The key. Default: one not taken yet, `field1`. */
  readonly key?: string;
  /** What to add. Default: a string field, an empty variant or group. */
  readonly decl?: unknown;
  /** Where among its siblings. Default: last. */
  readonly index?: number;
}

export interface RenameOptions {
  /** Keep the old key in the field's `aliases`, so values stored under it are still read. */
  readonly alias?: boolean;
}

export interface SpecEditor extends SpecEditorState {
  readonly registry: Registry;
  /** Everything at once, the same object until the next change: what a React hook subscribes to. */
  readonly state: SpecEditorState;
  /** The kinds a field can be. */
  readonly kinds: readonly string[];
  /** The presets and definitions a field can build on with `use`. */
  readonly uses: readonly string[];
  /** The declaration at a pointer, with what is inside it. */
  readonly node: (path: string) => SpecNode | undefined;
  /** The properties the declaration at a pointer may have, the kind's own first. */
  readonly props: (path: string) => readonly SpecProp[];
  /** The spec's faults at a pointer or below it. */
  readonly faultsAt: (path: string) => readonly Fault[];
  /**
   * Adds an entry to a map of the spec: a field to a fields map (`/fields`, `/fields/address/fields`),
   * a definition to `/defs`, a variant to `/fields/auth/variants`, a group to `/groups`.
   */
  readonly add: (map?: string, options?: AddOptions) => Edit;
  /** Removes what is at a pointer, with its translations. What still names it, the checker reports. */
  readonly remove: (path: string) => Edit;
  /**
   * Gives an entry of a map another key, in place. A field's new key is written wherever the
   * spec names the field: `$state`, `$item` and template pointers, `render` and `layouts`
   * placements, `namedBy` and translations. A definition's goes to every `use`, a group's to
   * its members and placements.
   */
  readonly rename: (path: string, key: string, options?: RenameOptions) => Edit;
  /** Moves an entry of a map among its siblings. */
  readonly move: (path: string, index: number) => Edit;
  /**
   * Makes a field another kind. It keeps what the new kind also takes, drops what the new kind
   * refuses (a `default` of the old kind), and gets a start for what the new kind needs (`items`,
   * `options`).
   */
  readonly setKind: (path: string, kind: string) => Edit;
  /**
   * Sets what is at any pointer into the spec, `undefined` removing it: a property of a field
   * (`/fields/name/label`), a whole declaration, a group, the title.
   */
  readonly set: (path: string, value: unknown) => Edit;
  /** Replaces the whole spec. */
  readonly reset: (spec: Spec) => Edit;
  /** The spec as JSON text, indented. */
  readonly json: () => string;
  /** Takes edited JSON text as the spec, when it parses and the checker finds no errors in it. */
  readonly applyJson: (text: string) => Edit;
  /** Sets the description's text as it is typed. It is out of date until generated from or described again. */
  readonly setDescription: (text: string) => void;
  /** Writes the spec from the description with `options.generate`, replacing the fields. */
  readonly generate: () => Promise<Edit>;
  /** Writes the description from the spec with `options.describe`. */
  readonly describe: () => Promise<Edit>;
  readonly subscribe: (listener: () => void) => () => void;
}

// ── Reading JSON ─────────────────────────────────────────────────────────────────────────

const errorsOf = (faults: readonly Fault[]) => faults.filter((f) => f.severity === 'error');

/**
 * A spec from JSON text: the spec and the checker's warnings when the text parses and the
 * checker finds no errors, else the parser's message or the errors.
 */
export function readSpec(text: string, options?: CheckOptions): ReadSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, parse: (error as Error).message, faults: [] };
  }
  const faults = checkSpec(parsed, options);
  const errors = errorsOf(faults);
  return errors.length > 0 ? { ok: false, faults: errors } : { ok: true, spec: parsed as Spec, warnings: faults };
}

// ── The tree ─────────────────────────────────────────────────────────────────────────────

type Fields = { readonly [key: string]: FieldDecl };
type Bag = Record<string, unknown>;

const isObject = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);

const pointerTo = (base: string, key: string) => `${base}/${escapeSegment(key)}`;

function kindChain(registry: Registry, type: string): AnyKind[] {
  const chain: AnyKind[] = [];
  for (let name: string | undefined = type; name !== undefined && !chain.some((k) => k.name === name);) {
    const kind = registry.kinds.get(name);
    if (!kind) break;
    chain.unshift(kind);
    name = kind.base;
  }
  return chain;
}

function nodeOf(lookup: Lookup, decl: FieldDecl, path: string, key: string, slot: SpecNode['slot']): SpecNode {
  const real = isObject(decl) ? deref(lookup, decl) : ({ type: 'json' } as Resolved);
  const own: Bag = isObject(decl) ? decl : {};
  const inner = (prop: 'items' | 'values' | 'keys') =>
    isObject(own[prop]) ? nodeOf(lookup, own[prop] as FieldDecl, `${path}/${prop}`, prop, prop) : undefined;
  const fields = isObject(own.fields) ? fieldsOf(lookup, own.fields as Fields, `${path}/fields`, 'field') : undefined;
  const variants = isObject(own.variants)
    ? Object.entries(own.variants).map(([name, variant]): SpecVariant => {
        const at = pointerTo(`${path}/variants`, name);
        const inside = isObject(variant) && isObject(variant.fields) ? (variant.fields as Fields) : {};
        const label = isObject(variant) && typeof variant.label === 'string' ? variant.label : humanize(name);
        return { name, path: at, label, fields: fieldsOf(lookup, inside, `${at}/fields`, 'field') };
      })
    : undefined;
  const [items, values, keys] = [inner('items'), inner('values'), inner('keys')];
  return {
    path,
    key,
    slot,
    decl,
    kind: typeof real.type === 'string' ? real.type : 'json',
    ...(typeof own.use === 'string' && own.type === undefined && { use: own.use }),
    label: typeof real.label === 'string' ? real.label : humanize(key),
    required: real.required === true,
    optional: real.optional === true,
    ...(fields && { fields }),
    ...(items && { items }),
    ...(values && { values }),
    ...(keys && { keys }),
    ...(variants && { variants }),
  };
}

function fieldsOf(lookup: Lookup, fields: Fields | undefined, path: string, slot: SpecNode['slot']): SpecFields {
  return { path, nodes: Object.entries(fields ?? {}).map(([key, decl]) => nodeOf(lookup, decl, pointerTo(path, key), key, slot)) };
}

function findNode(fields: SpecFields, path: string): SpecNode | undefined {
  for (const node of fields.nodes) {
    if (node.path === path) return node;
    if (!path.startsWith(`${node.path}/`)) continue;
    for (const inner of [node.items, node.values, node.keys]) {
      if (inner?.path === path) return inner;
      const found = inner && path.startsWith(`${inner.path}/`) ? findNode({ path: '', nodes: [inner] }, path) : undefined;
      if (found) return found;
    }
    for (const part of [node.fields, ...(node.variants ?? []).map((v) => v.fields)]) {
      const found = part && findNode(part, path);
      if (found) return found;
    }
  }
  return undefined;
}

// ── Maps: adding, renaming, moving ───────────────────────────────────────────────────────

/** What a new entry of a map is, and what its key starts with, by the map's own key. */
const STARTS: { readonly [map: string]: readonly [stem: string, decl: unknown] } = {
  fields: ['field', { type: 'string' }],
  defs: ['Definition', { type: 'string' }],
  variants: ['variant', { fields: {} }],
  groups: ['group', {}],
};

/** What a kind needs to begin with, for the core kinds; another kind's example gives its own. */
const NEEDS: { readonly [prop: string]: unknown } = {
  options: ['option1', 'option2'],
  items: { type: 'string' },
  values: { type: 'string' },
  keys: { type: 'string' },
  fields: {},
  key: 'type',
  variants: { variant1: { fields: {} } },
};

function freshKey(map: Bag, stem: string): string {
  for (let n = Object.keys(map).length + 1; ; n++) if (!(`${stem}${n}` in map)) return `${stem}${n}`;
}

function insertAt(map: Bag, key: string, value: unknown, index: number | undefined): Bag {
  const entries = Object.entries(map).filter(([k]) => k !== key);
  const at = index === undefined ? entries.length : Math.max(0, Math.min(index, entries.length));
  entries.splice(at, 0, [key, value]);
  return Object.fromEntries(entries);
}

const rekeyed = (map: Bag, from: string, to: string): Bag =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [k === from ? to : k, v]));

/** One string of the spec to write anew. */
type Rewrite = readonly [path: string, text: string];

// ── Renaming a field: finding what names it ──────────────────────────────────────────────

/** Where pointers are read from: the spec's own fields, or a definition, which may be placed anywhere. */
interface From {
  readonly fields?: Fields;
  readonly decl?: FieldDecl;
}

/** Where an expression sits: what its relative pointers start from. `base` is unknown on a definition's own properties. */
interface Scope {
  readonly from: From;
  readonly base: readonly string[] | undefined;
}

/** The field being renamed: the fields map it is in, by identity, and its keys. */
interface Renamed {
  readonly map: Fields;
  readonly old: string;
  readonly key: string;
}

/**
 * For each segment of a path through values, the fields map the segment is a key of, or
 * undefined where it steps into an item. Undefined when the path leads to no declaration.
 */
function trace(lookup: Lookup, from: From, segments: readonly string[], prefer: Fields): (Fields | undefined)[] | undefined {
  const maps: (Fields | undefined)[] = [];
  let fields = from.fields;
  let decl: Resolved | undefined;
  let variant: VariantField | undefined;
  const enter = (next: unknown): boolean => {
    if (!isObject(next)) return false;
    decl = deref(lookup, next as FieldDecl);
    fields = decl.type === 'object' && isObject((decl as ObjectField).fields) ? (decl as ObjectField).fields : undefined;
    variant = decl.type === 'variant' && isObject((decl as VariantField).variants) ? (decl as VariantField) : undefined;
    return true;
  };
  if (from.decl && !enter(from.decl)) return undefined;
  for (const segment of segments) {
    if (fields) {
      maps.push(fields);
      if (!enter(fields[segment])) return undefined;
    } else if (variant) {
      const inside = Object.values(variant.variants)
        .map((v) => v?.fields)
        .filter((f) => isObject(f) && segment in f);
      const map = inside.includes(prefer) ? prefer : inside[0];
      maps.push(map);
      if (!enter(map ? map[segment] : segment === variant.key ? { type: 'string' } : undefined)) return undefined;
    } else if (decl && (decl.type === 'array' || decl.type === 'set')) {
      maps.push(undefined);
      if (!enter((decl as ArrayField).items)) return undefined;
    } else if (decl && (decl.type === 'record' || decl.type === 'map')) {
      maps.push(undefined);
      if (!enter((decl as RecordField).values)) return undefined;
    } else {
      return undefined;
    }
  }
  return maps;
}

/** A pointer as a spec writes it, with the renamed field's key replaced wherever the pointer goes through it. */
function repoint(lookup: Lookup, spec: Spec, scope: Scope, text: string, renamed: Renamed): string {
  const absolute = text.startsWith('/');
  let climbs = 0;
  let rest = text;
  if (!absolute) {
    for (;;) {
      if (rest === '..' || rest.startsWith('../')) {
        climbs++;
        rest = rest.slice(3);
      } else if (rest === '.' || rest.startsWith('./')) {
        rest = rest.slice(2);
      } else {
        break;
      }
    }
  }
  const own = absolute ? parsePointer(text) : rest === '' ? [] : rest.split('/').map(unescapeSegment);
  if (!absolute && (scope.base === undefined || climbs > scope.base.length)) return text;
  const kept = absolute ? [] : scope.base!.slice(0, scope.base!.length - climbs);
  const maps = trace(lookup, absolute ? { fields: spec.fields } : scope.from, [...kept, ...own], renamed.map);
  if (!maps) return text;
  let changed = false;
  const next = own.map((segment, i) => {
    if (maps[kept.length + i] !== renamed.map || segment !== renamed.old) return segment;
    changed = true;
    return renamed.key;
  });
  if (!changed) return text;
  if (absolute) return next.map((s) => `/${escapeSegment(s)}`).join('');
  return text.slice(0, text.length - rest.length) + next.map(escapeSegment).join('/');
}

/**
 * Every string of the spec that names the renamed field, with the new key in it (`rewrites`),
 * and every literal value the spec gives that holds the field under its old key (`rekeys`): a
 * `default`, a `value` or an example of the object it is in, or of a list of such objects.
 */
function fieldRewrites(spec: Spec, registry: Registry, renamed: Renamed): { rewrites: Rewrite[]; rekeys: string[] } {
  const lookup: Lookup = { defs: spec.defs, presets: registry.presets };
  const out: Rewrite[] = [];
  const rekeys: string[] = [];

  /** A literal value against the declaration it is a value of. */
  const literal = (of: unknown, value: unknown, at: string): void => {
    if (!isObject(of) || value === null || typeof value !== 'object' || isExpr(value)) return;
    const real = deref(lookup, of as FieldDecl);
    if (Array.isArray(value)) {
      if (real.type === 'array' || real.type === 'set') value.forEach((v, i) => literal((real as ArrayField).items, v, `${at}/${i}`));
      return;
    }
    const held = value as Bag;
    if (real.type === 'record') {
      for (const [k, v] of Object.entries(held)) literal((real as RecordField).values, v, pointerTo(at, k));
      return;
    }
    const variant = real.type === 'variant' ? (real as VariantField).variants?.[String(held[(real as VariantField).key])] : undefined;
    const fields = real.type === 'object' ? (real as ObjectField).fields : variant?.fields;
    if (!isObject(fields)) return;
    if (fields === renamed.map && renamed.old in held) rekeys.push(at);
    for (const [k, v] of Object.entries(held)) literal(fields[k], v, pointerTo(at, k));
  };

  const point = (at: string, text: unknown, scope: Scope) => {
    if (typeof text !== 'string') return;
    const next = repoint(lookup, spec, scope, text, renamed);
    if (next !== text) out.push([at, next]);
  };

  /** Expressions anywhere in a value: `$state`, `$item` and the pointers of a `$template`. */
  const scan = (value: unknown, at: string, scope: Scope): void => {
    if (Array.isArray(value)) return value.forEach((v, i) => scan(v, `${at}/${i}`, scope));
    if (!isObject(value)) return;
    point(`${at}/$state`, value.$state, scope);
    if (typeof value.$item === 'string' && !value.$item.startsWith('/') && scope.base?.includes('*')) {
      const item = scope.base.slice(0, scope.base.lastIndexOf('*') + 1);
      point(`${at}/$item`, value.$item, { from: scope.from, base: item });
    }
    if (typeof value.$template === 'string') {
      const next = value.$template.replace(/\$\{([^}]*)\}/g, (_, p: string) => `\${${repoint(lookup, spec, scope, p.trim(), renamed)}}`);
      const same = value.$template.replace(/\$\{([^}]*)\}/g, (_, p: string) => `\${${p.trim()}}`);
      if (next !== same) out.push([`${at}/$template`, next]);
    }
    for (const [k, v] of Object.entries(value)) if (isObject(v) || Array.isArray(v)) scan(v, pointerTo(at, k), scope);
  };

  /** A placement in a `render`: a key of the scope's fields, or a path from them. */
  const place = (at: string, ref: unknown, fields: Fields | undefined) => {
    if (typeof ref !== 'string' || !fields) return;
    const segments = ref.split('/');
    const maps = trace(lookup, { fields }, segments, renamed.map);
    if (!maps) return;
    const next = segments.map((s, i) => (maps[i] === renamed.map && s === renamed.old ? renamed.key : s)).join('/');
    if (next !== ref) out.push([at, next]);
  };

  const render = (node: unknown, at: string, fields: Fields | undefined, scope: Scope): void => {
    if (!isObject(node)) return;
    if (node.type === undefined) return place(`${at}/field`, node.field, fields);
    const props = isObject(node.props) ? node.props : {};
    for (const [name, value] of Object.entries(props)) {
      const pat = pointerTo(`${at}/props`, name);
      if (name === 'field') place(pat, value, fields);
      else if (name === 'fields' && Array.isArray(value)) value.forEach((f, i) => place(`${pat}/${i}`, f, fields));
      else scan(value, pat, scope);
    }
    scan(node.visible, `${at}/visible`, scope);
    if (Array.isArray(node.children)) node.children.forEach((child, i) => render(child, `${at}/children/${i}`, fields, scope));
  };

  const groups = (map: unknown, at: string, fields: Fields, scope: Scope) => {
    if (!isObject(map)) return;
    for (const [id, group] of Object.entries(map)) {
      if (!isObject(group)) continue;
      const gat = pointerTo(at, id);
      for (const prop of ['label', 'description', 'visible']) scan(group[prop], `${gat}/${prop}`, scope);
      render(group.render, `${gat}/render`, fields, scope);
    }
  };

  const fieldsMap = (map: unknown, at: string, scope: Scope) => {
    if (!isObject(map)) return;
    for (const [key, decl] of Object.entries(map)) declaration(decl, pointerTo(at, key), scope, scope.base && [...scope.base, key]);
  };

  /** A declaration: `scope` is where its own expressions read from, `self` its own path through the values. */
  const declaration = (decl: unknown, at: string, scope: Scope, self: readonly string[] | undefined) => {
    if (!isObject(decl)) return;
    const inside: Scope = { from: scope.from, base: self };
    const item: Scope = { from: scope.from, base: self && [...self, '*'] };
    for (const [prop, value] of Object.entries(decl)) {
      const pat = pointerTo(at, prop);
      if (prop === 'meta') continue;
      if (prop === 'default' || prop === 'value') literal(decl, value, pat);
      if (prop === 'examples') {
        if (Array.isArray(value)) value.forEach((example, i) => literal(decl, example, `${pat}/${i}`));
        continue;
      }
      if (prop === 'fields') {
        fieldsMap(value, pat, inside);
      } else if (prop === 'groups') {
        groups(value, pat, isObject(decl.fields) ? (decl.fields as Fields) : {}, inside);
      } else if (prop === 'items' || prop === 'values') {
        declaration(value, pat, item, item.base);
      } else if (prop === 'keys') {
        declaration(value, pat, scope, item.base);
      } else if (prop === 'variants' && isObject(value)) {
        for (const [name, variant] of Object.entries(value)) {
          if (!isObject(variant)) continue;
          const vat = pointerTo(pat, name);
          fieldsMap(variant.fields, `${vat}/fields`, inside);
          groups(variant.groups, `${vat}/groups`, isObject(variant.fields) ? (variant.fields as Fields) : {}, inside);
        }
      } else if (prop === 'namedBy' && typeof value === 'string') {
        // A pointer into the item: its segments are the item's own fields.
        const held = decl.items ?? decl.values;
        if (value !== '' && !value.startsWith('/') && !value.startsWith('.') && isObject(held)) {
          const segments = value.split('/');
          const maps = trace(lookup, { decl: held as FieldDecl }, segments, renamed.map);
          const next = maps && segments.map((s, i) => (maps[i] === renamed.map && s === renamed.old ? renamed.key : s)).join('/');
          if (next && next !== value) out.push([pat, next]);
        }
      } else if (prop === 'namedBy') {
        scan(value, pat, item);
      } else if (prop === 'render') {
        render(value, pat, isObject(decl.fields) ? (decl.fields as Fields) : undefined, isObject(decl.fields) ? inside : scope);
      } else if (isObject(value) || Array.isArray(value)) {
        scan(value, pat, scope);
      }
    }
  };

  const root: Scope = { from: { fields: spec.fields }, base: [] };
  scan(spec.title, '/title', root);
  scan(spec.description, '/description', root);
  fieldsMap(spec.fields, '/fields', root);
  groups(spec.groups, '/groups', spec.fields, root);
  for (const [name, node] of Object.entries(spec.layouts ?? {})) render(node, pointerTo('/layouts', name), spec.fields, root);
  // A definition's own properties read from wherever it is placed; what is inside it reads from the definition.
  for (const [name, decl] of Object.entries(spec.defs ?? {}))
    declaration(decl, pointerTo('/defs', name), { from: { decl }, base: undefined }, []);
  return { rewrites: out, rekeys };
}

/** Every `use` of a definition, to name it anew. */
function definitionRewrites(value: unknown, at: string, old: string, key: string, out: Rewrite[] = []): Rewrite[] {
  if (Array.isArray(value)) value.forEach((v, i) => definitionRewrites(v, `${at}/${i}`, old, key, out));
  if (!isObject(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (k === 'use' && v === old) out.push([`${at}/use`, key]);
    else if (k !== 'meta') definitionRewrites(v, pointerTo(at, k), old, key, out);
  }
  return out;
}

/** Every mention of a group in the scope it is declared in: its members, its subgroups, and where renders place it. */
function groupRewrites(spec: Spec, holder: string, old: string, key: string): Rewrite[] {
  const out: Rewrite[] = [];
  const scope = getAt(spec, holder);
  if (!isObject(scope)) return out;
  const placed = (node: unknown, at: string): void => {
    if (!isObject(node)) return;
    if (node.type === undefined && node.group === old) out.push([`${at}/group`, key]);
    if (node.type === 'group' && isObject(node.props) && node.props.group === old) out.push([`${at}/props/group`, key]);
    if (Array.isArray(node.children)) node.children.forEach((child, i) => placed(child, `${at}/children/${i}`));
  };
  for (const [name, decl] of Object.entries(isObject(scope.fields) ? scope.fields : {}))
    if (isObject(decl) && decl.group === old) out.push([`${pointerTo(`${holder}/fields`, name)}/group`, key]);
  for (const [id, group] of Object.entries(isObject(scope.groups) ? scope.groups : {})) {
    if (!isObject(group)) continue;
    const at = pointerTo(`${holder}/groups`, id);
    if (group.group === old) out.push([`${at}/group`, key]);
    placed(group.render, `${at}/render`);
  }
  placed(scope.render, `${holder}/render`);
  if (holder === '') for (const [name, node] of Object.entries(spec.layouts ?? {})) placed(node, pointerTo('/layouts', name));
  return out;
}

/** The spec's translations with every pointer at `from` or below it moved to `to`, or dropped. */
function retranslated(spec: Spec, from: string, to: string | undefined): Spec {
  if (!isObject(spec.locales)) return spec;
  let touched = false;
  const locales = Object.fromEntries(
    Object.entries(spec.locales).map(([tag, table]) => {
      if (!isObject(table)) return [tag, table];
      const entries = Object.entries(table).flatMap(([pointer, text]): [string, unknown][] => {
        if (pointer !== from && !pointer.startsWith(`${from}/`)) return [[pointer, text]];
        touched = true;
        return to === undefined ? [] : [[to + pointer.slice(from.length), text]];
      });
      return [tag, Object.fromEntries(entries)];
    }),
  );
  return touched ? ({ ...spec, locales } as Spec) : spec;
}

// ── The editor ───────────────────────────────────────────────────────────────────────────

const EMPTY: Spec = { fields: {} };

type Refused = Edit & { readonly ok: false };

const refusal = (path: string, message: string): Refused => ({ ok: false, faults: [{ path, message, severity: 'error' }] });

export function createSpecEditor(options: SpecEditorOptions = {}): SpecEditor {
  const registry = options.registry ?? registryOf(options.spec ?? EMPTY);
  const checkOptions: CheckOptions = { ...options.check, registry };
  const listeners = new Set<() => void>();
  let spec: Spec = options.spec ?? EMPTY;
  let faults: readonly Fault[] = checkSpec(spec, checkOptions);
  let refused: Refusal | undefined;
  let pending: SpecEditorState['pending'];
  let version = 0;
  let state: SpecEditorState | undefined;
  /** The fingerprint of the spec when it last matched its description. */
  let matched: string | undefined = descriptionOf(spec)?.of || undefined;

  const lookup = (): Lookup => ({ defs: spec.defs, presets: registry.presets });
  const changed = () => {
    version++;
    state = undefined;
    for (const listener of listeners) listener();
  };
  const refuse = (edit: Refused): Edit => {
    refused = edit.parse === undefined ? { faults: edit.faults } : { parse: edit.parse, faults: edit.faults };
    changed();
    return edit;
  };
  /** Takes the spec an edit makes when the checker finds no errors in it. */
  const commit = (next: Spec, path: string): Edit => {
    let found: Fault[];
    try {
      found = checkSpec(next, checkOptions);
    } catch (error) {
      found = [{ path: '', message: (error as Error).message, severity: 'error' }];
    }
    const errors = errorsOf(found);
    if (errors.length > 0) return refuse({ ok: false, faults: errors });
    spec = next;
    faults = found;
    refused = undefined;
    changed();
    return { ok: true, path };
  };
  const rewritten = (from: Spec, rewrites: readonly Rewrite[]): Spec =>
    rewrites.reduce<Spec>((s, [at, text]) => setAt(s, at, text) as Spec, from);

  const current = (): SpecEditorState => {
    if (state) return state;
    const description = descriptionOf(spec);
    const keys = Object.keys(isObject(spec.fields) ? spec.fields : {});
    state = {
      version,
      spec,
      fields: fieldsOf(lookup(), isObject(spec.fields) ? spec.fields : {}, '/fields', 'field'),
      defs: fieldsOf(lookup(), isObject(spec.defs) ? spec.defs : {}, '/defs', 'def'),
      faults,
      ...(refused && { refused }),
      description: description?.text ?? '',
      stale: isDescriptionStale(spec),
      replaces: keys.length > 0 && fingerprint(spec) !== matched ? keys : [],
      ...(pending && { pending }),
    };
    return state;
  };

  const editor: SpecEditor = {
    registry,
    get state() {
      return current();
    },
    get version() {
      return version;
    },
    get spec() {
      return spec;
    },
    get fields() {
      return current().fields;
    },
    get defs() {
      return current().defs;
    },
    get faults() {
      return faults;
    },
    get refused() {
      return refused;
    },
    get description() {
      return current().description;
    },
    get stale() {
      return current().stale;
    },
    get replaces() {
      return current().replaces;
    },
    get pending() {
      return pending;
    },
    get kinds() {
      return [...registry.kinds.keys()];
    },
    get uses() {
      return [...Object.keys(spec.defs ?? {}), ...Object.keys(registry.presets)];
    },
    node: (path) => findNode(current().fields, path) ?? findNode(current().defs, path),
    props(path) {
      const decl = getAt(spec, path);
      if (!isObject(decl)) return [];
      const real = deref(lookup(), decl as FieldDecl) as unknown as Bag;
      const prop = (name: string, info: (typeof BASE_PROPS)[string], own: boolean): SpecProp => ({
        name,
        description: info.description,
        schema: info.schema,
        required: info.required === true,
        own,
        value: decl[name],
        ...(decl[name] === undefined && real[name] !== undefined && { inherited: real[name] }),
      });
      const own = new Map<string, SpecProp>();
      for (const kind of kindChain(registry, String(real.type)))
        for (const [name, info] of Object.entries(kind.props ?? {})) own.set(name, prop(name, info, true));
      return [...own.values(), ...Object.entries(BASE_PROPS).map(([name, info]) => prop(name, info, false))];
    },
    faultsAt: (path) => faults.filter((f) => f.path === path || f.path.startsWith(`${path}/`)),

    add(map = '/fields', given = {}) {
      const held = getAt(spec, map);
      if (held !== undefined && !isObject(held)) return refuse(refusal(map, 'holds no entries to add one to'));
      const [stem, start] = STARTS[splitPointer(map)[1]] ?? ['entry', {}];
      const entries = held ?? {};
      const key = given.key ?? freshKey(entries, stem);
      const path = pointerTo(map, key);
      if (key in entries) return refuse(refusal(path, `"${key}" is already here; give it another key`));
      return commit(setAt(spec, map, insertAt(entries, key, given.decl ?? start, given.index)) as Spec, path);
    },
    remove(path) {
      if (getAt(spec, path) === undefined) return refuse(refusal(path, 'is not in the spec'));
      return commit(retranslated(setAt(spec, path, undefined) as Spec, path, undefined), path);
    },
    rename(path, key, given = {}) {
      const [map, old] = splitPointer(path);
      const entries = getAt(spec, map);
      if (!isObject(entries) || !(old in entries)) return refuse(refusal(path, 'is not in the spec'));
      if (key === old) return { ok: true, path };
      const to = pointerTo(map, key);
      if (key in entries) return refuse(refusal(to, `"${key}" is already here; give it another key`));
      const [holder, within] = splitPointer(map);
      const named = within === 'fields' ? fieldRewrites(spec, registry, { map: entries as Fields, old, key }) : undefined;
      const rewrites = named
        ? named.rewrites
        : map === '/defs'
          ? definitionRewrites(spec, '', old, key)
          : within === 'groups'
            ? groupRewrites(spec, holder, old, key)
            : [];
      let next = rewritten(spec, rewrites);
      // Deepest first, so a pointer through the old key still leads where it did.
      for (const at of (named?.rekeys ?? []).toSorted((a, b) => b.length - a.length))
        next = setAt(next, at, rekeyed(getAt(next, at) as Bag, old, key)) as Spec;
      next = setAt(next, map, rekeyed(getAt(next, map) as Bag, old, key)) as Spec;
      next = retranslated(next, path, to);
      const decl = getAt(next, to);
      if (given.alias && within === 'fields' && isObject(decl)) {
        const aliases = Array.isArray(decl.aliases) ? (decl.aliases as unknown[]).filter((a) => a !== key) : [];
        next = setAt(next, `${to}/aliases`, aliases.includes(old) ? aliases : [...aliases, old]) as Spec;
      }
      return commit(next, to);
    },
    move(path, index) {
      const [map, key] = splitPointer(path);
      const entries = getAt(spec, map);
      if (!isObject(entries) || !(key in entries)) return refuse(refusal(path, 'is not in the spec'));
      return commit(setAt(spec, map, insertAt(entries, key, entries[key], index)) as Spec, path);
    },
    setKind(path, kind) {
      const decl = getAt(spec, path);
      if (!isObject(decl)) return refuse(refusal(path, 'is not a field declaration'));
      const chain = kindChain(registry, kind);
      if (chain.length === 0)
        return refuse(refusal(`${path}/type`, `"${kind}" is not a kind of this registry: ${[...registry.kinds.keys()].join(', ')}`));
      const takes = new Map(chain.flatMap((k) => Object.entries(k.props ?? {})));
      const kept = Object.entries(decl).filter(([prop]) => prop !== 'type' && prop !== 'use' && (prop in BASE_PROPS || takes.has(prop)));
      const next: Bag = { type: kind, ...Object.fromEntries(kept) };
      for (const [prop, info] of takes) {
        if (!info.required || next[prop] !== undefined) continue;
        const example = chain.map((k) => k.example?.[prop]).find((v) => v !== undefined);
        next[prop] = isBuiltinName(kind) ? (NEEDS[prop] ?? example) : (example ?? NEEDS[prop]);
      }
      // What the new kind refuses of the old declaration (a default, a bound of another type) goes.
      for (let tries = Object.keys(next).length; tries > 0; tries--) {
        const candidate = setAt(spec, path, next) as Spec;
        const dropped = new Set<string>();
        for (const fault of errorsOf(checkSpec(candidate, checkOptions))) {
          if (!fault.path.startsWith(`${path}/`)) continue;
          const prop = parsePointer(fault.path.slice(path.length))[0]!;
          if (prop !== 'type' && kept.some(([k]) => k === prop) && prop in next) dropped.add(prop);
        }
        if (dropped.size === 0) break;
        for (const prop of dropped) delete next[prop];
      }
      return commit(setAt(spec, path, next) as Spec, path);
    },
    set(path, value) {
      if (path === '')
        return isObject(value) ? editor.reset(value as unknown as Spec) : refuse(refusal('', 'must be an object with `fields`'));
      return commit(setAt(spec, path, value) as Spec, path);
    },
    reset(next) {
      const edit = commit(next, '');
      if (edit.ok) matched = descriptionOf(spec)?.of || matched;
      return edit;
    },
    json: () => JSON.stringify(spec, null, 2),
    applyJson(text) {
      const read = readSpec(text, checkOptions);
      return read.ok ? editor.reset(read.spec) : refuse(read);
    },
    setDescription(text) {
      if (text === (descriptionOf(spec)?.text ?? '')) return;
      spec = withDescription(spec, text.trim() === '' ? undefined : { text, of: '' });
      changed();
    },
    async generate() {
      const write = options.generate;
      if (!write) throw new Error('createSpecEditor was given no `generate` to write a spec with');
      const text = descriptionOf(spec)?.text.trim() ?? '';
      if (text === '') return refuse(refusal('/meta/description/text', 'required: say what the spec is for, to write it from'));
      const { meta, ...bare } = spec;
      pending = 'generate';
      changed();
      let written: Spec;
      try {
        written = await write(text, Object.keys(bare.fields ?? {}).length > 0 ? bare : undefined);
      } finally {
        pending = undefined;
        changed();
      }
      const { description: _, ...others } = meta ?? {};
      const kept = isObject(written) ? ({ ...written, meta: { ...others, ...written.meta } } as Spec) : written;
      const edit = commit(isObject(kept) ? withDescription(kept, text) : kept, '');
      if (edit.ok) matched = fingerprint(spec);
      return edit;
    },
    async describe() {
      const say = options.describe;
      if (!say) throw new Error('createSpecEditor was given no `describe` to write a description with');
      const { meta: _, ...described } = spec;
      pending = 'describe';
      changed();
      let text: string;
      try {
        text = await say(described);
      } finally {
        pending = undefined;
        changed();
      }
      if (typeof text !== 'string' || text.trim() === '')
        return refuse(refusal('/meta/description/text', 'the description came back empty'));
      // Stamped with the spec that was described: one edited meanwhile is already out of date.
      matched = fingerprint(described);
      spec = withDescription(spec, { text: text.trim(), of: matched });
      refused = undefined;
      changed();
      return { ok: true, path: '/meta/description' };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return editor;
}
