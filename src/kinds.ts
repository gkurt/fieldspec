/**
 * Kinds: what a field's `type` names. A kind says how its values are checked, how they cross
 * JSON, what its zero is, which properties its declaration takes, and how it reads as JSON
 * Schema. Core kinds and extension kinds are defined the same way.
 */
import { evaluate, type Env, type Scope } from './expr.ts';
import type { EnumField, EnumOption, Expr, FieldDecl, Json, OptionValue } from './types.ts';

export type JsonSchema = { [keyword: string]: unknown };

/** One property a kind's declaration takes, beyond {@link FieldBase}'s. */
export interface PropInfo {
  /** JSON Schema for the property's value, used by the meta-schema and the checker. */
  readonly schema: JsonSchema;
  readonly description: string;
  readonly required?: boolean;
}

export interface LeafContext {
  readonly env: Env;
  readonly scope: Scope;
  /**
   * What the field is called in a message, in lowercase words: the definition or preset it
   * uses (`Slug` is "slug"), else its label or key. Absent for an unnamed item.
   */
  readonly name?: string;
  issue(code: string, message: string): void;
}

export interface DeclContext {
  /** Report a fault at a property of this declaration (`"min"`) or the declaration itself (`""`). */
  fault(prop: string, message: string, severity?: 'error' | 'warning'): void;
}

export interface SchemaContext {
  /** The JSON Schema of a child declaration. */
  child(decl: FieldDecl): JsonSchema;
}

export interface Kind<Name extends string = string, Value = unknown, Decl = {}> {
  readonly name: Name;
  /** One line, for prompts and docs. */
  readonly description: string;
  /**
   * A kind this one refines. Its checks run first, and renderers and JSON Schema fall back to
   * it when they do not know this one.
   */
  readonly base?: string;
  readonly props?: { readonly [prop: string]: PropInfo };
  /** An example declaration, for prompts. */
  readonly example?: { readonly [prop: string]: Json };
  /** The control element that edits it unless a field's `render` picks another. Inherited from `base`. */
  readonly control?: string | ((decl: Decl & FieldDecl) => string);
  /** The value an absent, non-optional field without a default takes. None: it stays absent. */
  zero?(decl: Decl & FieldDecl): Value | undefined;
  check?(value: unknown, decl: Decl & FieldDecl, ctx: LeafContext): void;
  checkDecl?(decl: Decl & FieldDecl, ctx: DeclContext): void;
  /** To JSON. Identity when absent. */
  encode?(value: Value, decl: Decl & FieldDecl): Json;
  /** From JSON, leaving anything it cannot read as it is for {@link check} to report. */
  decode?(json: unknown, decl: Decl & FieldDecl): unknown;
  jsonSchema?(decl: Decl & FieldDecl, ctx: SchemaContext): JsonSchema;
  /** Phantom: the value type, for inference. */
  readonly __value?: Value;
}

// oxlint-disable-next-line typescript/no-explicit-any -- any kind, whatever its value and declaration types: both appear in parameters, so `unknown` would reject every real kind.
export type AnyKind = Kind<string, any, any>;

/**
 * Define a kind. Curried so the value and declaration types can be given while the name is
 * inferred: `defineKind<string, { swatches?: string[] }>()({ name: "color", … })`.
 */
export function defineKind<Value, Decl = {}>() {
  return <const Name extends string>(kind: Kind<Name, Value, Decl>): Kind<Name, Value, Decl> => kind;
}

// ── Helpers shared by kinds ──────────────────────────────────────────────────────────────

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function bounds(decl: { min?: unknown; max?: unknown }, ctx: DeclContext, parse: (v: unknown) => number) {
  const min = decl.min === undefined ? undefined : parse(decl.min);
  const max = decl.max === undefined ? undefined : parse(decl.max);
  if (min !== undefined && Number.isNaN(min)) ctx.fault('min', 'must be a valid bound');
  if (max !== undefined && Number.isNaN(max)) ctx.fault('max', 'must be a valid bound');
  if (min !== undefined && max !== undefined && min > max) ctx.fault('max', 'must be at least min');
}

