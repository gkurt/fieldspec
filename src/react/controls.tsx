/**
 * What container and choice controls do, without how they look: a list's items and edits, a
 * record's keys and renames, a variant's choice, an optional object's presence, an enum's
 * options. Plain functions over a control's props, so a renderer may call them anywhere; they
 * write through the form and leave touching to the renderer.
 */
import type { ReactNode } from 'react';
import { deref } from '#src/defs.ts';
import type { FieldOption } from '#src/form.ts';
import { optionsOf } from '#src/kinds.ts';
import { joinPointer } from '#src/pointer.ts';
import type { EnumField, FieldDecl, VariantField } from '#src/types.ts';
import { initialValue } from '#src/values.ts';
import type { ControlProps } from './index.tsx';

const declOf = (p: ControlProps, decl: FieldDecl) => deref({ defs: p.form.spec.defs, presets: p.form.registry.presets }, decl);

export interface ListItem {
  readonly index: number;
  /** The item's pointer. */
  readonly path: string;
  /** What the item is called: its name from the list's `namedBy`, else its position ("#2"). */
  readonly label: string;
  /** Draws the item as the spec lays it out. */
  readonly render: () => ReactNode;
}

export interface ListControl {
  readonly items: readonly ListItem[];
  /** Below `maxItems`, and editable. */
  readonly canAdd: boolean;
  /** Appends a new item: the item's default, or `value`. */
  readonly add: (value?: unknown) => void;
  readonly remove: (index: number) => void;
  readonly move: (from: number, to: number) => void;
}

/** A list's items (an array's, or a set's), and the edits a list control offers. */
export function listOf(p: ControlProps): ListControl {
  const { field } = p;
  const values = Array.isArray(field.value) ? field.value : field.value instanceof Set ? [...field.value] : [];
  const { maxItems } = field.decl as { maxItems?: number };
  const item = p.fieldNode?.item;
  return {
    items: values.map((_, index) => {
      const path = joinPointer(field.path, index);
      const label = p.form.field(path)?.label ?? `#${index + 1}`;
      return { index, path, label, render: () => (item ? p.render(item, path, { item: path, index }) : null) };
    }),
    canAdd: !p.disabled && (maxItems === undefined || values.length < maxItems),
    add: (value) => p.form.addItem(field.path, value),
    remove: (index) => p.form.removeItem(joinPointer(field.path, index)),
    move: (from, to) => {
      if (from !== to) p.form.moveItem(field.path, from, to);
    },
  };
}

export interface Entry {
  readonly key: unknown;
  /** The key as text, to show and edit. */
  readonly label: string;
  /** Its name from the record's or map's `namedBy`, if it has one there. */
  readonly name?: string;
  readonly path: string;
  /** Draws the entry's value as the spec lays it out. */
  readonly render: () => ReactNode;
}

export interface EntriesControl {
  readonly entries: readonly Entry[];
  /** Adds an entry under a typed key, with its value's default. Returns why the key is refused, if it is. */
  readonly add: (typed: string) => string | undefined;
  /** Renames an entry in place, keeping its value and its position. Returns why the key is refused, if it is. */
  readonly rename: (from: unknown, typed: string) => string | undefined;
  readonly remove: (key: unknown) => void;
}

/** A record's or map's entries, and the edits an entries control offers. Map keys are read as their kind. */
export function entriesOf(p: ControlProps): EntriesControl {
  const { field } = p;
  const isMap = field.decl.type === 'map';
  const pairs: [unknown, unknown][] = isMap
    ? field.value instanceof Map
      ? [...field.value]
      : []
    : field.value !== null && typeof field.value === 'object'
      ? Object.entries(field.value)
      : [];
  const keyDecl = isMap ? declOf(p, (field.decl as { keys: FieldDecl }).keys) : undefined;
  const numeric = keyDecl?.type === 'int' || keyDecl?.type === 'number';
  const readKey = (typed: string): { key: unknown } | { error: string } => {
    if (typed === '') return { error: 'Enter a key' };
    const key = numeric ? Number(typed) : typed;
    if (numeric && (Number.isNaN(key) || (keyDecl?.type === 'int' && !Number.isInteger(key))))
      return { error: keyDecl?.type === 'int' ? 'Enter a whole number' : 'Enter a number' };
    if (pairs.some(([existing]) => String(existing) === String(key))) return { error: `"${typed}" is already a key` };
    return { key };
  };
  const item = p.fieldNode?.item;
  const { namedBy } = field.decl as { namedBy?: unknown };
  return {
    entries: pairs.map(([key]) => {
      const path = joinPointer(field.path, String(key));
      const name = namedBy === undefined ? undefined : p.form.field(path)?.label;
      return {
        key,
        label: String(key),
        ...(name !== undefined && { name }),
        path,
        render: () => (item ? p.render(item, path, { item: path }) : null),
      };
    }),
    add: (typed) => {
      const read = readKey(typed);
      if ('error' in read) return read.error;
      const at = joinPointer(field.path, String(read.key));
      const initial = initialValue(p.form.spec, (field.decl as { values: FieldDecl }).values, p.form.values, at, {
        registry: p.form.registry,
      });
      if (!isMap) {
        p.form.set(at, initial ?? '');
        return undefined;
      }
      const next = new Map(field.value instanceof Map ? field.value : []);
      next.set(read.key, initial);
      p.set(next);
      return undefined;
    },
    rename: (from, typed) => {
      if (typed === String(from)) return undefined;
      const read = readKey(typed);
      if ('error' in read) return read.error;
      const renamed = pairs.map(([k, v]): [unknown, unknown] => [Object.is(k, from) ? read.key : k, v]);
      p.set(isMap ? new Map(renamed) : Object.fromEntries(renamed));
      return undefined;
    },
    remove: (key) => p.form.removeItem(joinPointer(field.path, String(key))),
  };
}

