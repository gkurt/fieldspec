import { isBuiltinName } from './names.ts';
/**
 * Following `use` to the declaration it names: a definition in the spec's `defs`, or a preset
 * of the registry. Lowercase names are built-in presets; capitalized ones are the spec's
 * definitions, then the registry's own presets.
 */
import type { Presets } from './registry.ts';
import type { Check, FieldDecl, ObjectField, Resolved, Spec, VariantField } from './types.ts';

/** Where `use` names are looked up. */
export interface Lookup {
  readonly defs?: Spec['defs'];
  readonly presets?: Presets;
}

/** The declaration `use` names, or undefined. */
export function lookUp(lookup: Lookup, name: string): FieldDecl | undefined {
  if (isBuiltinName(name)) return lookup.presets?.[name];
  return lookup.defs?.[name] ?? lookup.presets?.[name];
}

const NONE = {};
const cache = new WeakMap<object, WeakMap<object, WeakMap<FieldDecl, Resolved>>>();

/**
 * The declaration a field stands for: itself, or the base its `use` names with the field's
 * own properties laid over it (outermost wins, `render` replaced whole), except `checks`, which
 * add up: a definition's rules hold wherever it is used. The same input gives
 * the same object, so results can be compared and cached. An unknown or circular name gives a
 * `json` field, which accepts anything; the checker reports it.
 */
export function deref(lookup: Lookup, decl: FieldDecl): Resolved {
  if (decl.use === undefined || decl.type !== undefined) return decl as Resolved;
  const byDefs = cache.get(lookup.defs ?? NONE) ?? new WeakMap<object, WeakMap<FieldDecl, Resolved>>();
  cache.set(lookup.defs ?? NONE, byDefs);
  const memo = byDefs.get(lookup.presets ?? NONE) ?? new WeakMap<FieldDecl, Resolved>();
  byDefs.set(lookup.presets ?? NONE, memo);
  const hit = memo.get(decl);
  if (hit) return hit;
  const seen = new Set<string>();
  const overrides: Record<string, unknown>[] = [];
  let target: FieldDecl = decl;
  while (target.use !== undefined && target.type === undefined) {
    const { use, ...own } = target as FieldDecl & { use: string };
    overrides.unshift(own);
    const next = seen.has(use) ? undefined : lookUp(lookup, use);
    if (!next) {
      target = { type: 'json' };
      break;
    }
    seen.add(use);
    target = next;
  }
  const out = Object.assign({}, target, ...overrides) as Resolved & { checks?: readonly Check[] };
  const checks = [target, ...overrides].flatMap((d) => (d.checks as readonly Check[] | undefined) ?? []);
  if (checks.length > 0) out.checks = checks;
  memo.set(decl, out);
  return out;
}

/** Whether following a field's `use` comes back around before it reaches a kind. */
export function circular(lookup: Lookup, decl: FieldDecl): boolean {
  const seen = new Set<string>();
  for (let d: FieldDecl | undefined = decl; d && d.use !== undefined && d.type === undefined; d = lookUp(lookup, d.use)) {
    if (seen.has(d.use)) return true;
    seen.add(d.use);
  }
  return false;
}

/** The name a field's `use` gives, if it has one. */
export function usedName(decl: FieldDecl): string | undefined {
  return decl.type === undefined && typeof decl.use === 'string' ? decl.use : undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The path by which a definition's smallest value would contain itself, if one does: through
 * fields it requires (not optional, no default), and a variant's first variant. Such a value
 * could never end; the checker reports it, and filling defaults stops where it repeats.
 */
export function requiresItself(defs: NonNullable<Spec['defs']>, start: string): string[] | undefined {
  // Shared across branches: a definition searched once without finding the start never will,
  // so definitions that use each other many times are each searched once.
  const seen = new Set([start]);
  const visit = (decl: FieldDecl, trail: string[]): string[] | undefined => {
    if (!isObject(decl) || decl.optional || decl.default !== undefined) return undefined;
    if (decl.use !== undefined && decl.type === undefined) {
      const name = String(decl.use);
      if (name === start) return trail;
      if (seen.has(name) || !defs[name]) return undefined;
      seen.add(name);
      return visit(defs[name], trail);
    }
    let fields: ObjectField['fields'] | undefined;
    if (decl.type === 'object') fields = (decl as unknown as ObjectField).fields;
    if (decl.type === 'variant') fields = Object.values((decl as unknown as VariantField).variants ?? {})[0]?.fields;
    for (const [key, field] of Object.entries(fields ?? {})) {
      const found = visit(field, [...trail, key]);
      if (found) return found;
    }
    return undefined;
  };
  return defs[start] ? visit(defs[start], [start]) : undefined;
}
