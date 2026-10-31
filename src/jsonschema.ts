import { circular, deref, usedName, type Lookup } from './defs.ts';
import { isDynamic } from './expr.ts';
import type { AnyKind, JsonSchema } from './kinds.ts';
import { isBuiltinName, toUserName } from './names.ts';
/**
 * JSON Schema (draft 2020-12), both ways. Out: the JSON form of the values, with everything
 * JSON Schema has no word for kept under `x-` keywords, so a spec survives the round trip.
 * In: best effort for schemas from anywhere (Zod, OpenAPI, hand-written).
 */
import { coreRegistry, registryOf, type Registry } from './registry.ts';
import type { Resolved, ArrayField, EnumField, FieldDecl, Json, MapField, ObjectField, RecordField, Spec, VariantField } from './types.ts';

export interface ToJSONSchemaOptions {
  readonly registry?: Registry;
  /**
   * `input`: what `parse` accepts, so fields that take a default or a zero are not required.
   * `output` (default): what it returns, so every non-optional field is.
   */
  readonly io?: 'input' | 'output';
}

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** Kinds JSON Schema's own keywords name unambiguously; every other kind is marked `x-type`. */
const SELF_EVIDENT = new Set(['string', 'number', 'int', 'boolean', 'enum', 'object', 'array']);

/** Declaration properties every kind handles here, not passed through as `x-props`. */
const BASE_KEYS = new Set([
  'type',
  'label',
  'description',
  'hint',
  'placeholder',
  'examples',
  'aliases',
  'deprecated',
  'default',
  'optional',
  'readOnly',
  'visible',
  'enabled',
  'required',
  'group',
  'order',
  'render',
  'meta',
  'use',
]);

function kindChain(registry: Registry, type: string): AnyKind[] {
  const chain: AnyKind[] = [];
  let name: string | undefined = type;
  while (name !== undefined && !chain.some((k) => k.name === name)) {
    const kind = registry.kinds.get(name);
    if (!kind) break;
    chain.unshift(kind);
    name = kind.base;
  }
  return chain;
}

export function toJSONSchema(spec: Spec, options: ToJSONSchemaOptions = {}): JsonSchema {
  const registry = options.registry ?? registryOf(spec);
  const io = options.io ?? 'output';
  const ctx: Out = { registry, io, lookup: { defs: spec.defs, presets: registry.presets } };
  const out: JsonSchema = { $schema: DIALECT };
  if (typeof spec.title === 'string') out.title = spec.title;
  else if (spec.title !== undefined) out['x-title'] = spec.title;
  if (typeof spec.description === 'string') out.description = spec.description;
  Object.assign(out, objectSchema(ctx, spec.fields, 'error'));
  if (spec.defs) out.$defs = Object.fromEntries(Object.entries(spec.defs).map(([name, decl]) => [name, fieldSchema(ctx, decl)]));
  if (spec.groups) out['x-groups'] = spec.groups;
  if (spec.layouts) out['x-layouts'] = spec.layouts;
  if (spec.functions) out['x-functions'] = spec.functions;
  return out;
}

interface Out {
  readonly registry: Registry;
  readonly io: 'input' | 'output';
  readonly lookup: Lookup;
}

function objectSchema(ctx: Out, fields: ObjectField['fields'], unknown: ObjectField['unknown']): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, decl] of Object.entries(fields)) {
    properties[key] = fieldSchema(ctx, decl);
    const real = deref(ctx.lookup, decl);
    if (real.optional) continue;
    if (ctx.io === 'output' || (real.default === undefined && !hasZero(ctx.registry, real))) required.push(key);
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
    additionalProperties: unknown === 'keep',
  };
}

function hasZero(registry: Registry, decl: Resolved): boolean {
  if (['object', 'variant', 'array', 'set', 'record', 'map'].includes(decl.type)) return true;
  return kindChain(registry, decl.type).some((k) => k.zero && k.zero(decl) !== undefined);
}

const pointerName = (name: string) => name.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * A field built with `use`: a definition becomes `$ref`, a preset is written out in full. Both
 * carry `x-use` and the field's own properties as `x-own`, so the way back restores the field.
 */