/** The options of an enum, evaluated and normalized to objects. */
export function optionsOf(decl: EnumField, env: Env, scope: Scope): EnumOption[] {
  const raw = Array.isArray(decl.options) ? decl.options : evaluate(decl.options as Expr, env, scope);
  if (!Array.isArray(raw)) return [];
  return raw.map((o: OptionValue | EnumOption) => (typeof o === 'object' && o !== null ? o : { value: o }));
}

const STRING_FORMATS: Record<string, (s: string) => boolean> = {
  email: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
  uri: (s) => URL.canParse(s),
  uuid: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  hostname: (s) => /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(s),
  ipv4: (s) => /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(s),
  color: (s) => /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s),
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

function dateOf(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function regexpOf(value: unknown): RegExp | undefined {
  if (value instanceof RegExp) return value;
  if (typeof value !== 'string') return undefined;
  const m = /^\/(.*)\/([dgimsuvy]*)$/s.exec(value);
  try {
    return m ? new RegExp(m[1]!, m[2]) : new RegExp(value);
  } catch {
    return undefined;
  }
}

const numberProps = {
  min: { schema: { type: 'number' }, description: 'Smallest allowed value, inclusive.' },
  max: { schema: { type: 'number' }, description: 'Largest allowed value, inclusive.' },
  step: { schema: { type: 'number', exclusiveMinimum: 0 }, description: 'Granularity a control moves in.' },
  unit: { schema: { type: 'string' }, description: 'Shown beside the value, e.g. px, ms, %.' },
} as const;

// ── Leaf kinds ───────────────────────────────────────────────────────────────────────────

export const stringKind = defineKind<
  string,
  { minLength?: number; maxLength?: number; pattern?: string; patternMessage?: string; format?: string; suggestions?: unknown }
>()({
  name: 'string',
  control: (decl) => (decl.suggestions === undefined ? 'input' : 'autocomplete'),
  description: 'Text.',
  props: {
    minLength: { schema: { type: 'integer', minimum: 0 }, description: 'Fewest characters.' },
    maxLength: { schema: { type: 'integer', minimum: 0 }, description: 'Most characters.' },
    pattern: { schema: { type: 'string' }, description: 'A regular expression the whole value must match.' },
    patternMessage: {
      schema: { type: 'string' },
      description:
        'Shown when the value does not match `pattern`. Default: "This isn\'t a valid slug", named after the definition or preset the field uses, else its label or key.',
    },
    format: {
      schema: { type: 'string' },
      description: `A known shape: ${Object.keys(STRING_FORMATS).join(', ')}. Others are kept as hints.`,
    },
    suggestions: {
      schema: { anyOf: [{ type: 'array', items: { type: 'string' } }, { $ref: '#/$defs/expr' }] },
      description: 'Values offered as it is typed, others still allowed: strings, or an expression ($state, $computed) giving them.',
    },
  },
  example: { type: 'string', label: 'Display name', maxLength: 40 },
  zero: () => '',
  check(value, decl, ctx) {
    if (typeof value !== 'string') return ctx.issue('type', 'must be text');
    if (decl.minLength !== undefined && value.length < decl.minLength)
      ctx.issue('minLength', `must be at least ${decl.minLength} characters`);

    if (decl.maxLength !== undefined && value.length > decl.maxLength)
      ctx.issue('maxLength', `must be at most ${decl.maxLength} characters`);

    if (decl.pattern !== undefined && value !== '' && !new RegExp(`^(?:${decl.pattern})$`, 'u').test(value))
      ctx.issue('pattern', decl.patternMessage ?? (ctx.name === undefined ? "This isn't valid" : `This isn't a valid ${ctx.name}`));

    const format = decl.format === undefined ? undefined : STRING_FORMATS[decl.format];
    if (format && value !== '' && !format(value)) ctx.issue('format', `must be a valid ${decl.format}`);
  },
  checkDecl(decl, ctx) {
    if (decl.pattern !== undefined) {
      try {
        new RegExp(decl.pattern, 'u');
      } catch {
        ctx.fault('pattern', 'must be a valid regular expression');
      }
    }
    if (decl.minLength !== undefined && decl.maxLength !== undefined && decl.minLength > decl.maxLength)
      ctx.fault('maxLength', 'must be at least minLength');
    if (decl.patternMessage !== undefined && decl.pattern === undefined)
      ctx.fault('patternMessage', 'explains a pattern, but there is none', 'warning');
  },
  jsonSchema: (decl) => ({
    type: 'string',
    ...(decl.minLength !== undefined && { minLength: decl.minLength }),
    ...(decl.maxLength !== undefined && { maxLength: decl.maxLength }),
    ...(decl.pattern !== undefined && { pattern: `^(?:${decl.pattern})$` }),
    ...(decl.format !== undefined && { format: decl.format === 'color' ? undefined : decl.format }),
  }),
});

function numberKind<const Name extends 'number' | 'int'>(name: Name, integer: boolean) {
  return defineKind<number, { min?: number; max?: number; step?: number; unit?: string }>()({
    name,
    control: 'input',
    description: integer ? 'A whole number.' : 'A finite number.',
    props: numberProps,
    example: integer
      ? { type: 'int', label: 'Retries', min: 0, max: 10, default: 3 }
      : { type: 'number', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 1 },
    zero: (decl) => Math.min(Math.max(0, decl.min ?? 0), decl.max ?? Number.POSITIVE_INFINITY),
    check(value, decl, ctx) {
      if (!finiteNumber(value)) return ctx.issue('type', 'must be a number');
      if (integer && !Number.isInteger(value)) return ctx.issue('type', 'must be a whole number');
      if (decl.min !== undefined && value < decl.min) ctx.issue('min', `must be at least ${decl.min}`);
      if (decl.max !== undefined && value > decl.max) ctx.issue('max', `must be at most ${decl.max}`);
    },
    checkDecl(decl, ctx) {
      bounds(decl, ctx, Number);
      if (decl.step !== undefined && !(decl.step > 0)) ctx.fault('step', 'must be greater than zero');
    },
    jsonSchema: (decl) => ({
      type: integer ? 'integer' : 'number',
      ...(decl.min !== undefined && { minimum: decl.min }),
      ...(decl.max !== undefined && { maximum: decl.max }),
    }),
  });
}

export const numberKindDef = numberKind('number', false);
export const intKind = numberKind('int', true);

export const booleanKind = defineKind<boolean>()({
  name: 'boolean',
  control: 'checkbox',
  description: 'On or off.',
  example: { type: 'boolean', label: 'Enabled', default: true },
  zero: () => false,
  check: (value, _, ctx) => {
    if (typeof value !== 'boolean') ctx.issue('type', 'must be true or false');
  },
  jsonSchema: () => ({ type: 'boolean' }),
});

export const enumKind = defineKind<OptionValue, Pick<EnumField, 'options'>>()({
  name: 'enum',
  control: 'select',
  description: 'One of a fixed list of options. Options are values or { value, label, description, visible }.',
  props: {
    options: {
      schema: {
        anyOf: [
          {
            type: 'array',
            minItems: 1,
            items: {
              anyOf: [
                { type: ['string', 'number', 'boolean'] },
                {
                  type: 'object',
                  properties: {
                    value: { type: ['string', 'number', 'boolean'] },
                    label: { $ref: '#/$defs/text' },
                    description: { $ref: '#/$defs/text' },
                    visible: { $ref: '#/$defs/condition' },
                  },
                  required: ['value'],
                  additionalProperties: false,
                },
              ],
            },
          },
          { $ref: '#/$defs/expr' },
        ],
      },
      description: 'The choices. An expression ($computed or $state) makes them dynamic.',
      required: true,
    },
  },
  example: {
    type: 'enum',
    label: 'Mode',
    options: [
      { value: 'basic', label: 'Basic' },
      { value: 'advanced', label: 'Advanced' },
    ],
    default: 'basic',
  },
  zero(decl) {
    if (!Array.isArray(decl.options)) return undefined;
    const first = decl.options[0];
    return typeof first === 'object' && first !== null ? first.value : first;
  },
  check(value, decl, ctx) {
    const options = optionsOf(decl as EnumField, ctx.env, ctx.scope);
    if (!options.some((o) => Object.is(o.value, value))) {
      const shown = options
        .slice(0, 8)
        .map((o) => JSON.stringify(o.value))
        .join(', ');
      ctx.issue('enum', `must be one of ${shown}${options.length > 8 ? ', …' : ''}`);
    }
  },
  checkDecl(decl, ctx) {
    if (!Array.isArray(decl.options)) return;
    if (decl.options.length === 0) ctx.fault('options', 'needs at least one option');
    const seen = new Set<unknown>();
    decl.options.forEach((o, i) => {
      const value = typeof o === 'object' && o !== null ? o.value : o;
      if (seen.has(value)) ctx.fault(`options/${i}`, `repeats the value ${JSON.stringify(value)}`);
      seen.add(value);
    });
  },
  jsonSchema(decl) {
    if (!Array.isArray(decl.options)) return {};
    const options = decl.options.map((o) => (typeof o === 'object' && o !== null ? o : { value: o }));
    const labelled = options.some((o) => o.label !== undefined || o.description !== undefined);
    if (!labelled) return { enum: options.map((o) => o.value) };
    return {
      oneOf: options.map((o) => ({
        const: o.value,
        ...(typeof o.label === 'string' && { title: o.label }),
        ...(typeof o.description === 'string' && { description: o.description }),
      })),
    };
  },
});

export const dateKind = defineKind<Date, { min?: string; max?: string; time?: boolean }>()({
  name: 'date',
  control: 'date',
  description: 'A date, or a date and time with `time: true`. JSON form: ISO 8601.',
  props: {
    min: { schema: { type: 'string' }, description: 'Earliest, ISO 8601.' },
    max: { schema: { type: 'string' }, description: 'Latest, ISO 8601.' },
    time: { schema: { type: 'boolean' }, description: 'Whether the time of day matters.' },
  },
  example: { type: 'date', label: 'Starts', optional: true },
  check(value, decl, ctx) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ctx.issue('type', 'must be a valid date');
    if (decl.min !== undefined && value.getTime() < Date.parse(decl.min)) ctx.issue('min', `must be on or after ${decl.min}`);
    if (decl.max !== undefined && value.getTime() > Date.parse(decl.max)) ctx.issue('max', `must be on or before ${decl.max}`);
  },
  checkDecl: (decl, ctx) => bounds(decl, ctx, (v) => Date.parse(String(v))),
  encode: (value, decl) => (decl.time ? value.toISOString() : value.toISOString().slice(0, 10)),
  decode: (json) => dateOf(json) ?? json,
  jsonSchema: (decl) => ({ type: 'string', format: decl.time ? 'date-time' : 'date' }),
});