export interface ObjectControl {
  /** The object is there. An absent one (an optional one, say) is offered rather than drawn. */
  readonly present: boolean;
  /** It may be removed. */
  readonly optional: boolean;
  /** Creates it with its fields' defaults. */
  readonly add: () => void;
  readonly remove: () => void;
  /** Draws its fields as the spec lays them out; nothing while it is absent. */
  readonly render: () => ReactNode;
}

/**
 * An object's presence and fields. Offer an absent object rather than drawing it: its fields
 * would have nothing to show, and a definition that may contain itself would draw itself without end.
 */
export function objectOf(p: ControlProps): ObjectControl {
  const { field } = p;
  const value = field.value;
  const present = value !== null && typeof value === 'object' && !Array.isArray(value);
  const inner = p.fieldNode?.inner;
  return {
    present,
    optional: field.decl.optional === true,
    add: () =>
      p.set(initialValue(p.form.spec, { ...field.decl, optional: false }, p.form.values, field.path, { registry: p.form.registry }) ?? {}),
    remove: () => p.set(undefined),
    render: () => (present && inner ? p.render(inner, field.path) : null),
  };
}

export interface VariantControl {
  /** The property that names the variant. */
  readonly key: string;
  /** The current variant; none when there is no value, or the values are mixed. */
  readonly current: string | undefined;
  readonly options: readonly { readonly name: string; readonly label: string }[];
  /** Switches to a variant, fresh. */
  readonly choose: (name: string) => void;
  /** Draws the current variant's fields as the spec lays them out. */
  readonly render: () => ReactNode;
}

/** A variant's choice and fields. Mixed values are of different variants: choosing one sets it everywhere. */
export function variantOf(p: ControlProps): VariantControl {
  const { field } = p;
  const v = field.decl as VariantField;
  const named = field.mixed ? undefined : (field.value as Record<string, unknown> | undefined)?.[v.key];
  const current = typeof named === 'string' ? named : undefined;
  const inner = current === undefined ? undefined : p.fieldNode?.variants?.[current];
  return {
    key: v.key,
    current,
    options: Object.keys(v.variants).map((name) => ({ name, label: p.form.text(v.variants[name]!.label, field.scope) ?? name })),
    choose: (name) => p.set({ [v.key]: name }),
    render: () => (inner ? p.render(inner, field.path) : null),
  };
}

export interface ChoiceControl {
  readonly options: readonly FieldOption[];
  /** The chosen option's position; -1 for none, or mixed values. By position: options may repeat a value, or differ only in type (1 and "1"). */
  readonly index: number;
  readonly choose: (index: number) => void;
}

/** An enum's options and choice, by position. */
export function choicesOf(p: ControlProps): ChoiceControl {
  const { field } = p;
  const options = field.options ?? [];
  return {
    options,
    index: field.mixed ? -1 : options.findIndex((o) => Object.is(o.value, field.value)),
    choose: (index) => {
      const option = options[index];
      if (option) p.set(option.value);
    },
  };
}

export interface ChecksControl {
  readonly options: readonly { readonly label: string; readonly value: unknown; readonly checked: boolean }[];
  readonly toggle: (index: number, checked: boolean) => void;
}

/** A set of enum values as options to check; undefined for a set of anything else. */
export function checksOf(p: ControlProps): ChecksControl | undefined {
  const { field } = p;
  const items = declOf(p, (field.decl as { items: FieldDecl }).items);
  if (items.type !== 'enum') return undefined;
  const options = optionsOf(items as EnumField, { values: p.form.values }, field.scope);
  const set = field.value instanceof Set ? field.value : new Set();
  return {
    options: options.map((o) => ({
      label: p.form.text(o.label, field.scope) ?? String(o.value),
      value: o.value,
      checked: set.has(o.value),
    })),
    toggle: (index, checked) => {
      const option = options[index];
      if (!option) return;
      const next = new Set(set);
      if (checked) next.add(option.value);
      else next.delete(option.value);
      p.set(next);
    },
  };
}