function schemaOfUse(ctx: Out, decl: FieldDecl, name: string): JsonSchema {
  const { use: _use, ...own } = decl as FieldDecl & { use: string };
  // Definitions that only name each other in a ring stand for nothing: written out, not a `$ref` to itself.
  const isDef = !isBuiltinName(name) && ctx.lookup.defs?.[name] !== undefined && !circular(ctx.lookup, decl);
  const s: JsonSchema = isDef ? { $ref: `#/$defs/${pointerName(name)}` } : fieldSchema(ctx, deref(ctx.lookup, decl));
  if (isDef) annotate(s, own as Resolved);
  s['x-use'] = name;
  if (Object.keys(own).length > 0) s['x-own'] = own;
  return s;
}

function fieldSchema(ctx: Out, decl: FieldDecl): JsonSchema {
  const name = usedName(decl);
  if (name !== undefined) return schemaOfUse(ctx, decl, name);
  const real = decl as Resolved;
  const s: JsonSchema = { ...shapeOf(ctx, real) };
  if (!SELF_EVIDENT.has(real.type)) s['x-type'] = real.type;
  annotate(s, real);
  return s;
}

/** The annotations JSON Schema has words for, and `x-` for the rest of what every field may say. */
function annotate(s: JsonSchema, decl: Resolved) {
  const text = (prop: 'label' | 'description', keyword: string) => {
    const value = decl[prop];
    if (typeof value === 'string') s[keyword] = value;
    else if (value !== undefined) s[`x-${prop}`] = value;
  };
  text('label', 'title');
  text('description', 'description');
  if (decl.examples) s.examples = decl.examples;
  if (decl.default !== undefined) {
    if (isDynamic(decl.default)) s['x-default'] = decl.default;
    else s.default = decl.default;
  }
  if (decl.deprecated !== undefined && decl.deprecated !== false) {
    s.deprecated = true;
    if (typeof decl.deprecated === 'string') s['x-deprecated'] = decl.deprecated;
  }
  if (decl.readOnly) s.readOnly = true;
  for (const prop of ['hint', 'placeholder', 'aliases', 'visible', 'enabled', 'required', 'group', 'order', 'render', 'meta'] as const)
    if (decl[prop] !== undefined) s[`x-${prop}`] = decl[prop];
  const namedBy = (decl as { namedBy?: unknown }).namedBy;
  if (namedBy !== undefined) s['x-namedBy'] = namedBy;
}

function shapeOf(ctx: Out, decl: Resolved): JsonSchema {
  const { registry } = ctx;
  const child = (d: FieldDecl) => fieldSchema(ctx, d);
  switch (decl.type) {
    case 'object': {
      const o = decl as ObjectField;
      return {
        ...objectSchema(ctx, o.fields, o.unknown),
        ...(o.groups && { 'x-groups': o.groups }),
        ...(o.unknown && { 'x-unknown': o.unknown }),
      };
    }
    case 'variant': {
      const v = decl as VariantField;
      return {
        oneOf: Object.entries(v.variants).map(([name, variant]) => {
          const body = objectSchema(ctx, variant.fields, 'error');
          return {
            ...(typeof variant.label === 'string' && { title: variant.label }),
            ...(typeof variant.description === 'string' && { description: variant.description }),
            ...body,
            properties: { [v.key]: { const: name }, ...(body.properties as object) },
            required: [v.key, ...((body.required as string[]) ?? [])],
            ...(variant.groups && { 'x-groups': variant.groups }),
          };
        }),
        'x-key': v.key,
      };
    }
    case 'array':
    case 'set': {
      const a = decl as ArrayField;
      return {
        type: 'array',
        items: child(a.items),
        ...(a.minItems !== undefined && { minItems: a.minItems }),
        ...(a.maxItems !== undefined && { maxItems: a.maxItems }),
        ...(decl.type === 'set' && { uniqueItems: true }),
      };
    }
    case 'record': {
      const r = decl as RecordField;
      return {
        type: 'object',
        additionalProperties: child(r.values),
        ...(r.keyPattern !== undefined && { propertyNames: { pattern: `^(?:${r.keyPattern})$` } }),
      };
    }
    case 'map': {
      const m = decl as MapField;
      return { type: 'array', items: { type: 'array', prefixItems: [child(m.keys), child(m.values)], minItems: 2, maxItems: 2 } };
    }
  }
  const chain = kindChain(registry, decl.type);
  const own = chain[chain.length - 1];
  let shape: JsonSchema = {};
  for (const kind of chain) if (kind.jsonSchema) shape = { ...shape, ...kind.jsonSchema(decl, { child }) };
  for (const key of Object.keys(shape)) if (shape[key] === undefined) delete shape[key];
  // What JSON Schema cannot say about a declaration travels along, so the way back loses nothing.
  const extra: Record<string, unknown> = {};
  for (const [prop, value] of Object.entries(decl)) {
    if (BASE_KEYS.has(prop) || value === undefined) continue;
    // These have JSON Schema keywords of their own (minLength, minimum, …).
    if (own && ['string', 'number', 'int'].includes(own.name) && ['minLength', 'maxLength', 'pattern', 'min', 'max'].includes(prop))
      continue;
    if (prop === 'format' && own?.name === 'string' && (decl as { format?: string }).format !== 'color') continue;
    if (decl.type === 'enum' && prop === 'options') {
      const options = (decl as EnumField).options;
      const plain =
        Array.isArray(options) &&
        options.every(
          (o) => typeof o !== 'object' || (typeof o.label !== 'object' && o.visible === undefined && typeof o.description !== 'object'),
        );
      if (plain) continue;
    }
    extra[prop] = value;
  }
  if (Object.keys(extra).length > 0) shape['x-props'] = extra;
  return shape;
}