export const bigintKind = defineKind<bigint, { min?: string; max?: string }>()({
  name: 'bigint',
  control: 'input',
  description: 'An integer of any size. JSON form: a decimal string.',
  props: {
    min: { schema: { type: 'string', pattern: '^-?\\d+$' }, description: 'Smallest, as a decimal string.' },
    max: { schema: { type: 'string', pattern: '^-?\\d+$' }, description: 'Largest, as a decimal string.' },
  },
  zero: () => 0n,
  check(value, decl, ctx) {
    if (typeof value !== 'bigint') return ctx.issue('type', 'must be an integer');
    if (decl.min !== undefined && value < BigInt(decl.min)) ctx.issue('min', `must be at least ${decl.min}`);
    if (decl.max !== undefined && value > BigInt(decl.max)) ctx.issue('max', `must be at most ${decl.max}`);
  },
  checkDecl(decl, ctx) {
    for (const prop of ['min', 'max'] as const)
      if (decl[prop] !== undefined && !/^-?\d+$/.test(decl[prop])) ctx.fault(prop, 'must be a decimal integer string');
  },
  encode: (value) => value.toString(),
  decode(json) {
    if (typeof json === 'string' && /^-?\d+$/.test(json)) return BigInt(json);
    if (typeof json === 'number' && Number.isInteger(json)) return BigInt(json);
    return json;
  },
  jsonSchema: () => ({ type: 'string', pattern: '^-?\\d+$' }),
});

