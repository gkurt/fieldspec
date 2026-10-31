/**
 * Versions and migrations. A spec says which `version` of its values it describes, and its
 * `migrations` bring values written for an earlier version forward, one version at a time. Each
 * is a list of JSON Patch operations over the values as stored (JSON), so it stays data; `*`
 * stands for every item or key at its level, and a `value` may be an expression over the values.
 * Values `encode` writes say their version in `$version`, and `decode` migrates older ones.
 */
import { evaluate, type Env, type Functions } from './expr.ts';
import { child, formatPointer, getAt, parsePointer, setAt } from './pointer.ts';
import { functionsOf, registryOf, type Registry } from './registry.ts';
import type { MigrationOp, Spec } from './types.ts';

/** The key values say their version in. Field keys cannot start with `$`, so it never clashes. */
export const VERSION_KEY = '$version';

/** The version of the values a spec describes: its `version`, else 1. */
export const versionOf = (spec: Spec): number => spec.version ?? 1;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export interface MigrateOptions {
  readonly registry?: Registry;
  readonly fns?: Functions;
  /**
   * The version the values were written for, when they do not say so with `$version`. Values
   * that say neither are taken as the spec's own version, and are not migrated.
   */
  readonly from?: number;
  /** Told of each value a migration could not work out, which keeps its old value. `parse` reports them as issues. */
  readonly onError?: (path: string, version: number, message: string) => void;
}

/** The version values were written for: their `$version`, else `from`. */
export function writtenFor(json: unknown, from?: number): number | undefined {
  const stated = isPlainObject(json) ? json[VERSION_KEY] : undefined;
  return typeof stated === 'number' ? stated : from;
}

/**
 * JSON written for an earlier version of the spec, brought to its current one by each migration
 * in between, in order. The result says its version in `$version` when the spec declares one.
 * Values from a later version than the spec's, or of no known version, are returned as they are.
 */
export function migrate(spec: Spec, json: unknown, options: MigrateOptions = {}): unknown {
  const to = versionOf(spec);
  const from = writtenFor(json, options.from);
  if (from === undefined || !Number.isInteger(from) || from > to || !isPlainObject(json)) return json;
  const registry = options.registry ?? registryOf(spec);
  const fns = options.fns ?? functionsOf(spec);
  let tree: unknown = json;
  for (let version = from + 1; version <= to; version++) {
    for (const op of spec.migrations?.[version] ?? []) {
      const env: Env = { values: tree, fns, languages: registry.languages };
      tree = step(tree, op, env, (path, message) => options.onError?.(path, version, message));
    }
  }
  const { [VERSION_KEY]: _, ...rest } = tree as Record<string, unknown>;
  return spec.version === undefined ? rest : { [VERSION_KEY]: to, ...rest };
}

/** A pointer's segments matched against the values: `*` takes every item or key there. */
interface Match {
  readonly at: readonly string[];
  /** What each `*` stood for, in order. */
  readonly bound: readonly string[];
  readonly node: unknown;
}

function keysOf(node: unknown): string[] {
  if (Array.isArray(node)) return node.map((_, i) => String(i));
  return isPlainObject(node) ? Object.keys(node) : [];
}

/** Every place the segments lead to that holds a value. */
function matchesOf(tree: unknown, segments: readonly string[]): Match[] {
  let matches: Match[] = [{ at: [], bound: [], node: tree }];
  for (const segment of segments) {
    const next: Match[] = [];
    for (const m of matches) {
      if (segment === '*') {
        for (const key of keysOf(m.node)) next.push({ at: [...m.at, key], bound: [...m.bound, key], node: child(m.node, key) });
      } else {
        const node = child(m.node, segment);
        if (node !== undefined) next.push({ at: [...m.at, segment], bound: m.bound, node });
      }
    }
    matches = next;
  }
  return matches;
}

/** Where a target goes: its `*`s filled, in order, by what the source's stood for. */
const fill = (segments: readonly string[], bound: readonly string[]): string[] => {
  let i = 0;
  return segments.map((s) => (s === '*' ? (bound[i++] ?? s) : s));
};

/** One operation. What it does not find (an optional value that is absent, say) it leaves be. */
function step(tree: unknown, op: MigrationOp, env: Env, failed: (path: string, message: string) => void): unknown {
  const segments = parsePointer(op.path);
  switch (op.op) {
    case 'add':
    case 'replace': {
      const last = segments.at(-1)!;
      const parents = segments.slice(0, -1);
      // A parent without `*` is made where it is missing, so a value can move into a new object.
      const places = parents.includes('*')
        ? matchesOf(tree, parents)
        : [{ at: parents, bound: [], node: getAt(tree, formatPointer(parents)) }];
      for (const place of places) {
        for (const key of last === '*' ? keysOf(place.node) : [last]) {
          if (op.op === 'replace' && child(place.node, key) === undefined) continue;
          // A value that cannot be worked out leaves the old one.
          let value: unknown;
          try {
            value = evaluate(op.value, { ...env, values: tree }, { base: formatPointer(place.at) });
          } catch (error) {
            failed(formatPointer([...place.at, key]), (error as Error).message);
            continue;
          }
          if (value !== undefined) tree = setAt(tree, formatPointer([...place.at, key]), value);
        }
      }
      return tree;
    }
    case 'remove':
      // Last first, so removing an item leaves the indices of the ones before it.
      for (const m of matchesOf(tree, segments).reverse()) tree = setAt(tree, formatPointer(m.at), undefined);
      return tree;
    case 'move':
    case 'copy': {
      const sources = matchesOf(tree, parsePointer(op.from));
      if (op.op === 'move') for (const m of [...sources].reverse()) tree = setAt(tree, formatPointer(m.at), undefined);
      for (const m of sources) tree = setAt(tree, formatPointer(fill(segments, m.bound)), m.node);
      return tree;
    }
  }
}
