# fieldspec

A typed, serializable, headless format for configs and the forms that edit them.

One JSON document says what the values are (kinds, constraints, defaults, conditions) and,
optionally, how a form for them is drawn. TypeScript infers the value type from it, agents
can write it from a generated prompt and meta-schema, and it converts to and from JSON Schema,
Zod, Standard Schema and json-render.

```ts
import { define, parse, type Infer } from "fieldspec";

const account = define({
  fields: {
    firstName: { type: "string", group: "name" },
    lastName: { type: "string", group: "name" },
    email: { use: "email", required: true },
    plan: { type: "enum", options: ["free", "pro"], default: "free", render: "segmented" },
    discount: { use: "percent", visible: { $state: "plan", eq: "pro" } },
  },
  groups: { name: { label: "Name", render: "row" } },
});

type Account = Infer<typeof account>; // { firstName: string; …; plan: "free" | "pro"; discount: number }
const result = parse(account, json);  // { ok, value, issues: [{ path: "/email", code, message }] }
```

## Names

Everything a spec refers to by name (kinds, elements, presets, definitions) follows one rule:
**built-in names are lowercase, names you define are capitalized.**

| | Built-in | Yours |
|---|---|---|
| Kinds | `string`, `enum`, `variant`, … | `Gradient` |
| Elements | `row`, `collapsible`, `slider`, … | `GradientPicker` |
| Presets | `percent`, `email`, `password`, … | `Swatch` |
| Definitions | | `Address`, `Entry` |

So a built-in added later never collides with yours, and a spec's capitalized names are exactly
what it needs beyond the library. A namespace prefix works too: `Acme.Money`. `createFormat`
rejects lowercase names; the checker rejects lowercase definitions and warns on names that
differ from a built-in only by case.

## Fields

- A field has a `type` (a kind), or a `use` (see Presets), plus what every field may say:
  `label`, `description`, `hint`, `placeholder`, `examples`, `aliases`, `deprecated`, `default`,
  `optional`, `readOnly`, `visible`, `enabled`, `required`, `group`, `render`, `meta`.
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

## Presets and definitions: `use`

A field can build on a named declaration instead of giving a `type`. Its own properties
override the base's:

```json
{ "use": "percent", "label": "Opacity", "step": 0.01 }
```

`percent` is `{ "type": "number", "min": 0, "max": 1, "step": 0.05, "render": { "type": "slider", "props": { "format": "percent" } } }`.
The built-in presets are `percent`, `email`, `password`, `multiline`, `port` and `color`. A
format adds its own with `createFormat({ presets: { Money: … } })`.

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

Lowercase names look up built-in presets; capitalized ones look up `defs`, then the format's
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

| On | A control element (`slider`) | A layout element (`row`, `collapsible`, …) |
|---|---|---|
| a field | picks the field's control | arranges the field's parts: `label`, `control`, `help`, `errors`, or a control |
| an object field | | arranges the object's fields |
| a group | | is the group's container; the group's label fills `title` |
| `layouts.<name>` | | arranges the whole form |

A container without `children` is filled with what is in scope. With children,
`{ "field": "x" }` and `{ "group": "id" }` place things, and what they leave follows them or
goes where they put `rest`. The checker knows every element's props and which kinds each
control edits, so `"render": "slider"` on a string, or `"collapsed": "yes"`, is a fault.

**The catalog.** Layout: `stack`, `row`, `columns`, `collapsible`, `scroll`, `tabs`, `text`, `divider`,
`field`, `group`, `rest`. Parts: `label`, `help`, `errors`, `control`. Controls: `input`,
`textarea`, `select`, `radio`, `segmented`, `checkbox`, `switch`, `slider`, `date`, `color`,
`file`, `checks`, `list`, `entries`, `variant`, `fields`. Every kind names its default control.

`scroll` keeps its children in a box no taller than `maxHeight` (pixels or a CSS length such as
`"18rem"`; default `20rem`) and scrolls past it:

```json
"groups": { "delivery": { "label": "Delivery", "render": { "type": "scroll", "props": { "maxHeight": "18rem" } } } }
```

`fieldspec/react` draws it with one renderer table keyed by element name: `FormView`,
`useForm`, `useField`, and `defineRenderers(format, { GradientPicker })` to add or replace
any element. A control with no renderer falls back to its kind's default control. List items
reorder by dragging their handle (or with the arrow buttons), and a record's or map's keys are
edited in place: a rename keeps the entry's value and position, and a taken or unreadable key is
refused with the reason. An absent object (an optional one, say) shows an Add button rather
than its fields, and an optional one that is there can be removed, so a definition that may
contain itself draws only as deep as its values go.

## Extending

```ts
const Gradient = defineKind<GradientValue>()({ name: "Gradient", control: "GradientPicker", check, … });
const GradientPicker = defineElement({ name: "GradientPicker", role: "control", kinds: ["Gradient"], … });
const design = createFormat({
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
  values differ. A form marks those fields `mixed` until they are edited; the React controls
  show "Mixed", and checkboxes and switches are indeterminate.
- `common.apply(edited)` writes only what changed, to every spec that has the field, so what
  each one has of its own is kept. An edit inside a variant reaches only the values that are
  that variant; choosing a variant sets it everywhere.
- `match: "some"` keeps fields only some specs have; `common.sources` says which, and edits
  reach only those.

## The format's JSON Schema

`schema/spec.json` is the JSON Schema of the spec format, generated from the core format's
kinds, elements and presets (`bun run schema`; a test fails when it is stale) and shipped with
the package. It is versioned like the package and served at
`https://unpkg.com/fieldspec@<version>/schema/spec.json` (`SCHEMA_URL`), so a spec can name it:

```json
{ "$schema": "https://unpkg.com/fieldspec@0.1.0/schema/spec.json", "fields": { … } }
```

Editors then validate and complete the spec, and the checker warns when a spec names another
version. The published schema accepts any capitalized kind or element, so specs of extended
formats validate too; `metaSchema(format)` gives a format's own, closed schema, naming exactly
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
- `prompt(format)` and `metaSchema(format)`: a system prompt and a JSON Schema for structured
  outputs, both generated from the format's kinds, elements and presets. The prompt tells
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
bun run schema
bun run demo
bun run site        # the homepage: every example on it is live
```