export const urlKind = defineKind<URL, { protocols?: readonly string[] }>()({
  name: 'url',
  control: 'input',
  description: 'An absolute URL. JSON form: a string.',
  props: {
    protocols: {
      schema: { type: 'array', items: { type: 'string', pattern: ':$' } },
      description: 'Allowed protocols with their colon, e.g. ["https:"].',
    },
  },
  example: { type: 'url', label: 'Webhook', protocols: ['https:'] },
  check(value, decl, ctx) {
    if (!(value instanceof URL)) return ctx.issue('type', 'must be an absolute URL');
    if (decl.protocols && !decl.protocols.includes(value.protocol)) ctx.issue('protocol', `must use ${decl.protocols.join(' or ')}`);
  },
  encode: (value) => value.href,
  decode: (json) => (typeof json === 'string' && URL.canParse(json) ? new URL(json) : json),
  jsonSchema: () => ({ type: 'string', format: 'uri' }),
});

export const regexpKind = defineKind<RegExp>()({
  name: 'regexp',
  control: 'input',
  description: 'A regular expression. JSON form: "/source/flags".',
  check: (value, _, ctx) => {
    if (!(value instanceof RegExp)) ctx.issue('type', 'must be a regular expression');
  },
  encode: (value) => String(value),
  decode: (json) => regexpOf(json) ?? json,
  jsonSchema: () => ({ type: 'string', pattern: '^/.*/[dgimsuvy]*$' }),
});

