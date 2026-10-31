/**
 * Zod interop. `toZod` builds a Zod schema with the same shape and checks (over decoded
 * values: Date, bigint, URL, …), and refines it with the spec's own validation so conditional
 * rules behave identically. `fromZod` goes through JSON Schema.
 */
import { z } from "zod";
import { formatOf, functionsOf, type Format } from "./format.ts";
import type { Functions } from "./expr.ts";
import type { Infer } from "./infer.ts";
import { circular, deref, usedName, type Lookup } from "./defs.ts";
import { BASE_PROPS } from "./format.ts";
import { isBuiltinName } from "./names.ts";
import { fromJSONSchema } from "./jsonschema.ts";
import { parsePointer } from "./pointer.ts";
import type {
  ArrayField,
  BigIntField,
  EnumField,
  FieldDecl,
  MapField,
  NumberField,
  ObjectField,
  RecordField,
  SetField,
  Spec,
  StringField,
  UrlField,
  VariantField,
} from "./types.ts";
import { validate } from "./values.ts";

export interface ToZodOptions {
  readonly format?: Format;
  readonly fns?: Functions;
  /** Run the spec's full validation (conditions, dynamic options, extension kinds) too. Default true. */
  readonly refine?: boolean;
}

export function toZod<S extends Spec>(spec: S, options: ToZodOptions = {}): z.ZodType<Infer<S>> {
  const format = options.format ?? formatOf(spec);
  const fns = options.fns ?? functionsOf(spec);
  const shape = objectOf({ lookup: { defs: spec.defs, presets: format.presets }, built: new Map() }, spec.fields, "error");
  if (options.refine === false) return shape as unknown as z.ZodType<Infer<S>>;
  return shape.superRefine((values, ctx) => {
    for (const issue of validate(spec, values, { format, fns })) {
      ctx.addIssue({ code: "custom", message: issue.message, path: parsePointer(issue.path) });
    }
  }) as unknown as z.ZodType<Infer<S>>;
}

interface Cx {
  readonly lookup: Lookup;
  /** One schema per definition, so a recursive one refers to itself lazily. */
  readonly built: Map<string, z.ZodType>;
}

function objectOf(cx: Cx, fields: ObjectField["fields"], unknown: ObjectField["unknown"]) {
  const shape: Record<string, z.ZodType> = {};
  // Conditional fields may be hidden and then anything goes; the refinement handles them.
  for (const [key, decl] of Object.entries(fields)) {
    const schema = fieldOf(cx, decl);
    const real = deref(cx.lookup, decl);
    shape[key] = real.optional || real.visible !== undefined ? schema.optional() : schema;
  }
  const object = z.object(shape);
  return unknown === "keep" ? object.loose() : unknown === "strip" ? object : object.strict();
}

function fieldOf(cx: Cx, raw: FieldDecl): z.ZodType {
  const name = usedName(raw);
  const target = name !== undefined && !isBuiltinName(name) ? cx.lookup.defs?.[name] : undefined;
  // A definition used as it is: one schema, referred to lazily, since it may be building when it uses itself.
  // Definitions that only name each other in a ring stand for nothing, and would be a lazy schema of itself.
  if (name !== undefined && target && !circular(cx.lookup, raw) && Object.keys(raw).every((p) => p in BASE_PROPS)) {
    if (!cx.built.has(name)) {
      cx.built.set(name, z.unknown());
      cx.built.set(name, fieldOf(cx, target));
    }
    const lazy = z.lazy(() => cx.built.get(name)!);
    return typeof raw.description === "string" ? lazy.describe(raw.description) : lazy;
  }
  const decl = deref(cx.lookup, raw);
  const described = <T extends z.ZodType>(schema: T): T =>
    (typeof decl.description === "string" ? schema.describe(decl.description) : schema) as T;
  switch (decl.type) {
    case "string": {
      const d = decl as StringField;
      let s = z.string();
      if (d.minLength !== undefined) s = s.min(d.minLength);
      if (d.maxLength !== undefined) s = s.max(d.maxLength);
      return described(s);
    }
    case "number":
    case "int": {
      const d = decl as NumberField;
      let s = decl.type === "int" ? z.int() : z.number();
      if (d.min !== undefined) s = s.min(d.min);
      if (d.max !== undefined) s = s.max(d.max);
      return described(s);
    }
    case "boolean":
      return described(z.boolean());
    case "enum": {
      const options = (decl as EnumField).options;
      if (!Array.isArray(options)) return z.union([z.string(), z.number(), z.boolean()]);
      const values = options.map((o) => (typeof o === "object" ? o.value : o));
      return described(z.union(values.map((v) => z.literal(v)) as [z.ZodLiteral, ...z.ZodLiteral[]]));
    }
    case "date":
      return described(z.date());
    case "bigint": {
      const d = decl as BigIntField;
      let s = z.bigint();
      if (d.min !== undefined) s = s.min(BigInt(d.min));
      if (d.max !== undefined) s = s.max(BigInt(d.max));
      return described(s);
    }
    case "url": {
      const d = decl as UrlField;
      const s = z.instanceof(URL);
      return described(d.protocols ? s.refine((u) => d.protocols!.includes(u.protocol), `must use ${d.protocols.join(" or ")}`) : s);
    }
    case "regexp":
      return described(z.instanceof(RegExp));
    case "bytes":
      return described(z.instanceof(Uint8Array));
    case "json":
      return described(z.json());
    case "array": {
      const d = decl as ArrayField;
      let s = z.array(fieldOf(cx, d.items));
      if (d.minItems !== undefined) s = s.min(d.minItems);
      if (d.maxItems !== undefined) s = s.max(d.maxItems);
      return described(s);
    }
    case "set":
      return described(z.set(fieldOf(cx, (decl as SetField).items)));
    case "record":
      return described(z.record(z.string(), fieldOf(cx, (decl as RecordField).values)));
    case "map": {
      const d = decl as MapField;
      return described(z.map(fieldOf(cx, d.keys), fieldOf(cx, d.values)));
    }
    case "object": {
      const d = decl as ObjectField;
      return described(objectOf(cx, d.fields, d.unknown));
    }
    case "variant": {
      const d = decl as VariantField;
      const branches = Object.entries(d.variants).map(([name, variant]) =>
        objectOf(cx, { ...variant.fields, [d.key]: { type: "enum", options: [name] } as FieldDecl }, "error"),
      );
      if (branches.length === 1) return described(branches[0]!);
      return described(z.discriminatedUnion(d.key, branches as [z.ZodObject, z.ZodObject, ...z.ZodObject[]]));
    }
    default:
      // Extension kinds are checked by the refinement.
      return z.unknown();
  }
}

/** A spec from a Zod object schema. Its meta (`.describe`, `.meta({ title })`) carries over. */
export function fromZod(schema: z.ZodType, options?: { format?: Format }): Spec {
  return fromJSONSchema(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>, options);
}
