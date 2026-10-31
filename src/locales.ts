/**
 * Translations. A table per locale maps JSON Pointers into a spec to the text that replaces what
 * is there: `{ "/fields/name/label": "Dienstname" }`. A spec may carry its own under `locales`,
 * and `localize` lays one over it, so everything downstream (forms, issues, JSON Schema) reads
 * translated text without knowing. `texts` lists what there is to translate.
 */
import { lookUp, type Lookup } from './defs.ts';
import type { ElementDef } from './elements.ts';
import { EXPR_KEYS } from './expr.ts';
import { humanize } from './form.ts';
import { isBuiltinName } from './names.ts';
import { escapeSegment, parsePointer } from './pointer.ts';
import { functionsOf, registryOf, type Registry } from './registry.ts';
import type { Fault, FieldDecl, Spec, Text, Translations } from './types.ts';
import { suggest } from './values.ts';

/** Where a spec shows text: a property that holds `Text`, and what it holds, or would show if absent. */
interface Slot {
  readonly pointer: string;
  readonly value?: unknown;
  /** The text shown where the spec gives none: a label made from the key, a preset's placeholder. */
  readonly implied?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const FIELD_TEXT = ['label', 'description', 'hint', 'placeholder', 'patternMessage'] as const;

/** Every place in the spec that shows text, as the spec is written. */
function slotsOf(spec: Spec, registry: Registry): Slot[] {
  const slots: Slot[] = [];
  const lookup: Lookup = { defs: spec.defs, presets: registry.presets };
  const slot = (pointer: string, value: unknown, implied?: string) => {
    if (value !== undefined) slots.push({ pointer, value });
    else if (implied !== undefined && implied !== '') slots.push({ pointer, implied });
  };

  const render = (node: unknown, at: string) => {
    if (!isObject(node) || typeof node.type !== 'string') return;
    const def: ElementDef | undefined = registry.elements.get(node.type);
    if (isObject(node.props)) {
      for (const [prop, value] of Object.entries(node.props))
        if (isText(def?.props?.[prop]?.schema)) slot(`${at}/props/${escapeSegment(prop)}`, value);
    }
    if (Array.isArray(node.children)) node.children.forEach((child, i) => render(child, `${at}/children/${i}`));
  };

  const groups = (gs: unknown, at: string) => {
    if (!isObject(gs)) return;
    for (const [id, g] of Object.entries(gs)) {
      if (!isObject(g)) continue;
      const gat = `${at}/${escapeSegment(id)}`;
      slot(`${gat}/label`, g.label);
      slot(`${gat}/description`, g.description);
      render(g.render, `${gat}/render`);
    }
  };

  const fields = (fs: unknown, at: string) => {
    if (!isObject(fs)) return;
    for (const [key, decl] of Object.entries(fs)) field(decl, `${at}/${escapeSegment(key)}`, key);
  };

  const field = (decl: unknown, at: string, key?: string) => {
    if (!isObject(decl)) return;
    const d = decl as unknown as FieldDecl;
    for (const prop of FIELD_TEXT) {
      if (d[prop as 'label'] !== undefined) {
        slot(`${at}/${prop}`, d[prop as 'label']);
        continue;
      }
      const inherited = inheritedText(lookup, d, prop);
      if (inherited === FROM_DEFS) continue;
      slot(`${at}/${prop}`, undefined, inherited ?? (prop === 'label' && key !== undefined ? humanize(key) : undefined));
    }
    if (Array.isArray(decl.checks)) decl.checks.forEach((c, i) => isObject(c) && slot(`${at}/checks/${i}/message`, c.message));
    if (isObject(decl.namedBy)) slot(`${at}/namedBy`, decl.namedBy);
    if (Array.isArray(decl.options)) {
      decl.options.forEach((o, i) => {
        const oat = `${at}/options/${i}`;
        if (!isObject(o)) return slot(`${oat}/label`, undefined, String(o));
        slot(`${oat}/label`, o.label, String(o.value));
        slot(`${oat}/description`, o.description);
      });
    }
    render(decl.render, `${at}/render`);
    fields(decl.fields, `${at}/fields`);
    groups(decl.groups, `${at}/groups`);
    if (isObject(decl.variants)) {
      for (const [name, variant] of Object.entries(decl.variants)) {
        if (!isObject(variant)) continue;
        const vat = `${at}/variants/${escapeSegment(name)}`;
        slot(`${vat}/label`, variant.label, name);
        slot(`${vat}/description`, variant.description);
        fields(variant.fields, `${vat}/fields`);
        groups(variant.groups, `${vat}/groups`);
      }
    }
    for (const inner of ['items', 'values', 'keys']) field(decl[inner], `${at}/${inner}`);
  };

  slot('/title', spec.title);
  slot('/description', spec.description);
  fields(spec.fields, '/fields');
  groups(spec.groups, '/groups');
  if (isObject(spec.defs)) for (const [name, decl] of Object.entries(spec.defs)) field(decl, `/defs/${escapeSegment(name)}`);
  if (isObject(spec.layouts)) for (const [name, node] of Object.entries(spec.layouts)) render(node, `/layouts/${escapeSegment(name)}`);
  return slots;
}

const isText = (schema: unknown) => isObject(schema) && schema.$ref === '#/$defs/text';

const FROM_DEFS = Symbol('defs');

/**
 * Where a field without its own text gets it from: {@link FROM_DEFS} when a definition it builds on
 * gives it (translated there), the text when a preset of the registry does, else nothing.
 */
function inheritedText(lookup: Lookup, decl: FieldDecl, prop: string): typeof FROM_DEFS | string | undefined {
  const seen = new Set<string>();
  for (let name = decl.use; typeof name === 'string' && !seen.has(name);) {
    seen.add(name);
    const fromDefs = !isBuiltinName(name) && lookup.defs?.[name] !== undefined;
    if (fromDefs) return FROM_DEFS;
    const base = lookUp(lookup, name);
    if (!base) return undefined;
    const value = (base as Record<string, unknown>)[prop];
    if (value !== undefined) return typeof value === 'string' ? value : undefined;
    name = base.type === undefined ? base.use : undefined;
  }
  return undefined;
}

/** The strings inside a text, by pointer: the text itself, a template's, each branch of a `$cond`. */
function leavesOf(text: unknown, at: string, out: [string, string][] = []): [string, string][] {
  if (typeof text === 'string') {
    if (text !== '') out.push([at, text]);
  } else if (isObject(text)) {
    if (typeof text.$template === 'string') {
      out.push([`${at}/$template`, text.$template]);
    } else if ('$cond' in text) {
      leavesOf(text.$then, `${at}/$then`, out);
      leavesOf(text.$else, `${at}/$else`, out);
    }
  }
  return out;
}

export interface TextsOptions {
  readonly registry?: Registry;
}

/**
 * Every string a spec shows people, by JSON Pointer: what a translation table translates. It
 * includes text the spec only implies (a label made from the key, a plain option's value, a
 * preset's placeholder), so a translation can give it. Code (`$cel`, `$computed`) has no strings
 * here; replace the whole text it sits in.
 */
export function texts(spec: Spec, options: TextsOptions = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of slotsOf(spec, options.registry ?? registryOf(spec))) {
    if (s.implied !== undefined) out[s.pointer] = s.implied;
    else for (const [pointer, text] of leavesOf(s.value, s.pointer)) out[pointer] = text;
  }
  return out;
}