export const bytesKind = defineKind<Uint8Array, { maxBytes?: number; accept?: readonly string[] }>()({
  name: 'bytes',
  control: 'file',
  description: 'Binary data, e.g. an uploaded file. JSON form: base64.',
  props: {
    maxBytes: { schema: { type: 'integer', minimum: 0 }, description: 'Largest size in bytes.' },
    accept: { schema: { type: 'array', items: { type: 'string' } }, description: 'MIME types a picker may offer.' },
  },
  zero: () => new Uint8Array(),
  check(value, decl, ctx) {
    if (!(value instanceof Uint8Array)) return ctx.issue('type', 'must be bytes');
    if (decl.maxBytes !== undefined && value.length > decl.maxBytes) ctx.issue('maxBytes', `must be at most ${decl.maxBytes} bytes`);
  },
  encode: (value) => toBase64(value),
  decode: (json) => (typeof json === 'string' ? (fromBase64(json) ?? json) : json),
  jsonSchema: () => ({ type: 'string', contentEncoding: 'base64' }),
});

export const jsonKind = defineKind<Json>()({
  name: 'json',
  control: 'textarea',
  description: 'Any JSON value.',
  zero: () => null,
  check: (value, _, ctx) => {
    if (!isJson(value)) ctx.issue('type', 'must be plain JSON');
  },
  jsonSchema: () => ({}),
});

export function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.values(value).every(isJson);

  return false;
}

// ── Container kinds: their walking is done by values.ts; these carry docs and props ────────

const field = { $ref: '#/$defs/field' };
const groups = {
  schema: { type: 'object', additionalProperties: { $ref: '#/$defs/group' } },
  description: 'Groups the fields here may join.',
};

export const arrayKind = defineKind<unknown[]>()({
  name: 'array',
  control: 'list',
  description: 'An ordered list of items of one declaration.',
  props: {
    items: { schema: field, description: 'The declaration every item follows.', required: true },
    minItems: { schema: { type: 'integer', minimum: 0 }, description: 'Fewest items.' },
    maxItems: { schema: { type: 'integer', minimum: 0 }, description: 'Most items.' },
    namedBy: {
      schema: { $ref: '#/$defs/text' },
      description:
        'What names each item in place of its position or key: a pointer into the item ("name"), or a text expression in its scope.',
    },
  },
  example: { type: 'array', label: 'Tags', items: { type: 'string' } },
});

