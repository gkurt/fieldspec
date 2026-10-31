import type { Functions } from './expr.ts';
import type { Infer } from './infer.ts';
import { toJSONSchema } from './jsonschema.ts';
import { parsePointer } from './pointer.ts';
/**
 * Standard Schema (https://standardschema.dev): every defined spec carries `~standard`, so
 * libraries that accept Zod, Valibot or ArkType schemas (tRPC, Hono, form libraries, the AI
 * SDK) accept a spec too. Includes the Standard JSON Schema extension.
 */
import { registryOf, functionsOf, onDefine, type Registry } from './registry.ts';
import type { Spec } from './types.ts';
import { parse } from './values.ts';

/** The Standard Schema v1 interface, inlined as the spec recommends. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    validate(value: unknown): StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
    readonly jsonSchema?: {
      input(options: { readonly target: string }): Record<string, unknown>;
      output(options: { readonly target: string }): Record<string, unknown>;
    };
  };
}

export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly { readonly message: string; readonly path?: readonly PropertyKey[] }[] };

export function standardOf<S extends Spec>(
  spec: S,
  options: { registry?: Registry; fns?: Functions } = {},
): StandardSchemaV1<unknown, Infer<S>>['~standard'] {
  const vo = { registry: options.registry ?? registryOf(spec), fns: options.fns ?? functionsOf(spec) };
  return {
    version: 1,
    vendor: 'fieldspec',
    validate(value) {
      const result = parse(spec, value, vo);
      if (result.ok) return { value: result.value };
      return {
        issues: result.issues.map((issue) => ({
          message: issue.message,
          path: parsePointer(issue.path).map((s) => (/^\d+$/.test(s) ? Number(s) : s)),
        })),
      };
    },
    jsonSchema: {
      input: () => toJSONSchema(spec, { registry: vo.registry, io: 'input' }),
      output: () => toJSONSchema(spec, { registry: vo.registry, io: 'output' }),
    },
  };
}

/** A Standard Schema for a spec that was not defined through a registry (one read from JSON, say). */
export function toStandard<S extends Spec>(
  spec: S,
  options?: { registry?: Registry; fns?: Functions },
): StandardSchemaV1<unknown, Infer<S>> {
  return { '~standard': standardOf(spec, options) };
}

onDefine((spec) => {
  Object.defineProperty(spec, '~standard', {
    get: () => standardOf(spec),
    enumerable: false,
    configurable: true,
  });
});