// ── From JSON Schema ─────────────────────────────────────────────────────────────────────

export interface FromJSONSchemaOptions {
  readonly registry?: Registry;
}

// oxlint-disable-next-line typescript/no-explicit-any -- any JSON Schema a caller hands in, read structurally and checked as it is read.
type Schema = Record<string, any>;

/** A spec from a JSON Schema whose root is an object. Unknown shapes become `json` fields. */
export function fromJSONSchema(schema: JsonSchema, options: FromJSONSchemaOptions = {}): Spec {
  const registry = options.registry ?? coreRegistry;
  const root = schema;
  const ctx: FromCtx = { root, registry, depth: 0, defs: {}, names: new Map() };
  const body = derefSchema(ctx, root);
  if (body.type !== 'object' && !body.properties) throw new Error('the root of the schema must be an object with properties');
  const spec: Record<string, unknown> = { fields: fieldsFrom(ctx, body) };
  if (typeof root.title === 'string') spec.title = root.title;
  if (root['x-title'] !== undefined) spec.title = root['x-title'];
  if (typeof root.description === 'string') spec.description = root.description;
  if (root['x-groups']) spec.groups = root['x-groups'];
  if (root['x-layouts']) spec.layouts = root['x-layouts'];
  if (root['x-functions']) spec.functions = root['x-functions'];
  if (Object.keys(ctx.defs).length > 0) spec.defs = ctx.defs;
  return spec as unknown as Spec;
}

interface FromCtx {
  readonly root: Schema;
  readonly registry: Registry;
  depth: number;
  /** Definitions met through `$ref`, converted once each, so recursion stays recursion. */
  readonly defs: Record<string, FieldDecl>;
  /** `$defs` names as they came, to the capitalized names definitions take here. */
  readonly names: Map<string, string>;
}

function uniqueName(ctx: FromCtx, name: string): string {
  let out = name;
  for (let i = 2; out in ctx.defs; i++) out = `${name}${i}`;
  return out;
}

/** The definition a `$ref` names, if it names one. */
function defName(ref: unknown): { group: string; name: string } | undefined {
  if (typeof ref !== 'string') return undefined;
  const m = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref);
  return m ? { group: m[1]!, name: m[2]!.replace(/~1/g, '/').replace(/~0/g, '~') } : undefined;
}

function derefSchema(ctx: FromCtx, s: Schema): Schema {
  let seen = 0;
  while (typeof s.$ref === 'string' && seen++ < 32) {
    const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(s.$ref);
    const target = m ? ctx.root[m[1]!]?.[m[2]!.replace(/~1/g, '/').replace(/~0/g, '~')] : s.$ref === '#' ? ctx.root : undefined;
    if (!target) return {};
    const { $ref: _, ...rest } = s;
    s = { ...target, ...rest };
  }
  if (Array.isArray(s?.allOf) && s.allOf.length === 1) {
    const { allOf, ...rest } = s;
    return derefSchema(ctx, { ...allOf[0], ...rest });
  }
  return s ?? {};
}

