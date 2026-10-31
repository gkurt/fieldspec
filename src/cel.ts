/**
 * `fieldspec/cel`: runs `$cel`, the CEL (Common Expression Language) expressions of a spec, with
 * `@marcbachmann/cel-js`. CEL cannot loop forever or reach outside its arguments, so it needs no
 * sandbox: it runs in plain JavaScript, synchronously, and loads with the page. An entry point of
 * its own, so an application that does not use it carries none of it.
 *
 * Values arrive as themselves: numbers as doubles, dates as timestamps, maps, sets (as lists),
 * bigints (as ints) and bytes; a URL or a regular expression as its text, and an absent value as
 * null. Whole results come back as numbers when they fit, so they fill `number` and `int` fields.
 */
import { Environment, type EnvironmentOptions, type ParseResult } from '@marcbachmann/cel-js';
import type { Language } from './expr.ts';

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

  /** An environment that declares these args, each of any type. */
  const environmentFor = (names: readonly string[]): Environment => {
    const key = names.join(',');
    let env = environments.get(key);
    if (!env) {
      env = base.clone();
      for (const name of names) if (!env.hasVariable(name)) env.registerVariable(name, 'dyn');
      environments.set(key, env);
    }
    return env;
  };

  return {
    key: '$cel',
    description:
      '`{ "$cel": "<a CEL expression>", "args": { "x": <expr> } }` evaluates CEL (Common Expression Language), wherever an expression or the value a condition tests may go. ' +
      'Each arg is a variable of the expression, and it reads nothing else: pass what it needs as args (`{ "$state": … }`). ' +
      'Numbers are doubles, so write `x + 1.0`, not `x + 1`; comparisons mix them freely (`x > 2`). Dates are timestamps (`end - start >= duration("24h")`), sets are lists, an absent value is null. ' +
      'Prefer the expressions above, and use `$cel` for what they cannot say: `{ "$cel": "end >= start", "args": { "start": { "$state": "start" }, "end": { "$state": "end" } } }`.',
    check(source, names) {
      try {
        const result = environmentFor([...names].sort()).check(source);
        return result.valid ? undefined : messageOf(result.error);
      } catch (error) {
        return messageOf(error);
      }
    },
    run(source, args) {
      const names = Object.keys(args).sort();
      const key = `${names.join(',')}\n${source}`;
      let expression = parsed.get(key);
      if (!expression) {
        try {
          expression = environmentFor(names).parse(source);
        } catch (error) {
          throw new Error(messageOf(error), { cause: error });
        }
        parsed.set(key, expression);
      }
      const context: Record<string, unknown> = {};
      for (const name of names) context[name] = toCel(args[name]);
      try {
        return fromCel(expression(context));
      } catch (error) {
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

function toCel(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof URL || value instanceof RegExp) return value instanceof URL ? value.href : value.source;
  if (Array.isArray(value)) return value.map(toCel);
  if (value instanceof Set) return [...value].map(toCel);
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [toCel(k), toCel(v)]));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toCel(v)]));
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
