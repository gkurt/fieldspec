# fieldspec

A typed, serializable, headless format for configs and the forms that edit them.

One JSON document says what the values are (kinds, constraints, defaults, conditions) and,
optionally, how a form for them is drawn. TypeScript infers the value type from it, agents
can write it from a generated prompt and meta-schema, and it converts to and from JSON Schema,
Zod, Standard Schema and json-render.

```ts
import { define, parse, type Infer } from 'fieldspec';

const account = define({
  fields: {
    firstName: { type: 'string', group: 'name' },
    lastName: { type: 'string', group: 'name' },
    email: { use: 'email', required: true },
    plan: { type: 'enum', options: ['free', 'pro'], default: 'free', render: 'segmented' },
    discount: { use: 'percent', visible: { $state: 'plan', eq: 'pro' } },
  },
  groups: { name: { label: 'Name', render: 'row' } },
});

type Account = Infer<typeof account>; // { firstName: string; …; plan: "free" | "pro"; discount: number }
const result = parse(account, json); // { ok, value, issues: [{ path: "/email", code, message }] }
```

New to the format? [The tutorial](https://gkurt.com/fieldspec/tutorial.html) grows one spec a
feature at a time, with a live form at every step.

## Install

```bash
npm install fieldspec
```

ES modules only, with types; from CommonJS, use `import()`. `fieldspec/react` needs `react` 19
or later and `fieldspec/zod` needs `zod` 4. Both are optional peer dependencies, so the core
needs neither.

## Names

Everything a spec refers to by name (kinds, elements, presets, definitions) follows one rule:
**built-in names are lowercase, names you define are capitalized.**

|             | Built-in                          | Yours              |
| ----------- | --------------------------------- | ------------------ |
| Kinds       | `string`, `enum`, `variant`, …    | `Gradient`         |
| Elements    | `row`, `collapsible`, `slider`, … | `GradientPicker`   |
| Presets     | `percent`, `email`, `password`, … | `Swatch`           |
| Definitions |                                   | `Address`, `Entry` |

So a built-in added later never collides with yours, and a spec's capitalized names are exactly
what it needs beyond the library. A namespace prefix works too: `Acme.Money`. `createRegistry`
rejects lowercase names; the checker rejects lowercase definitions and warns on names that
differ from a built-in only by case.

## Fields

- A field has a `type` (a kind), or a `use` (see Presets), plus what every field may say:
  `label`, `description`, `hint`, `placeholder`, `examples`, `aliases`, `deprecated`, `default`,
  `optional`, `readOnly`, `visible`, `enabled`, `required`, `group`, `order`, `render`, `meta`.
- **Order**: fields draw in the order they are declared. `order` moves one: lower draws first,
  a field without it counts as 0, and equal ones keep their declared order, so `order: -1` puts
  a field at the top and `order: 1` at the bottom. It moves the field, not its value, and a group
  draws where its first field does. (JavaScript puts keys like `"2"` before all others, whatever
  order you write them in; `order` puts them back.)
- **Kinds**: `string`, `number`, `int`, `boolean`, `enum`, `date`, `bigint`, `url`, `regexp`,
  `bytes`, `json`, and the containers `array`, `set`, `record`, `map`, `object`, `variant`
  (a discriminated union). Values are real JS values (`Date`, `bigint`, `URL`, `Map`, `Set`,
  `Uint8Array`); `encode`/`decode` move them to and from JSON.
- **Conditions** use json-render's grammar: `{ "$state": "/plan", "eq": "pro" }`, arrays for
  all, `$or`/`$and`, `not`, plus `in`.
- **Pointers**: `/a/b` is absolute. Without the slash a pointer is relative to the enclosing
  object (`"plan"` is a sibling), and each leading `../` climbs one level (an array index
  counts as one). `$item`/`$index` read the current array item.
- **Expressions** (`$state`, `$template`, `$cond`, `$computed`) work in defaults, labels,
  options and element props. `$computed` names a function from a table passed at runtime, so
  the spec stays JSON; `define(spec, { fns })` checks every name is implemented.
- **Groups** gather fields for display without changing the value's shape.
- **Naming items**: a list's, record's or map's items are called by their position (`#2`) or
  key, unless `namedBy` says otherwise: a pointer into the item (`"name"`, `"contact/name"`, or
  `""` for the item itself), or a text expression in the item's scope
  (`{ "$template": "${first} ${last}" }`). The name is the item's label (an accordion's section
  heading, say), and an empty one falls back to the position or key. The checker knows the
  item's fields, with a "did you mean".