function fieldsFrom(ctx: FromCtx, s: Schema, skip?: string): Record<string, FieldDecl> {
  const required = new Set<string>(Array.isArray(s.required) ? s.required : []);
  const fields: Record<string, FieldDecl> = {};
  for (const [key, child] of Object.entries<Schema>(s.properties ?? {})) {
    if (key === skip) continue;
    const decl = fieldFrom(ctx, child) as Record<string, unknown>;
    if (!required.has(key) && decl.default === undefined && decl.optional === undefined) decl.optional = true;
    fields[key] = decl as unknown as FieldDecl;
  }
  return fields;
}

function fieldFrom(ctx: FromCtx, raw: Schema): FieldDecl {
  if (ctx.depth > 32) return { type: 'json' };
  ctx.depth++;
  try {
    const named = defName(raw?.$ref);
    const target = named && ctx.root[named.group]?.[named.name];
    let defined: string | undefined;
    if (named && target) {
      defined = ctx.names.get(named.name);
      if (defined === undefined) {
        defined = uniqueName(ctx, typeof raw['x-use'] === 'string' ? raw['x-use'] : toUserName(named.name));
        ctx.names.set(named.name, defined);
        ctx.defs[defined] = { type: 'json' }; // a placeholder while its own refs are read
        ctx.defs[defined] = fieldFrom(ctx, target);
      }
    }
    // A field written with `use` comes back as it was written.
    if (typeof raw?.['x-use'] === 'string') return { use: defined ?? raw['x-use'], ...raw['x-own'] } as FieldDecl;
    const s = defined ? raw : derefSchema(ctx, raw);
    const decl: Record<string, unknown> = defined ? { use: defined } : shapeFrom(ctx, s);
    if (typeof s.title === 'string') decl.label = s.title;
    if (typeof s.description === 'string') decl.description = s.description;
    if (Array.isArray(s.examples)) decl.examples = s.examples;
    if (s.default !== undefined) decl.default = s.default;
    if (s.deprecated === true) decl.deprecated = s['x-deprecated'] ?? true;
    if (s.readOnly === true) decl.readOnly = true;
    for (const prop of [
      'label',
      'description',
      'default',
      'hint',
      'placeholder',
      'aliases',
      'visible',
      'enabled',
      'required',
      'group',
      'order',
      'render',
      'meta',
      'namedBy',
    ])
      if (s[`x-${prop}`] !== undefined) decl[prop] = s[`x-${prop}`];

    Object.assign(decl, s['x-props'] ?? {});
    return decl as unknown as FieldDecl;
  } finally {
    ctx.depth--;
  }
}

function nonNull(types: unknown): string | undefined {
  if (typeof types === 'string') return types;
  if (Array.isArray(types)) return types.find((t) => t !== 'null');
  return undefined;
}