/** What a translation may replace: each text, and each string inside one. */
export interface Targets {
  /** Pointer → the original text there (undefined where only implied). */
  readonly slots: ReadonlyMap<string, unknown>;
  /** Pointer of a string inside a text → the pointer of that text. */
  readonly leaves: ReadonlyMap<string, string>;
}

export function targetsOf(spec: Spec, registry: Registry = registryOf(spec)): Targets {
  const slots = new Map<string, unknown>();
  const leaves = new Map<string, string>();
  for (const s of slotsOf(spec, registry)) {
    slots.set(s.pointer, s.value);
    for (const [pointer] of leavesOf(s.value, s.pointer)) if (pointer !== s.pointer) leaves.set(pointer, s.pointer);
    // The branches of a `$cond` are text too, and may be replaced whole.
    collectBranches(s.value, s.pointer, s.pointer, leaves);
  }
  return { slots, leaves };
}

function collectBranches(text: unknown, at: string, slot: string, leaves: Map<string, string>) {
  if (!isObject(text) || !('$cond' in text)) return;
  for (const branch of ['$then', '$else']) {
    leaves.set(`${at}/${branch}`, slot);
    collectBranches(text[branch], `${at}/${branch}`, slot, leaves);
  }
}

/** A locale and the ones it falls back to: `de-AT`, then `de`. */
export function fallbacksOf(locale: string): string[] {
  const parts = locale.split('-');
  return parts.map((_, i) => parts.slice(0, parts.length - i).join('-'));
}