- **Suggestions**: a string's `suggestions` are values offered as it is typed, any other still
  allowed: a list of strings, or an expression giving one (`{ "$state": "/roles" }` offers what
  another list holds). A string with suggestions draws as an `autocomplete`.

## Presets and definitions: `use`

A field can build on a named declaration instead of giving a `type`. Its own properties
override the base's:

```json
{ "use": "percent", "label": "Opacity", "step": 0.01 }
```

`percent` is `{ "type": "number", "min": 0, "max": 1, "step": 0.05, "render": { "type": "slider", "props": { "format": "percent" } } }`.
The built-in presets are `percent`, `email`, `password`, `multiline`, `port` and `color`. A
registry adds its own with `createRegistry({ presets: { Money: … } })`.

A spec's own `defs` work the same way, which is also how it reuses and recurses:

```json
{
  "defs": {
    "Entry": {
      "type": "object",
      "fields": {
        "label": { "type": "string" },
        "newTab": { "type": "boolean", "visible": { "$state": "../../allowNewTabs", "eq": true } },
        "allowNewTabs": { "type": "boolean" },
        "children": { "type": "array", "items": { "use": "Entry" } }
      }
    }
  },
  "fields": { "menu": { "use": "Entry", "label": "Navigation" } }
}
```

Lowercase names look up built-in presets; capitalized ones look up `defs`, then the registry's
presets. A definition may use itself through an array, set, record, map or optional field;
the checker rejects one whose value could never end, and warns of definitions whose smallest
value is huge because they use one another several times over (each use repeats its definition
whole, so two uses per step double it). `Infer` follows `use`, recursively.

## Rendering: `render`

`render` is one grammar everywhere: an element name, or an element object as in json-render.

```json
"render": "row"
"render": { "type": "collapsible", "props": { "collapsed": true } }
```

What it means depends on where it sits:

| On               | A control element (`slider`) | A layout element (`row`, `collapsible`, …)                                     |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| a field          | picks the field's control    | arranges the field's parts: `label`, `control`, `help`, `errors`, or a control |
| an object field  |                              | arranges the object's fields                                                   |
| a group          |                              | is the group's container; the group's label fills `title`                      |
| `layouts.<name>` |                              | arranges the whole form                                                        |

A container without `children` is filled with what is in scope. With children,
`{ "field": "x" }` and `{ "group": "id" }` place things, and what they leave follows them or
goes where they put `rest`. The checker knows every element's props and which kinds each
control edits, so `"render": "slider"` on a string, or `"collapsed": "yes"`, is a fault.

**The catalog.** Layout: `stack`, `row`, `columns`, `collapsible`, `scroll`, `tabs`, `text`, `divider`,
`field`, `group`, `rest`. Parts: `label`, `help`, `errors`, `control`. Controls: `input`,
`textarea`, `autocomplete`, `select`, `radio`, `segmented`, `checkbox`, `switch`, `slider`, `date`, `color`,
`file`, `checks`, `list`, `accordion`, `entries`, `variant`, `fields`. Every kind names its default control.

`accordion` draws a list's, record's or map's items as sections that open and close, each headed
by its name (see `namedBy`); its `open` prop says which start open (`"none"`, `"first"`, `"all"`):

```json
"speakers": { "type": "array", "namedBy": "name", "render": { "type": "accordion", "props": { "open": "first" } }, "items": { … } }
```

`scroll` keeps its children in a box no taller than `maxHeight` (pixels or a CSS length such as
`"18rem"`; default `20rem`) and scrolls past it:

```json
"groups": { "delivery": { "label": "Delivery", "render": { "type": "scroll", "props": { "maxHeight": "18rem" } } } }
```

