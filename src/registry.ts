/**
 * A registry: the vocabulary specs are written in. Kinds, elements and presets, plus lint rules.
 * The core registry holds the built-ins (all lowercase); an application extends it with its own
 * (all capitalized), and every spec defined through it is checked, parsed, rendered and
 * described for agents with exactly that vocabulary.
 */
import { CORE_ELEMENTS, type ElementDef } from './elements.ts';
import type { Functions } from './expr.ts';
import type { Defined, FunctionsFor, KindValues } from './infer.ts';
import { CORE_KINDS, type AnyKind, type PropInfo } from './kinds.ts';
import { assertUserName } from './names.ts';
import { BUILTIN_PRESETS } from './presets.ts';
import type { Fault, FieldDecl, Spec } from './types.ts';

/** A lint over a whole spec, for policy a registry wants beyond what kinds check. */
export type Rule = (spec: Spec, report: (path: string, message: string, severity?: Fault['severity']) => void) => void;

export type Presets = { readonly [name: string]: FieldDecl };

export interface Registry<KV = {}, P = typeof BUILTIN_PRESETS> {
  readonly kinds: ReadonlyMap<string, AnyKind>;
  readonly elements: ReadonlyMap<string, ElementDef>;
  readonly presets: Presets;
  readonly rules: readonly Rule[];
  /**
   * Type a spec and bind it to this registry, and optionally to its function table. The spec is
   * returned as it is, with a non-enumerable `~standard` so Standard Schema consumers take it.
   */
  define<const S extends Spec>(spec: S, options?: { fns?: FunctionsFor<S> }): Defined<S, KV, P>;
  /** A registry with more kinds, elements, presets or rules. Their names must be capitalized. */
  extend<const Ks extends readonly AnyKind[] = [], const Ps extends Presets = {}>(
    options: RegistryOptions<Ks, Ps>,
  ): Registry<KV & KindValues<Ks>, P & Ps>;
}

export interface RegistryOptions<Ks extends readonly AnyKind[], Ps extends Presets = {}> {
  readonly kinds?: Ks;
  readonly elements?: readonly ElementDef[];
  /** Named declarations fields can `use`, e.g. `Money: { type: "bigint", min: "0", … }`. */
  readonly presets?: Ps;
  readonly rules?: readonly Rule[];
}

/** What every field may say, whatever its kind. Drives the meta-schema, prompts and the checker. */
export const BASE_PROPS: { readonly [prop: string]: PropInfo } = {
  type: { schema: { type: 'string' }, description: 'The kind. Required unless `use` gives one.' },
  use: {
    schema: { type: 'string' },
    description: "A preset or a definition this field builds on; its own properties override the base's. Replaces `type`.",
  },
  label: { schema: { $ref: '#/$defs/text' }, description: 'What the field is called.' },
  description: { schema: { $ref: '#/$defs/text' }, description: 'What it does, in a sentence.' },
  hint: { schema: { $ref: '#/$defs/text' }, description: 'A short line under the control.' },
  placeholder: { schema: { $ref: '#/$defs/text' }, description: 'Shown in an empty control.' },
  examples: { schema: { type: 'array' }, description: 'Sample values.' },
  aliases: { schema: { type: 'array', items: { type: 'string' } }, description: 'Other keys the value is read from.' },
  deprecated: { schema: { type: ['boolean', 'string'] }, description: 'true, or what to use instead.' },
  default: { schema: { $ref: '#/$defs/expr' }, description: 'The value when absent. May be an expression.' },
  optional: { schema: { type: 'boolean' }, description: 'The value may be absent.' },
  readOnly: { schema: { type: 'boolean' }, description: 'Shown but not editable.' },
  visible: { schema: { $ref: '#/$defs/condition' }, description: 'Shown, and validated, only while this holds.' },
  enabled: { schema: { $ref: '#/$defs/condition' }, description: 'Editable only while this holds.' },
  required: { schema: { $ref: '#/$defs/condition' }, description: 'Must be non-empty while this holds.' },
  group: { schema: { type: 'string' }, description: 'The id of a group in the same scope.' },
  order: {
    schema: { type: 'number' },
    description: 'Where the field draws among its siblings, lower first; 0 when absent, ties in declaration order.',
  },
  render: {
    schema: { $ref: '#/$defs/render' },
    description: "A control element (`slider`), or a layout of the field's parts; see Rendering.",
  },
  meta: { schema: { type: 'object' }, description: 'Free-form data for the application.' },
};

const REGISTRY = Symbol.for('fieldspec.registry');
const FUNCTIONS = Symbol.for('fieldspec.functions');

/** The registry a spec was defined through, or the core registry. */
export function registryOf(spec: Spec): Registry {
  return (spec as unknown as Record<symbol, Registry>)[REGISTRY] ?? coreRegistry;
}

/** The function table a spec was defined with. */
export function functionsOf(spec: Spec): Functions | undefined {
  return (spec as unknown as Record<symbol, Functions | undefined>)[FUNCTIONS];
}

/** Hook for standard.ts, which needs parse and would otherwise import in a cycle. */
let attachStandard: ((spec: Spec) => void) | undefined;
export function onDefine(fn: (spec: Spec) => void) {
  attachStandard = fn;
}

function build<KV, P>(
  kinds: readonly AnyKind[],
  elements: readonly ElementDef[],
  presets: Presets,
  rules: readonly Rule[],
): Registry<KV, P> {
  const registry: Registry<KV, P> = {
    kinds: new Map(kinds.map((k) => [k.name, k])),
    elements: new Map(elements.map((e) => [e.name, e])),
    presets,
    rules,
    define(spec, options) {
      Object.defineProperty(spec, REGISTRY, { value: registry, enumerable: false, configurable: true });
      Object.defineProperty(spec, FUNCTIONS, { value: options?.fns, enumerable: false, configurable: true });
      attachStandard?.(spec);
      return spec;
    },
    extend(options) {
      for (const k of options.kinds ?? []) assertUserName('A kind', k.name);
      for (const e of options.elements ?? []) assertUserName('An element', e.name);
      for (const name of Object.keys(options.presets ?? {})) assertUserName('A preset', name);
      return build(
        [...kinds.filter((k) => !options.kinds?.some((n) => n.name === k.name)), ...(options.kinds ?? [])],
        [...elements.filter((e) => !options.elements?.some((n) => n.name === e.name)), ...(options.elements ?? [])],
        { ...presets, ...options.presets },
        [...rules, ...(options.rules ?? [])],
      );
    },
  };
  return registry;
}

export const coreRegistry: Registry = build(CORE_KINDS, CORE_ELEMENTS, BUILTIN_PRESETS, []);

/** A registry with the core vocabulary plus these. Their names must be capitalized. */
export function createRegistry<const Ks extends readonly AnyKind[] = [], const Ps extends Presets = {}>(
  options: RegistryOptions<Ks, Ps> = {},
): Registry<KindValues<Ks>, typeof BUILTIN_PRESETS & Ps> {
  return coreRegistry.extend(options);
}

/** Define a spec with the core registry. */
export const define: Registry['define'] = (spec, options) => coreRegistry.define(spec, options);