export const setKind = defineKind<Set<unknown>>()({
  name: 'set',
  control: (decl) => ((decl as { items?: FieldDecl }).items?.type === 'enum' ? 'checks' : 'list'),
  description: 'Distinct items of one declaration. A set of an enum draws as checkboxes. JSON form: an array.',
  props: {
    items: { schema: field, description: 'The declaration every item follows.', required: true },
    minItems: { schema: { type: 'integer', minimum: 0 }, description: 'Fewest items.' },
    maxItems: { schema: { type: 'integer', minimum: 0 }, description: 'Most items.' },
  },
  example: { type: 'set', label: 'Days', items: { type: 'enum', options: ['mon', 'tue', 'wed'] } },
});

export const recordKind = defineKind<Record<string, unknown>>()({
  name: 'record',
  control: 'entries',
  description: 'Entries under keys the user chooses, every value following one declaration.',
  props: {
    values: { schema: field, description: 'The declaration every value follows.', required: true },
    keyPattern: { schema: { type: 'string' }, description: 'A regular expression every key must match.' },
    namedBy: {
      schema: { $ref: '#/$defs/text' },
      description:
        'What names each item in place of its position or key: a pointer into the item ("name"), or a text expression in its scope.',
    },
  },
  example: { type: 'record', label: 'Headers', values: { type: 'string' } },
});

export const mapKind = defineKind<Map<unknown, unknown>>()({
  name: 'map',
  control: 'entries',
  description: 'Entries whose keys follow their own declaration (string, int, number or enum). JSON form: [key, value] pairs.',
  props: {
    keys: { schema: field, description: 'The declaration keys follow.', required: true },
    values: { schema: field, description: 'The declaration values follow.', required: true },
    namedBy: {
      schema: { $ref: '#/$defs/text' },
      description:
        'What names each item in place of its position or key: a pointer into the item ("name"), or a text expression in its scope.',
    },
  },
});

export const objectKind = defineKind<Record<string, unknown>>()({
  name: 'object',
  control: 'fields',
  description: 'Named fields, each with its own declaration. Its value is an object.',
  props: {
    fields: { schema: { type: 'object', additionalProperties: field }, description: 'The fields, in display order.', required: true },
    groups,
    unknown: {
      schema: { enum: ['error', 'strip', 'keep'] },
      description: 'Keys no field claims: report them (default), drop them, or keep them.',
    },
  },
  example: {
    type: 'object',
    label: 'Address',
    fields: { street: { type: 'string' }, city: { type: 'string' } },
  },
});

export const variantKind = defineKind<Record<string, unknown>>()({
  name: 'variant',
  control: 'variant',
  description: 'One of several shapes, chosen by the value of `key`. Each variant has its own fields.',
  props: {
    key: { schema: { type: 'string' }, description: 'The property that names the variant.', required: true },
    variants: {
      schema: {
        type: 'object',
        minProperties: 1,
        additionalProperties: {
          type: 'object',
          properties: {
            label: { $ref: '#/$defs/text' },
            description: { $ref: '#/$defs/text' },
            fields: { type: 'object', additionalProperties: field },
            groups: groups.schema,
          },
          required: ['fields'],
          additionalProperties: false,
        },
      },
      description: "Each variant's name and fields.",
      required: true,
    },
  },
  example: {
    type: 'variant',
    label: 'Auth',
    key: 'method',
    variants: {
      none: { label: 'None', fields: {} },
      token: { label: 'Token', fields: { token: { type: 'string' } } },
    },
  },
});

export const CORE_KINDS = [
  stringKind,
  numberKindDef,
  intKind,
  booleanKind,
  enumKind,
  dateKind,
  bigintKind,
  urlKind,
  regexpKind,
  bytesKind,
  jsonKind,
  arrayKind,
  setKind,
  recordKind,
  mapKind,
  objectKind,
  variantKind,
] as const;

export const CONTAINER_KINDS = new Set(['array', 'set', 'record', 'map', 'object', 'variant']);
