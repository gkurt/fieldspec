/**
 * What an application keeps about a spec, in the spec's `meta`: above all the plain-words
 * description the spec was written from. A fingerprint of the spec says whether the two still
 * match, so "the description is out of date" is worked out and never stored.
 */
import type { Spec, SpecDescription } from './types.ts';

/** What a fingerprint leaves out: the application's notes, and which release of the schema the spec names. */
const UNFINGERPRINTED = ['meta', '$schema'];

/** JSON with each object's keys sorted, so two values that differ only in key order read alike. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${stableJson(member)}`);
  return `{${members.join(',')}}`;
}

/** cyrb53: a 53-bit hash of a string, the same in every runtime. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * A short, stable string for what a spec says: the same for two specs that differ only in the
 * order of their keys, in `meta` or in `$schema`, and different once a field, a constraint or
 * anything else of the spec changes. Key order is left out because stores of JSON do not keep
 * it, so moving a field leaves the fingerprint as it was. Not a secret and not collision-proof:
 * it tells a changed spec from an unchanged one.
 */
export function fingerprint(spec: unknown): string {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return hash(stableJson(spec ?? null));
  return hash(stableJson(Object.fromEntries(Object.entries(spec).filter(([key]) => !UNFINGERPRINTED.includes(key)))));
}

/** The description a spec carries in `meta.description`, if it has one with a text. */
export function descriptionOf(spec: Spec | null | undefined): SpecDescription | undefined {
  const description = spec?.meta?.description;
  return description !== null && typeof description === 'object' && typeof description.text === 'string' ? description : undefined;
}

/**
 * The description as it is kept with `spec`. A text, or a description that names no spec it
 * matched, is taken to describe this spec and gets its fingerprint; one that names a spec keeps
 * what it names, so a description sent back with a spec changed since stays out of date.
 */
export function stampDescription(spec: unknown, description: string | SpecDescription): SpecDescription {
  if (typeof description === 'string') return { text: description, of: fingerprint(spec) };
  return description.of === undefined ? { ...description, of: fingerprint(spec) } : description;
}

/**
 * Whether a description no longer says what the spec is: it names a spec it matched, and this
 * one's fingerprint differs. A spec without a description is never out of date, nor is a
 * description that names no spec yet, which {@link stampDescription} takes to describe the spec
 * it is kept with. Reads the spec's own description unless another is given.
 */
export function isDescriptionStale(
  spec: Spec | null | undefined,
  description: SpecDescription | null | undefined = descriptionOf(spec),
): boolean {
  return description !== null && description !== undefined && description.of !== undefined && description.of !== fingerprint(spec);
}

/**
 * The spec with a description in `meta.description`, stamped as {@link stampDescription} does,
 * or without one for `undefined`. The rest of `meta` is kept, and the spec's fingerprint does
 * not change.
 */
export function withDescription(spec: Spec, description: string | SpecDescription | undefined): Spec {
  const { description: _, ...others } = spec.meta ?? {};
  const { meta: __, ...rest } = spec;
  if (description !== undefined) return { ...rest, meta: { ...others, description: stampDescription(spec, description) } };
  return Object.keys(others).length > 0 ? { ...rest, meta: others } : rest;
}
