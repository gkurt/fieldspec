/**
 * The element catalog: everything `render` may name. Like json-render's catalog it is the
 * vocabulary, and each renderer implements it. Elements have a role:
 *
 * - `layout` arranges: containers (`stack`, `row`, `columns`, `collapsible`, `scroll`, `tabs`), prose
 *   (`text`, `divider`), and placement (`field`, `group`, `rest`).
 * - `part` draws one piece of a field: `label`, `help`, `errors`, or `control` (its default
 *   control).
 * - `control` edits a field's value: `input`, `slider`, `select`, … Each lists the kinds it
 *   can edit.
 *
 * A renderer that lacks an element falls back (a container to `stack`, a control to the
 * kind's default), so no field is ever lost.
 */
import type { PropInfo } from './kinds.ts';

export type ElementRole = 'layout' | 'part' | 'control';

export interface ElementDef<Name extends string = string> {
  readonly name: Name;
  readonly role: ElementRole;
  readonly description: string;
  readonly props?: { readonly [prop: string]: PropInfo };
  /** Whether it takes children. Containers without children are filled with what is in scope. */
  readonly children?: boolean;
  /** For controls: the kinds it can edit. Kinds refining one of these qualify too. */
  readonly kinds?: readonly string[];
}

export function defineElement<const Name extends string>(def: ElementDef<Name>): ElementDef<Name> {
  return def;
}

const text = (description: string): PropInfo => ({ schema: { $ref: '#/$defs/text' }, description });
const title = { title: text("A heading; a group's label fills it."), description: text('A line under the heading.') };
const fieldRef: PropInfo = {
  schema: { type: 'string' },
  description: "A field in scope, by key or relative pointer (`address/city`). Inside a field's own render: leave out.",
};
const placeholder: PropInfo = { schema: { $ref: '#/$defs/text' }, description: 'Shown while empty.' };

export const LAYOUT_ELEMENTS = [
  defineElement({
    name: 'stack',
    role: 'layout',
    description: 'Children one under another. With a title, a framed block.',
    props: title,
    children: true,
  }),
  defineElement({
    name: 'row',
    role: 'layout',
    description: 'Children side by side, sharing the width; wraps when narrow.',
    props: { ...title, gap: { schema: { enum: ['none', 'sm', 'md', 'lg'] }, description: 'Space between.' } },
    children: true,
  }),
  defineElement({
    name: 'columns',
    role: 'layout',
    description: 'Children in a grid of equal columns.',
    props: { ...title, count: { schema: { type: 'integer', minimum: 1, maximum: 6 }, description: 'How many columns. Default 2.' } },
    children: true,
  }),
  defineElement({
    name: 'collapsible',
    role: 'layout',
    description: 'A titled block that opens and closes.',
    props: { ...title, collapsed: { schema: { type: 'boolean' }, description: 'Starts closed.' } },
    children: true,
  }),
  defineElement({
    name: 'scroll',
    role: 'layout',
    description: 'Children in a box no taller than maxHeight; past it, the box scrolls.',
    props: {
      ...title,
      maxHeight: {
        schema: {
          anyOf: [
            { type: 'number', exclusiveMinimum: 0 },
            { type: 'string', pattern: String.raw`^\d+(\.\d+)?(px|rem|em|vh|%)$` },
          ],
        },
        description: 'The tallest it grows: pixels, or a CSS length (`20rem`, `50vh`). Default `20rem`.',
      },
    },
    children: true,
  }),
  defineElement({ name: 'tabs', role: 'layout', description: 'Each child is a tab, named by its title.', props: title, children: true }),
  defineElement({
    name: 'text',
    role: 'layout',
    description: 'A line of prose.',
    props: { text: text('What it says.'), tone: { schema: { enum: ['default', 'muted', 'warning'] }, description: 'Emphasis.' } },
  }),
  defineElement({ name: 'divider', role: 'layout', description: 'A rule between blocks.' }),
  defineElement({
    name: 'field',
    role: 'layout',
    description: 'A whole field: label, control, help and errors.',
    props: { field: fieldRef },
  }),
  defineElement({
    name: 'group',
    role: 'layout',
    description: 'A whole group from this scope.',
    props: { group: { schema: { type: 'string' }, description: "The group's id." } },
  }),
  defineElement({ name: 'rest', role: 'layout', description: 'Every field and group of this scope not placed elsewhere, in order.' }),
] as const;

