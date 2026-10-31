/**
 * `fieldspec/cel`: runs `$cel`, the CEL (Common Expression Language) expressions of a spec, with
 * `@marcbachmann/cel-js`. CEL cannot loop forever or reach outside its arguments, so it needs no
 * sandbox: it runs in plain JavaScript, synchronously, and loads with the page. An entry point of
 * its own, so an application that does not use it carries none of it.
 *
 * An arg that reads a field (`{ "$state": … }`) is a variable of that field's type: an `int` is a
 * CEL int, a `number` a double, a `date` a timestamp, a list of strings a `list<string>`, and so
 * on, so the checker catches `price + 1` where `price + 1.0` is meant. An optional field, which
 * may be absent (null), and any other arg are `dyn`; JSON does not say whether a whole number is
 * an int, so an untyped one works as either. A URL or a regular expression arrives as its
 * text, a set as a list. Whole results come back as numbers when they fit, so they fill `number`
 * and `int` fields.
 */
import { Environment, type EnvironmentOptions, type ParseResult } from '@marcbachmann/cel-js';
import type { ArgDecls, Language } from './expr.ts';
import type { ArrayField, EnumField, FieldDecl, MapField, ObjectField, RecordField } from './types.ts';

export interface CelOptions {
  /** The environment to start from: one with functions or variables of your own registered. */
  readonly environment?: Environment;
  /** Bounds on the size of an expression and its literals. */
  readonly limits?: EnvironmentOptions['limits'];
}

/** A language that runs `$cel`. Give it to a registry: `createRegistry({ languages: [createCel()] })`. */
export function createCel(options: CelOptions = {}): Language {
  const base =
    options.environment?.clone({ homogeneousAggregateLiterals: false, limits: options.limits }) ??
    new Environment({ homogeneousAggregateLiterals: false, limits: options.limits });
  const environments = new Map<string, Environment>();
  const parsed = new Map<string, ParseResult>();

  /** The args' variables and their types, in name order, and a key naming them. */
  const variablesOf = (decls: ArgDecls) => {
    const variables = Object.keys(decls)
      .sort()
      .map((name): [string, string] => [name, variableType(decls[name])]);
    return { variables, key: JSON.stringify(variables) };
  };
  const environmentFor = ({ variables, key }: ReturnType<typeof variablesOf>): Environment => {
    let env = environments.get(key);
    if (!env) {
      env = base.clone();
      for (const [name, type] of variables) if (!env.hasVariable(name)) env.registerVariable(name, type);
      environments.set(key, env);
    }
    return env;
  };

  return {
    key: '$cel',
    description:
      '`{ "$cel": "<a CEL expression>", "args": { "x": <expr> } }` evaluates CEL (Common Expression Language), wherever an expression or the value a condition tests may go. ' +
      'Each arg is a variable of the expression, and it reads nothing else: pass what it needs as args (`{ "$state": … }`). ' +
      'An arg that reads a field has its type: an int field is a CEL int, a number field a double (write `price + 1.0` and `count + 1`; `double(count)` and `int(price)` convert; `price * double(count)`, as a double never meets an int), a date a timestamp (`end - start >= duration("24h")`), a set a list. An optional field may be null. ' +
      'What there is: strings have `size(s)`, `s.contains(x)`, `startsWith`, `endsWith`, `matches(regex)`, `lowerAscii()`, `upperAscii()`, `trim()`, `indexOf`, `substring` and `split(sep)`, and a list of strings `join(sep)`; there is no `len` or `replace` (`s.split(" ").join("-")` replaces). Lists have `size(l)`, `l.map(x, …)`, `filter`, `exists` and `all`. A duration cannot be divided: `(end - start).getHours() / 24` is whole days. There are no `math` functions. ' +
      'Prefer the expressions above, and use `$cel` for what they cannot say: `{ "$cel": "end >= start", "args": { "start": { "$state": "start" }, "end": { "$state": "end" } } }`.',
    check(source, decls) {
      try {
        const result = environmentFor(variablesOf(decls)).check(source);
        return result.valid ? undefined : messageOf(result.error);
      } catch (error) {
        return messageOf(error);
      }
    },
    run(source, args, decls) {
      const variables = variablesOf({ ...Object.fromEntries(Object.keys(args).map((name) => [name, undefined])), ...decls });
      const key = `${variables.key}\n${source}`;
      let expression = parsed.get(key);
      if (!expression) {
        try {
          expression = environmentFor(variables).parse(source);
        } catch (error) {
          throw new Error(messageOf(error), { cause: error });
        }
        parsed.set(key, expression);
      }
      const context: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(args)) context[name] = toCel(value, decls?.[name]);
      try {
        return fromCel(expression(context));
      } catch (error) {
        // JSON does not tell a whole number's type: an untyped one works as an int where a double has no overload.
        const ints = Object.entries(args).filter(([name, v]) => variableType(decls?.[name]) === 'dyn' && Number.isSafeInteger(v));
        if (ints.length > 0 && messageOf(error).includes('overload')) {
          try {
            return fromCel(expression({ ...context, ...Object.fromEntries(ints.map(([name, v]) => [name, BigInt(v as number)])) }));
          } catch {
            // The first error says more.
          }
        }
        throw new Error(messageOf(error), { cause: error });
      }
    },
  };
}