/** A locale the spec carries, by its tag, or a table of your own. */
export type Locale = string | Translations;

/** The tables a list of locales stands for, first wins: each tag followed by its fallbacks, as far as the spec carries them. */
export function tablesOf(spec: Spec, locales: Locale | readonly Locale[]): Translations[] {
  const list = typeof locales === 'string' || !Array.isArray(locales) ? [locales as Locale] : (locales as readonly Locale[]);
  const tables: Translations[] = [];
  for (const locale of list) {
    if (typeof locale !== 'string') tables.push(locale);
    else for (const tag of fallbacksOf(locale)) if (spec.locales?.[tag]) tables.push(spec.locales[tag]);
  }
  return tables;
}

export interface LocalizeOptions {
  readonly registry?: Registry;
}

/**
 * The spec with its text translated: by a locale it carries under `locales` (`"de-AT"` falls back
 * to `"de"`), by a table of your own, or by several, the first that translates a text winning.
 * Text no table translates stays as written. Pointers that lead to no text are ignored; the
 * checker reports them. The result keeps the spec's registry, functions and type.
 */
export function localize<S extends Spec>(spec: S, locales: Locale | readonly Locale[], options: LocalizeOptions = {}): S {
  const registry = options.registry ?? registryOf(spec);
  const tables = tablesOf(spec, locales);
  if (tables.length === 0) return spec;
  const { slots, leaves } = targetsOf(spec, registry);
  const chosen = new Map<string, { text: Text; rank: number }>();
  tables.forEach((table, rank) => {
    for (const [pointer, text] of Object.entries(table))
      if (!chosen.has(pointer) && (slots.has(pointer) || leaves.has(pointer))) chosen.set(pointer, { text, rank });
  });
  // A text replaced whole and strings inside it replaced too: whichever table comes first wins.
  const firstInside = new Map<string, number>();
  for (const [pointer, { rank }] of chosen) {
    const slot = leaves.get(pointer);
    if (slot !== undefined) firstInside.set(slot, Math.min(rank, firstInside.get(slot) ?? rank));
  }
  const wins = (pointer: string) => {
    const slot = leaves.get(pointer);
    if (slot === undefined) return chosen.get(pointer)!.rank < (firstInside.get(pointer) ?? Infinity);
    const whole = chosen.get(slot);
    return whole === undefined || whole.rank > firstInside.get(slot)!;
  };
  const out = structuredClone(spec) as Record<string, unknown>;
  // Shallower first, so a `$cond` branch is replaced before the strings inside it.
  const pointers = [...chosen.keys()].filter(wins).sort((a, b) => parsePointer(a).length - parsePointer(b).length);
  for (const pointer of pointers) put(out, pointer, chosen.get(pointer)!.text);
  return registry.define(out as unknown as S, { fns: functionsOf(spec) });
}