`fieldspec/react` draws it, but not its look: `FormView` walks the layout tree and asks the
renderers you give it to draw each element. fieldspec decides what a form holds and does; how it
looks is yours. [examples/renderers](examples/renderers) has three sets to copy and make your
own: plain HTML (`html.tsx`, with `htmlStyles`), [DialKit](https://github.com/joshpuckett/dialkit)'s
controls (`dialkit.tsx`) and [React Aria Components](https://react-spectrum.adobe.com/react-aria/)
(`react-aria.tsx`, accessible and unstyled, laid over the HTML set). The website draws every form
with them.

```tsx
import { FormView, useForm } from "fieldspec/react";
import { htmlRenderers, htmlStyles } from "./renderers/html"; // copied from examples/renderers

<style>{htmlStyles}</style>
<FormView form={useForm(spec)} renderers={htmlRenderers} />
```

Read the form in your own components with `useFormState(form)` (its `values`, `issues` and
`json`, a new object on every change) or `useField(form, path)`. The form object itself stays
the same as it changes, so a component that reads it directly misses updates under a memoizing
compiler such as the React Compiler.

A renderer table is keyed by element name; `defineRenderers({ input: MyInput })` types each
built-in element's renderer by its role, and tables layer by spreading
(`{ ...htmlRenderers, ...defineRenderers({ input: MyInput }) }`). Each renderer gets its role's
props: `ControlProps` (the field, `set`, `touch`, `disabled`, `id`), `FieldProps` (the field
and its `control()`), `LayoutProps` (`children`) or `PartProps`. For your own elements, say
which, as in `function GradientPicker(p: ControlProps)`. A control with no renderer falls back
to its kind's default control, then `input`; a layout element to `stack`, then its bare
children; a field with no `field` renderer is its bare control; a part with none is not drawn.

Renderers can also be a function, called for each element about to be drawn with what it is
(`element`, `role`, its `node` and `field`, and `explicit`: whether the spec names the
control or leaves it to the kind) and `next`, the renderer the table beneath would use. It
picks by anything, not only the element's name, and decides itself whether the spec's choice
stands:

```tsx
const renderers: ResolveRenderer = (want, next) => {
  if (want.role === 'control' && want.field?.decl.format === 'email') return EmailInput; // every email
  if (want.element === 'select' && !want.explicit) return Chips; // where the spec left it to the kind
  return next();
};
<FormView form={form} renderers={extendRenderers(htmlRenderers, renderers)} />;
```

Return renderers made once, at module level: one made inside the function is a new component
each time, and React remounts the control, losing its focus and what is being typed.

What controls do comes with `fieldspec/react`, so a renderer set only draws:

- `listOf(props)`: a list's items (each with its `label`, from `namedBy`, and its `render()`), `add`,
  `remove`, `move`, `canAdd`.
- `entriesOf(props)`: a record's or map's entries (each with its key and its `namedBy` name); `add(typedKey)` and `rename(key, typed)`
  return why a key is refused (taken, or unreadable as the map's key kind), and a rename keeps
  the entry's value and position.
- `objectOf(props)`: whether an object is there, `add`, `remove`, `render()`. Offer an absent one
  (an optional one, say) rather than drawing it, so a definition that may contain itself draws
  only as deep as its values go.
- `variantOf(props)`: the current variant, the options, `choose`, `render()`.
- `choicesOf(props)`: an enum's options and the chosen one, by position; `checksOf(props)`: a
  set of enum values as checkboxes.
- `useParsedText(props, parserFor(form.registry, kind))`: a text control's typing rules: what is
  typed stays until it parses, and a value set from elsewhere replaces it.

## Extending

A registry is the vocabulary specs are written in: kinds (what `type` names), elements (what
`render` names), presets and lint rules. `define` uses the core registry; `createRegistry` adds
yours to it, and a spec defined through it (`design.define(spec)`) is checked, parsed, converted,
described to agents and drawn with exactly that vocabulary.

```ts
const Gradient = defineKind<GradientValue>()({ name: "Gradient", control: "GradientPicker", check, … });
const GradientPicker = defineElement({ name: "GradientPicker", role: "control", kinds: ["Gradient"], … });
const design = createRegistry({
  kinds: [Gradient],
  elements: [GradientPicker],
  presets: { Swatch: { use: "color", render: { type: "color", props: { swatches: ["#3b82f6"] } } } },
  rules: [compactPanel()],
});
```

[examples/design.ts](examples/design.ts) has the whole of it.

## Editing many at once: `commonFields`

When several things are selected (canvas nodes, rows, files), one form edits what they share:

```ts
const common = commonFields([textNode, shapeNode], { values: [title, card] });
const form = createForm(common.spec, { values: common.values, mixed: common.mixed });
// … the user edits …
const [newTitle, newCard] = common.apply(form.values);
```

- `common.spec` has the fields every spec has, each declared so that a value valid for it is
  valid for all of them: bounds tightened, enum options and URL protocols intersected, string
  patterns combined, an `int` and a `number` give an `int`. Objects and variants are merged
  field by field; a list, set, record or map must match whole. Labels come from the first spec,
  and conditions and defaults are kept only where the specs agree and what they read is still
  there. A definition the specs share stays a `use` of it.
- `common.dropped` lists what was left out, and why: `{ path: "/corner", reason: "is not in spec 0" }`,
  `"has no option every spec allows"`, `"is an enum in spec 0 but a string in spec 1"`.
- `common.values` are the first spec's values, and `common.mixed` the pointers where the specs'
  values differ. A form marks those fields `mixed` until they are edited; the example renderers
  show "Mixed", and checkboxes and switches are indeterminate.
- `common.apply(edited)` writes only what changed, to every spec that has the field, so what
  each one has of its own is kept. An edit inside a variant reaches only the values that are
  that variant; choosing a variant sets it everywhere.
- `match: "some"` keeps fields only some specs have; `common.sources` says which, and edits
  reach only those.

## The JSON Schema of specs

`schema/spec.json` is the JSON Schema of the spec format, generated from the core registry's
kinds, elements and presets (`bun run schema`; a test fails when it is stale) and shipped with
the package. It is versioned like the package and served at
`https://unpkg.com/fieldspec@<version>/schema/spec.json` (`SCHEMA_URL`), so a spec can name it:

```json
{ "$schema": "https://unpkg.com/fieldspec@0.1.0/schema/spec.json", "fields": { … } }
```

Editors then validate and complete the spec, and the checker warns when a spec names another
version. The published schema accepts any capitalized kind or element, so specs of extended
registries validate too; `metaSchema(registry)` gives a registry's own, closed schema, naming exactly
its kinds, elements and presets, for structured outputs. The schema checks shape; `checkSpec`
checks meaning (references, conditions, defaults).

## Interop and agents

- `checkSpec(spec)`: every fault, at a pointer into the spec, phrased as the fix, with "did you mean".
- `toJSONSchema` / `fromJSONSchema`: draft 2020-12. `defs` become `$defs`, a use of one
  becomes `$ref`, a preset is written out; `x-` keywords keep what JSON Schema cannot say.
- Defined specs carry `~standard` (Standard Schema, with the JSON Schema extension).
- `fieldspec/zod`: `toZod(spec)` (refined with the spec's own validation), `fromZod(schema)`.
- `toFlat` / `fromFlat`: json-render's flat element format.
- `toJsonRender(spec, { values })`: the whole form as a json-render spec, bound to its state and
  drawn with `@json-render/shadcn`'s components (rename them with `components`). Lists, sets,
  records and maps repeat over state with add and remove buttons; a definition that contains
  itself is drawn `depth` levels deep (default 3), and the output stops at `maxElements`
  (default 20 000), past which fields are left out with a note. It is tested against json-render itself: its
  spec validator, the shadcn components' props, and its React renderer in a DOM.
  json-render's state holds JSON, except records and maps are lists of `{ key, value }`, enum
  values are strings, a set edited with `checks` is a comma-separated string, and a `json` field
  is text: `toJsonRenderState` / `fromJsonRenderState` convert (a collection holding a value of
  the wrong shape becomes an empty list, which json-render can repeat over). A list inside a list item
  removes its items with the `removeItem` action: declare `JSON_RENDER_ACTIONS` in your catalog
  and pass `jsonRenderActions(store)` as handlers. A `scroll` box is a `Stack` with Tailwind
  classes (`overflow-y-auto max-h-[18rem]`), so Tailwind must see the class.
- `prompt(registry)` and `metaSchema(registry)`: a system prompt and a JSON Schema for structured
  outputs, both generated from the registry's kinds, elements and presets. The prompt tells
  agents to start specs with `$schema`.

## Status

Experimental. Not yet:

- Sandboxed code for conditions (named functions only).
- In json-render output: enum labels in `select` and `radio` (shadcn's take plain strings;
  `segmented` keeps them), and conditions that read an outer list's item from inside an inner
  list's (json-render reads only the innermost item).
- Fields whose value is always derived. Expression defaults fill absent values only.

```bash
bun install
bun test
bun run stress      # the stress cases and 1000 random specs, each run with a time limit
bun run typecheck
bun run build       # dist/: what the package ships (npm pack runs it too)
bun run schema
bun run demo
bun run site        # the homepage: every example on it is live
```

## Experiments with small models

`experiments/` tries two models that answer with typed values rather than text: Jev
(TypeSafe), which chooses, and Clairic (Cloudflare Workers AI), which reads values out of text.
Code proposes, the models decide, and the checker and `parse` have the last word. The homepage's
[models page](site/models.html) shows the recorded results.

```bash
bun experiments/jev-specs/generate.ts       # specs from descriptions, with Jev (TYPESAFE_API_KEY)
bun experiments/clairic-specs/hybrid.ts     # the same, with Clairic reading what the text states
bun experiments/fill/fill.ts                # filling forms from messages, scored field by field
bun experiments/delegate/delegate.ts        # handing what they cannot do to a writer model
```

Keys go in `.env.local` (ignored by git): `TYPESAFE_API_KEY` for Jev, and `ANTHROPIC_API_KEY`
for Claude Haiku 5.5 as the writer. Clairic and the fallback writer run through the `cf` CLI's
sign-in.
