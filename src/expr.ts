/** Evaluating conditions and expressions against values. */
import { getAt, resolvePointer } from './pointer.ts';
import type { ComparisonOp, Condition, ConditionLeaf, Expr } from './types.ts';

/** A value as text: nothing for none, and JSON for objects and lists, which have no text of their own. */
export function textOf(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'object':
      if (value === null) return '';
      return value instanceof Date ? value.toISOString() : JSON.stringify(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      return '';
  }
}

/** What a `$computed` function is handed besides its arguments. */
export interface FnContext {
  /** The values, as far as they are known. */
  readonly values: unknown;
  /** Read a value by pointer, resolved like `$state`. */
  get(pointer: string): unknown;
  readonly scope: Scope;
}

export type Fn = (args: Record<string, unknown>, ctx: FnContext) => unknown;

/** The runtime half of a spec: what each `$computed` name does. */
export type Functions = { readonly [name: string]: Fn };

/** Where an expression is evaluated: which object relative pointers start from, and which array item. */
export interface Scope {
  /** The enclosing object, as an absolute pointer. */
  readonly base: string;
  /** The nearest array item, as an absolute pointer. */
  readonly item?: string;
  readonly index?: number;
}

export const ROOT_SCOPE: Scope = { base: '' };

export interface Env {
  readonly values: unknown;
  readonly fns?: Functions;
  /** Overrides plain lookup, so defaults can be computed lazily. */
  readonly get?: (pointer: string) => unknown;
}

export const EXPR_KEYS = ['$state', '$item', '$index', '$computed', '$cond', '$template'] as const;

/** Whether a value is an expression object rather than a literal. */
export function isExpr(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return EXPR_KEYS.some((key) => key in value);
}

/** Whether evaluating this could depend on anything: false for pure literals. */
export function isDynamic(value: unknown): boolean {
  if (isExpr(value)) return true;
  if (Array.isArray(value)) return value.some(isDynamic);
  if (value && typeof value === 'object') return Object.values(value).some(isDynamic);
  return false;
}

function read(env: Env, pointer: string): unknown {
  return env.get ? env.get(pointer) : getAt(env.values, pointer);
}

export function evaluate(expr: Expr | undefined, env: Env, scope: Scope = ROOT_SCOPE): unknown {
  if (expr === null || typeof expr !== 'object') return expr;
  if (Array.isArray(expr)) return expr.map((e) => evaluate(e, env, scope));
  const e = expr as Record<string, unknown>;
  if (typeof e.$state === 'string') return read(env, resolvePointer(e.$state, scope.base));
  if (typeof e.$item === 'string') {
    if (scope.item === undefined) return undefined;
    return read(env, resolvePointer(e.$item, scope.item));
  }
  if (e.$index === true) return scope.index;
  if (typeof e.$computed === 'string') {
    const fn = env.fns?.[e.$computed];
    if (!fn) throw new Error(`no function named "${e.$computed}" was supplied`);
    const args: Record<string, unknown> = {};
    for (const [name, arg] of Object.entries((e.args as Record<string, Expr> | undefined) ?? {})) args[name] = evaluate(arg, env, scope);

    return fn(args, {
      values: env.values,
      get: (pointer) => read(env, resolvePointer(pointer, scope.base)),
      scope,
    });
  }
  if ('$cond' in e)
    return test(e.$cond as Condition, env, scope) ? evaluate(e.$then as Expr, env, scope) : evaluate(e.$else as Expr, env, scope);

  if (typeof e.$template === 'string') {
    return e.$template.replace(/\$\{([^}]*)\}/g, (_, ref: string) => {
      const value = read(env, resolvePointer(ref.trim(), scope.base));
      return textOf(value);
    });
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(e)) out[key] = evaluate(value as Expr, env, scope);
  return out;
}

export const OPERATORS: readonly ComparisonOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'];

/** Evaluate a condition. An absent condition holds. */
export function test(condition: Condition | undefined, env: Env, scope: Scope = ROOT_SCOPE): boolean {
  if (condition === undefined) return true;
  if (typeof condition === 'boolean') return condition;
  if (Array.isArray(condition)) return condition.every((c) => test(c, env, scope));
  const c = condition as Record<string, unknown>;
  if (Array.isArray(c.$and)) return (c.$and as Condition[]).every((x) => test(x, env, scope));
  if (Array.isArray(c.$or)) return (c.$or as Condition[]).some((x) => test(x, env, scope));
  return testLeaf(condition as ConditionLeaf, env, scope);
}

function testLeaf(leaf: ConditionLeaf, env: Env, scope: Scope): boolean {
  const { eq, neq, gt, gte, lt, lte, in: within, not, ...source } = leaf as ConditionLeaf & Record<string, unknown>;
  const value = evaluate(source, env, scope);
  let held: boolean;
  if ('eq' in leaf) {
    held = equal(value, evaluate(eq, env, scope));
  } else if ('neq' in leaf) {
    held = !equal(value, evaluate(neq, env, scope));
  } else if ('gt' in leaf) {
    held = compare(value, evaluate(gt, env, scope)) > 0;
  } else if ('gte' in leaf) {
    held = compare(value, evaluate(gte, env, scope)) >= 0;
  } else if ('lt' in leaf) {
    held = compare(value, evaluate(lt, env, scope)) < 0;
  } else if ('lte' in leaf) {
    held = compare(value, evaluate(lte, env, scope)) <= 0;
  } else if ('in' in leaf) {
    const list = evaluate(within, env, scope);
    held = Array.isArray(list) && list.some((x) => equal(value, x));
  } else {
    held = truthy(value);
  }
  return not ? !held : held;
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Set || value instanceof Map) return value.size > 0;
  return Boolean(value);
}

/** Comparable as a number: dates by time, numbers and bigints as they are; NaN otherwise. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    try {
      const x = BigInt(a as bigint);
      const y = BigInt(b as bigint);
      return x < y ? -1 : x > y ? 1 : 0;
    } catch {
      return Number.NaN;
    }
  }
  const x = a instanceof Date ? a.getTime() : typeof a === 'string' ? Date.parse(a) : Number(a);
  const y = b instanceof Date ? b.getTime() : typeof b === 'string' ? Date.parse(b) : Number(b);
  return x - y;
}

/** Structural equality over JSON plus dates, bigints, URLs, regexps, Maps, Sets and bytes. */
export function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && typeof b === 'string') return a.getTime() === Date.parse(b);
  if (a instanceof URL || a instanceof RegExp) return String(a) === String(b);
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    try {
      return BigInt(a as bigint) === BigInt(b as bigint);
    } catch {
      return false;
    }
  }
  if (a instanceof Uint8Array && b instanceof Uint8Array) return a.length === b.length && a.every((x, i) => x === b[i]);

  if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every((x) => [...b].some((y) => equal(x, y)));

  if (a instanceof Map && b instanceof Map) return a.size === b.size && [...a].every(([k, v]) => b.has(k) && equal(v, b.get(k)));

  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));

  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