/** Sets the text at a pointer, adding the last property; a plain option becomes `{ value, label }`. */
function put(root: Record<string, unknown>, pointer: string, text: unknown) {
  const segments = parsePointer(pointer);
  const last = segments.pop()!;
  let parent: unknown = root;
  for (let i = 0; i < segments.length; i++) {
    const container = parent as Record<string, unknown>;
    let next = container[segments[i]!];
    if (segments[i - 1] === 'options' && Array.isArray(container) && !isObject(next) && next !== undefined)
      next = container[segments[i]!] = { value: next };
    if (!isObject(next) && !Array.isArray(next)) return;
    parent = next;
  }
  (parent as Record<string, unknown>)[last] = text;
}

export interface CheckTranslationsOptions {
  readonly registry?: Registry;
  /** Where the table sits, prefixed to each fault's path: `/locales/de` for a spec's own. */
  readonly at?: string;
  /** Tables consulted after this one, so what they translate is not missing from it. */
  readonly fallbacks?: readonly Translations[];
}

/** A tag such as `de`, `pt-BR` or `zh-Hant-TW`. */
export const LOCALE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

/**
 * Every fault of a translation table against a spec, each at a pointer into the table: a pointer
 * that leads to no text (with "did you mean"), a value that is not text, a translation that reads
 * values the text it translates does not, and, as a warning, the texts it leaves as written.
 */
export function checkTranslations(spec: Spec, table: unknown, options: CheckTranslationsOptions = {}): Fault[] {
  const at = options.at ?? '';
  const faults: Fault[] = [];
  const fault = (path: string, message: string, severity: Fault['severity'] = 'error') => faults.push({ path, message, severity });
  if (!isObject(table)) {
    fault(at, 'must be an object from JSON Pointers into the spec to the text in their place');
    return faults;
  }
  const { slots, leaves } = targetsOf(spec, options.registry ?? registryOf(spec));
  const known = [...slots.keys(), ...leaves.keys()];
  for (const [pointer, text] of Object.entries(table)) {
    const path = `${at}/${escapeSegment(pointer)}`;
    if (!slots.has(pointer) && !leaves.has(pointer)) {
      const near = suggest(pointer, known);
      fault(path, `no text at ${pointer || '""'} to translate.${near ? ` Did you mean "${near}"?` : ''} \`texts(spec)\` lists them.`);
      continue;
    }
    if (pointer.endsWith('/$template')) {
      if (typeof text !== 'string') fault(path, "must be a string: it replaces a template's text");
    } else if (typeof text !== 'string' && !(isObject(text) && EXPR_KEYS.some((k) => k in text))) {
      fault(path, 'must be text: a string, or an expression ($template, $cond, …)');
      continue;
    }
    const original = readsOf(slots.get(leaves.get(pointer) ?? pointer));
    const reads = pointer.endsWith('/$template') && typeof text === 'string' ? readsOf({ $template: text }) : readsOf(text);
    for (const read of reads) {
      if (!original.has(read))
        fault(path, `reads "${read}", which the text it translates does not; a translation says the same of the same values`);
    }
  }
  const tables = [table as Translations, ...(options.fallbacks ?? [])];
  const all = Object.keys(texts(spec, options));
  const missing = all.filter((p) => !tables.some((t) => Object.keys(t).some((k) => p === k || p.startsWith(`${k}/`))));
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(', ');
    fault(
      at,
      `leaves ${missing.length} of ${all.length} texts as written: ${shown}${missing.length > 5 ? ', …' : ''}. \`texts(spec)\` lists them.`,
      'warning',
    );
  }
  return faults;
}

/** The pointers a text reads: `$state`, `$item` and template references, anywhere inside it. */
function readsOf(text: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(text)) {
    for (const x of text) readsOf(x, out);
  } else if (isObject(text)) {
    for (const key of ['$state', '$item'] as const) if (typeof text[key] === 'string') out.add(text[key]);
    if (typeof text.$template === 'string') for (const m of text.$template.matchAll(/\$\{([^}]*)\}/g)) out.add(m[1]!.trim());
    for (const [key, value] of Object.entries(text)) if (key !== '$template') readsOf(value, out);
  }
  return out;
}
