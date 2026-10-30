/** Type-level reading of a spec: the values it describes, and the functions it calls. */
import type { AnyKind } from "./kinds.ts";
import type { Fn, Functions } from "./expr.ts";
import type { BUILTIN_PRESETS } from "./presets.ts";
import type { Json, OptionValue } from "./types.ts";

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Kind name → value type, for the extension kinds a format adds. */
export type KindValues<Ks extends readonly AnyKind[]> = {
  [K in Ks[number] as K["name"]]: NonNullable<K["__value"]>;
};

/**
 * What names mean while reading a spec: extension kinds' value types, the spec's `defs`, and
 * the format's presets.
 */
export interface Vocabulary {
  readonly kinds: {};
  readonly defs: {};
  readonly presets: {};
}

export type CoreVocabulary = { readonly kinds: {}; readonly defs: {}; readonly presets: typeof BUILTIN_PRESETS };

type EnumValue<F> = F extends { readonly options: readonly (infer O)[] }
  ? O extends { readonly value: infer V }
    ? V
    : O
  : OptionValue;

type VariantValue<F, X extends Vocabulary> = F extends { readonly key: infer Key extends string; readonly variants: infer VS }
  ? {
      [N in keyof VS & string]: Simplify<
        { -readonly [P in Key]: N } & (VS[N] extends { readonly fields: infer FS } ? ValuesOf<FS, X> : {})
      >;
    }[keyof VS & string]
  : Record<string, unknown>;

/** What a `use` name refers to: a definition, else a preset. */
type Base<N, X extends Vocabulary> = N extends keyof X["defs"] ? X["defs"][N] : N extends keyof X["presets"] ? X["presets"][N] : never;

/** A base declaration with a field's own properties laid over it. */
type Over<B, F> = Omit<B, Exclude<keyof F, "use">> & Omit<F, "use">;

/** The value of one field declaration. */
export type ValueOf<F, X extends Vocabulary = CoreVocabulary> = F extends { readonly type: infer T }
  ? T extends "string"
    ? string
    : T extends "number" | "int"
      ? number
      : T extends "boolean"
        ? boolean
        : T extends "enum"
          ? EnumValue<F>
          : T extends "date"
            ? Date
            : T extends "bigint"
              ? bigint
              : T extends "url"
                ? URL
                : T extends "regexp"
                  ? RegExp
                  : T extends "bytes"
                    ? Uint8Array
                    : T extends "json"
                      ? Json
                      : T extends "array"
                        ? F extends { readonly items: infer I }
                          ? ValueOf<I, X>[]
                          : unknown[]
                        : T extends "set"
                          ? F extends { readonly items: infer I }
                            ? Set<ValueOf<I, X>>
                            : Set<unknown>
                          : T extends "record"
                            ? F extends { readonly values: infer V }
                              ? Record<string, ValueOf<V, X>>
                              : Record<string, unknown>
                            : T extends "map"
                              ? F extends { readonly keys: infer K; readonly values: infer V }
                                ? Map<ValueOf<K, X>, ValueOf<V, X>>
                                : Map<unknown, unknown>
                              : T extends "object"
                                ? F extends { readonly fields: infer FS }
                                  ? ValuesOf<FS, X>
                                  : Record<string, unknown>
                                : T extends "variant"
                                  ? VariantValue<F, X>
                                  : T extends keyof X["kinds"]
                                    ? X["kinds"][T]
                                    : unknown
  : F extends { readonly use: infer N }
    ? ValueOf<Over<Base<N, X>, F>, X>
    : unknown;

/** Optional by its own say, or, for a field that does not say, by its base's. */
type IsOptional<F, X extends Vocabulary> = F extends { readonly optional: infer O }
  ? O extends true
    ? true
    : false
  : F extends { readonly type: string }
    ? false
    : F extends { readonly use: infer N }
      ? IsOptional<Base<N, X>, X>
      : false;

/** The values of a `fields` map. */
export type ValuesOf<FS, X extends Vocabulary = CoreVocabulary> = Simplify<
  { -readonly [P in keyof FS as IsOptional<FS[P], X> extends true ? never : P]: ValueOf<FS[P], X> } & {
    -readonly [P in keyof FS as IsOptional<FS[P], X> extends true ? P : never]?: ValueOf<FS[P], X>;
  }
>;

type DefsOf<S> = S extends { readonly defs: infer D } ? D : {};

/** Every `$computed` name a spec calls. */
export type ComputedNames<T, Depth extends unknown[] = []> = Depth["length"] extends 16
  ? never
  : T extends { readonly $computed: infer N extends string }
    ? (string extends N ? never : N) | ComputedNames<Omit<T, "$computed">, [...Depth, 1]>
    : T extends readonly (infer E)[]
      ? ComputedNames<E, [...Depth, 1]>
      : T extends object
        ? // A wide type (an index signature) is a declaration's type, not a written spec: nothing to find.
          string extends keyof T
          ? never
          : { [K in keyof T]-?: ComputedNames<T[K], [...Depth, 1]> }[keyof T]
        : never;

/** A function table that implements every name the spec calls. */
export type FunctionsFor<S> = [ComputedNames<S>] extends [never]
  ? Functions
  : { readonly [N in ComputedNames<S>]: Fn } & Functions;

declare const TYPES: unique symbol;

/** A spec that knows its value type. The marker is type-only; at runtime it is the spec. */
export type Defined<S, KV = {}, P = typeof BUILTIN_PRESETS> = S & {
  readonly [TYPES]?: {
    readonly values: S extends { readonly fields: infer FS } ? ValuesOf<FS, { kinds: KV & {}; defs: DefsOf<S> & {}; presets: P & {} }> : never;
  };
};

/** The values a spec describes. */
export type Infer<S> = S extends { readonly fields: infer FS }
  ? string extends keyof FS
    ? // A spec known only at runtime: read from JSON, or made by `commonFields`.
      { [key: string]: unknown }
    : S extends { readonly [TYPES]?: { readonly values: infer V } }
      ? unknown extends V
        ? ValuesOf<FS, { kinds: {}; defs: DefsOf<S>; presets: typeof BUILTIN_PRESETS }>
        : V
      : never
  : never;