/** The error's one-line summary, without the source excerpt cel-js appends. */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return `Error: ${String(error)}`;
  const summary = 'summary' in error && typeof error.summary === 'string' ? error.summary : error.message.split('\n')[0];
  return `${error.name}: ${summary}`;
}

/** The type of an arg's variable. An optional field may be absent, which only `dyn` allows. */
function variableType(decl: FieldDecl | undefined): string {
  return decl === undefined || decl.optional === true ? 'dyn' : celType(decl);
}

/** The CEL type of a field's values; `dyn` for what CEL has no type of its own for. */
function celType(decl: FieldDecl | undefined): string {
  switch (decl?.type) {
    case undefined:
      return 'dyn';
    case 'string':
    case 'url':
    case 'regexp':
      return 'string';
    case 'number':
      return 'double';
    case 'int':
    case 'bigint':
      return 'int';
    case 'boolean':
      return 'bool';
    case 'date':
      return 'google.protobuf.Timestamp';
    case 'bytes':
      return 'bytes';
    case 'enum': {
      const { options } = decl as EnumField;
      if (!Array.isArray(options)) return 'dyn';
      const values = options.map((o: unknown) => (typeof o === 'object' && o !== null ? (o as { value: unknown }).value : o));
      if (values.every((v) => typeof v === 'string')) return 'string';
      return values.every((v) => typeof v === 'number') ? 'double' : 'dyn';
    }
    case 'array':
    case 'set':
      return `list<${celType((decl as ArrayField).items)}>`;
    case 'record':
      return `map<string, ${celType((decl as RecordField).values)}>`;
    case 'map': {
      const key = celType((decl as MapField).keys);
      return ['string', 'int', 'bool'].includes(key) ? `map<${key}, ${celType((decl as MapField).values)}>` : 'dyn';
    }
    default:
      return 'dyn';
  }
}

/** A value as CEL takes it: whole numbers of int fields as ints, wherever they sit. */
function toCel(value: unknown, decl?: FieldDecl): unknown {
  if (value === undefined) return null;
  if (typeof value === 'number' && (decl?.type === 'int' || decl?.type === 'bigint'))
    return Number.isInteger(value) ? BigInt(value) : value;
  if (value instanceof URL) return value.href;
  if (value instanceof RegExp) return value.source;
  const items = decl?.type === 'array' || decl?.type === 'set' ? (decl as ArrayField).items : undefined;
  if (Array.isArray(value) || value instanceof Set) return [...value].map((v: unknown) => toCel(v, items));
  if (value instanceof Map) {
    const { keys, values } = decl?.type === 'map' ? (decl as MapField) : ({} as Partial<MapField>);
    return new Map([...value].map(([k, v]: [unknown, unknown]) => [toCel(k, keys), toCel(v, values)]));
  }
  if (isPlainObject(value)) {
    const fields = decl?.type === 'object' ? (decl as ObjectField).fields : undefined;
    const values = decl?.type === 'record' ? (decl as RecordField).values : undefined;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toCel(v, fields?.[k] ?? values)]));
  }
  return value;
}

function fromCel(value: unknown): unknown {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value;
  if (Array.isArray(value)) return value.map(fromCel);
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [fromCel(k), fromCel(v)]));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromCel(v)]));
  return value;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