export const PART_ELEMENTS = [
  defineElement({
    name: 'label',
    role: 'part',
    description: "A field's label, or any `text` as a label.",
    props: { field: fieldRef, text: text("Shown instead of the field's label.") },
  }),
  defineElement({ name: 'help', role: 'part', description: "A field's description and hint.", props: { field: fieldRef } }),
  defineElement({
    name: 'errors',
    role: 'part',
    description: 'The errors of one field, or of several.',
    props: { field: fieldRef, fields: { schema: { type: 'array', items: { type: 'string' } }, description: 'Several fields at once.' } },
  }),
  defineElement({
    name: 'control',
    role: 'part',
    description: "A field's control, whichever it is.",
    props: { field: fieldRef, placeholder },
  }),
] as const;

export const CONTROL_ELEMENTS = [
  defineElement({
    name: 'input',
    role: 'control',
    description: 'A one-line text box.',
    props: { field: fieldRef, placeholder, secret: { schema: { type: 'boolean' }, description: 'Masks what is typed.' } },
    kinds: ['string', 'number', 'int', 'bigint', 'url', 'regexp', 'json'],
  }),
  defineElement({
    name: 'textarea',
    role: 'control',
    description: 'A multi-line text box.',
    props: { field: fieldRef, placeholder, rows: { schema: { type: 'integer', minimum: 1 }, description: 'Visible lines.' } },
    kinds: ['string', 'json'],
  }),
  defineElement({
    name: 'autocomplete',
    role: 'control',
    description: "A text box offering the field's suggestions as it is typed; any other value is allowed too.",
    props: { field: fieldRef, placeholder },
    kinds: ['string'],
  }),
  defineElement({ name: 'select', role: 'control', description: 'A drop-down of options.', props: { field: fieldRef }, kinds: ['enum'] }),
  defineElement({ name: 'radio', role: 'control', description: 'Options as radio buttons.', props: { field: fieldRef }, kinds: ['enum'] }),
  defineElement({
    name: 'segmented',
    role: 'control',
    description: 'Options as a row of toggle buttons.',
    props: { field: fieldRef },
    kinds: ['enum'],
  }),
  defineElement({ name: 'checkbox', role: 'control', description: 'A check box.', props: { field: fieldRef }, kinds: ['boolean'] }),
  defineElement({ name: 'switch', role: 'control', description: 'An on/off switch.', props: { field: fieldRef }, kinds: ['boolean'] }),
  defineElement({
    name: 'slider',
    role: 'control',
    description: 'A slider between min and max.',
    props: {
      field: fieldRef,
      format: { schema: { enum: ['number', 'percent'] }, description: 'How the value is shown beside it.' },
    },
    kinds: ['number', 'int'],
  }),
  defineElement({ name: 'date', role: 'control', description: 'A date (and time) picker.', props: { field: fieldRef }, kinds: ['date'] }),
  defineElement({
    name: 'color',
    role: 'control',
    description: 'A colour picker.',
    props: { field: fieldRef, swatches: { schema: { type: 'array', items: { type: 'string' } }, description: 'Colours worth one click.' } },
    kinds: ['string'],
  }),
  defineElement({ name: 'file', role: 'control', description: 'A file picker.', props: { field: fieldRef }, kinds: ['bytes'] }),
  defineElement({
    name: 'checks',
    role: 'control',
    description: 'A check box per option of a set of an enum.',
    props: { field: fieldRef },
    kinds: ['set'],
  }),
  defineElement({
    name: 'list',
    role: 'control',
    description: 'Items one under another, added, removed and reordered.',
    props: { field: fieldRef, addLabel: text("The add button's label.") },
    kinds: ['array', 'set'],
  }),
  defineElement({
    name: 'accordion',
    role: 'control',
    description: 'Items as sections that open and close, each headed by its name (see namedBy), added, removed and reordered.',
    props: {
      field: fieldRef,
      addLabel: text("The add button's label."),
      open: { schema: { enum: ['none', 'first', 'all'] }, description: 'Which sections start open. Default none.' },
    },
    kinds: ['array', 'record', 'map'],
  }),
  defineElement({
    name: 'entries',
    role: 'control',
    description: 'Key and value pairs.',
    props: { field: fieldRef },
    kinds: ['record', 'map'],
  }),
  defineElement({
    name: 'variant',
    role: 'control',
    description: 'A choice of variant, then its fields.',
    props: { field: fieldRef },
    kinds: ['variant'],
  }),
  defineElement({
    name: 'fields',
    role: 'control',
    description: "An object's fields, arranged by its render.",
    props: { field: fieldRef },
    kinds: ['object'],
  }),
] as const;

export const CORE_ELEMENTS = [...LAYOUT_ELEMENTS, ...PART_ELEMENTS, ...CONTROL_ELEMENTS] as const;

/** The names of the parts, which bind to the field a fragment is on. */
export const PARTS: ReadonlySet<string> = new Set(PART_ELEMENTS.map((e) => e.name));