function shapeFrom(ctx: FromCtx, s: Schema): Record<string, unknown> {
  const xtype: string | undefined = s['x-type'];
  const branches: Schema[] | undefined = s.oneOf ?? s.anyOf;

  if (xtype === 'variant' || (Array.isArray(branches) && s['x-key'])) return variantFrom(ctx, s, s['x-key']);
  if (Array.isArray(branches)) {
    const real = branches.map((b) => derefSchema(ctx, b)).filter((b) => b.type !== 'null');
    if (real.length === 1) return shapeFrom(ctx, { ...real[0], ...omit(s, ['oneOf', 'anyOf']) });
    if (real.every((b) => b.const !== undefined)) {
      return {
        type: 'enum',
        options: real.map((b) =>
          typeof b.title === 'string' || typeof b.description === 'string'
            ? { value: b.const, ...(b.title && { label: b.title }), ...(b.description && { description: b.description }) }
            : b.const,
        ),
      };
    }
    const key = discriminator(real);
    if (key) return variantFrom(ctx, { ...s, oneOf: real }, key);
    return { type: 'json' };
  }
  if (s.const !== undefined) return { type: 'enum', options: [s.const] };
  if (Array.isArray(s.enum)) return { type: 'enum', options: s.enum.filter((v: unknown) => v !== null) };

  const type = nonNull(s.type);
  if (xtype && !['object', 'array', 'string', 'number', 'int', 'boolean', 'enum'].includes(xtype)) {
    const decl: Record<string, unknown> = { type: xtype };
    if (xtype === 'set' && s.items) decl.items = fieldFrom(ctx, s.items);
    if (xtype === 'record') decl.values = fieldFrom(ctx, s.additionalProperties ?? {});
    if (xtype === 'record' && s.propertyNames?.pattern) decl.keyPattern = unwrap(s.propertyNames.pattern);
    if (xtype === 'map') {
      const [k, v] = s.items?.prefixItems ?? [];
      decl.keys = k ? fieldFrom(ctx, k) : { type: 'string' };
      decl.values = v ? fieldFrom(ctx, v) : { type: 'json' };
    }
    if (xtype === 'set' || xtype === 'array') copy(s, decl, ['minItems', 'maxItems']);
    if (xtype === 'date' && s.format === 'date-time') decl.time = true;
    if (['date', 'bigint'].includes(xtype)) copyBounds(s, decl);
    return decl;
  }

  switch (type) {
    case 'string': {
      if (s.format === 'date' || s.format === 'date-time') return { type: 'date', ...(s.format === 'date-time' && { time: true }) };
      const decl: Record<string, unknown> = { type: 'string' };
      copy(s, decl, ['minLength', 'maxLength', 'registry']);
      if (typeof s.pattern === 'string') decl.pattern = unwrap(s.pattern);
      return decl;
    }
    case 'integer':
    case 'number': {
      const decl: Record<string, unknown> = { type: type === 'integer' ? 'int' : 'number' };
      copyBounds(s, decl);
      return decl;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'array': {
      const decl: Record<string, unknown> = {
        type: 'array',
        items: s.items && typeof s.items === 'object' ? fieldFrom(ctx, s.items) : { type: 'json' },
      };
      copy(s, decl, ['minItems', 'maxItems']);
      return decl;
    }
    case 'object':
    case undefined: {
      if (!s.properties && s.additionalProperties && typeof s.additionalProperties === 'object') {
        const decl: Record<string, unknown> = { type: 'record', values: fieldFrom(ctx, s.additionalProperties) };
        if (s.propertyNames?.pattern) decl.keyPattern = unwrap(s.propertyNames.pattern);
        return decl;
      }
      if (!s.properties) return { type: 'json' };
      return {
        type: 'object',
        fields: fieldsFrom(ctx, s),
        ...(s['x-groups'] && { groups: s['x-groups'] }),
        ...((s['x-unknown'] ?? (s.additionalProperties === false ? undefined : 'keep')) && { unknown: s['x-unknown'] ?? 'keep' }),
      };
    }
    default:
      return { type: 'json' };
  }
}

function variantFrom(ctx: FromCtx, s: Schema, key: string): Record<string, unknown> {
  const variants: Record<string, unknown> = {};
  for (const raw of (s.oneOf ?? s.anyOf) as Schema[]) {
    const b = derefSchema(ctx, raw);
    const name = derefSchema(ctx, b.properties?.[key] ?? {}).const;
    if (typeof name !== 'string') continue;
    variants[name] = {
      ...(typeof b.title === 'string' && { label: b.title }),
      ...(typeof b.description === 'string' && { description: b.description }),
      fields: fieldsFrom(ctx, b, key),
      ...(b['x-groups'] && { groups: b['x-groups'] }),
    };
  }
  return { type: 'variant', key, variants };
}

/** The property every branch fixes to a distinct string, if there is one. */
function discriminator(branches: Schema[]): string | undefined {
  if (!branches.every((b) => b.properties)) return undefined;
  const candidates = Object.keys(branches[0]!.properties);
  return candidates.find((key) => {
    const names = branches.map((b) => b.properties[key]?.const);
    return names.every((n) => typeof n === 'string') && new Set(names).size === names.length;
  });
}

function unwrap(pattern: string): string {
  const m = /^\^\(\?:(.*)\)\$$/s.exec(pattern);
  return m ? m[1]! : pattern;
}

function copy(from: Schema, to: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (from[key] !== undefined) to[key] = from[key];
}

function copyBounds(s: Schema, decl: Record<string, unknown>) {
  const min = s.minimum ?? s.exclusiveMinimum;
  const max = s.maximum ?? s.exclusiveMaximum;
  if (min !== undefined && Math.abs(min) !== Number.MAX_SAFE_INTEGER) decl.min = min;
  if (max !== undefined && Math.abs(max) !== Number.MAX_SAFE_INTEGER) decl.max = max;
}

function omit(s: Schema, keys: string[]): Schema {
  const out = { ...s };
  for (const key of keys) delete out[key];
  return out;
}

export type { Json };
