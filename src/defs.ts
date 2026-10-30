/**
 * Following `use` to the declaration it names: a definition in the spec's `defs`, or a preset
 * of the format. Lowercase names are built-in presets; capitalized ones are the spec's
 * definitions, then the format's own presets.
 */
import type { Presets } from "./format.ts";
import { isBuiltinName } from "./names.ts";
import type { FieldDecl, Resolved, Spec } from "./types.ts";

/** Where `use` names are looked up. */
export interface Lookup {
  readonly defs?: Spec["defs"];
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
 * own properties laid over it (outermost wins, `render` replaced whole). The same input gives
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
      target = { type: "json" };
      break;
    }
    seen.add(use);
    target = next;
  }
  const out = Object.assign({}, target, ...overrides) as Resolved;
  memo.set(decl, out);
  return out;
}

/** The name a field's `use` gives, if it has one. */
export function useName(decl: FieldDecl): string | undefined {
  return decl.type === undefined && typeof decl.use === "string" ? decl.use : undefined;
}
