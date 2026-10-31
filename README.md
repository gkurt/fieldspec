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
or later, `fieldspec/zod` needs `zod` 4, `fieldspec/cel` needs `@marcbachmann/cel-js` 8 and
`fieldspec/js` needs `@gkurt/quickjs-wasi` 0.3. All are optional peer dependencies, so the core
needs none of them.

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
  `value`, `optional`, `readOnly`, `visible`, `enabled`, `required`, `checks`, `group`, `order`,
  `render`, `meta`.
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
- **Expressions** (`$state`, `$template`, `$cond`, `$computed`, `$cel`, `$js`) work in defaults,
  values, labels, options and element props. `$computed` names a function from a table passed at
  runtime, so the spec stays JSON; `define(spec, { fns })` checks every name is implemented.
  `$cel` and `$js` are code the spec carries itself (see Code).
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

## Derived values: `value`

`default` fills a value that is absent, and people may change it. `value` decides every value:
a total, a slug, a count, worked out from the others and worked out again as they change.

```json
"total": {
  "type": "number",
  "value": { "$cel": "price * double(qty)", "args": { "price": { "$state": "price" }, "qty": { "$state": "qty" } } }
}
```

- `parse` and `decode` replace a value given for the field, and a form recomputes it on every
  edit. Its field state is `readOnly`, so controls draw it disabled, and `form.set` on it is undone.
- Values may read values, in any order, and one that reads a list sees the values inside its items
  worked out first. A cycle leaves the fields in it at their zero.
- It is validated like any value: `"max": 100` on a total is a rule about the others.
- `encode` writes it, so stored JSON carries it for whoever reads it without fieldspec.
- A literal is a constant: `"value": "v2"`. The checker checks it against the kind, and warns of
  a `default` beside a `value`, which is never used.
- JSON Schema marks it `readOnly` and keeps the expression as `x-value`. Standard Schema runs
  `parse`, so it computes it; `toZod` validates the value it is given as it is.

## Checks: `checks`

A kind's constraints (`min`, `pattern`, `maxItems`, …) judge a value on its own. A field's
`checks` are the rest of what a value must keep, usually over other fields: each is a condition,
`assert`, that holds while the value is valid, and a `message` the field shows while it does not.

```json
"end": {
  "type": "date",
  "checks": [{ "assert": { "$state": "end", "gte": { "$state": "start" } }, "message": "Ends before it starts" }]
}
```

- A failing check is an issue at the field, `{ path: "/end", code: "check", message }`, from
  `parse`, `validate`, a form's field state and `toZod`. `code` gives it another code.
- The condition is evaluated where the field's `visible` is, so `"start"` is a sibling. On an
  array's object items, pointers are relative to the item.
- Checks run on a value that is present and otherwise valid: not on an absent optional value, a
  hidden field, or one that already fails its kind's constraints. Every failing check is
  reported, in order.
- `message` is text, so it may be an expression: `{ "$template": "At most ${seats} admins" }`.
- A definition's checks hold wherever it is used: a field's own `checks` add to its base's
  rather than replacing them.
- What a condition cannot say, `$cel` can (see Code): `{ "assert": { "$cel": "admins <= seats / 2", "args": { … } }, "message": "…" }`.
  A check that fails to run is a `condition` issue, with the engine's error.
- JSON Schema carries them as `x-checks`; the checker reports a check without `assert` or
  `message`, and warns of one whose `assert` is a constant.

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

A definition is also how a spec names a shape of text of its own:

```json
{
  "defs": { "Slug": { "type": "string", "pattern": "[a-z0-9]+(-[a-z0-9]+)*", "placeholder": "my-post" } },
  "fields": { "slug": { "use": "Slug" }, "short": { "use": "Slug", "maxLength": 20 } }
}
```

A value that does not match says "This isn't a valid slug", named after the definition or
preset the field uses, else its label or key; `patternMessage` says something else.

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
looks is yours. [examples/renderers](examples/renderers) has four sets to copy and make your
own: plain HTML (`html.tsx`, with `htmlStyles`), [DialKit](https://github.com/joshpuckett/dialkit)'s
controls (`dialkit.tsx`), [React Aria Components](https://react-spectrum.adobe.com/react-aria/)
(`react-aria.tsx`, accessible and unstyled, laid over the HTML set) and
[shadcn/ui](https://ui.shadcn.com) (`shadcn.tsx`, styled by Tailwind and your shadcn theme). The
website draws every form with them.

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

## Code: `$cel` and `$js`

For what the expressions above cannot say, a spec can carry code: an expression in
[CEL](https://cel.dev) (`$cel`) or in JavaScript (`$js`), whose `args` are its variables:

```json
"checkOut": {
  "type": "date",
  "default": { "$cel": "checkIn + duration(string(nights * 24) + \"h\")", "args": { "checkIn": { "$state": "checkIn" }, "nights": { "$state": "nights" } } }
},
"lateNote": { "type": "string", "visible": { "$cel": "checkOut.getDayOfWeek(\"UTC\") == 0", "args": { "checkOut": { "$state": "checkOut" } } } }
```

Code goes wherever an expression does, and is the value a condition tests (compared with `eq`,
`gt`, … or for truthiness), a check's `assert` included. It reads only its `args`, so the checker, `commonFields` and the
rest still see what a spec depends on.

The core runs neither. A registry takes a language for each, from an entry point of its own, so
an application carries only the engine it uses:

```ts
import { createRegistry } from "fieldspec";
import { createCel } from "fieldspec/cel";

const app = createRegistry({ languages: [createCel()] });
const spec = app.define({ … });
```

A registry with no engine for `$cel` or `$js` rejects specs that use it, and its `prompt` and
closed `metaSchema` do not mention it, so agents write only what runs. The published schema
accepts both, as it accepts any registry's kinds.

### CEL, the one to use: `fieldspec/cel`

CEL is the Common Expression Language that Kubernetes, Envoy and Firebase write rules in. It
cannot loop forever or reach outside its arguments, so it needs no sandbox: `fieldspec/cel`
runs it in plain JavaScript with [`@marcbachmann/cel-js`](https://github.com/marcbachmann/cel-js),
about 25 KB gzipped, synchronously and in microseconds.

- An arg that reads a field (`{ "$state": … }`) has that field's type. An `int` or `bigint` is a
  CEL int and a `number` a double, and CEL does no arithmetic across the two: `count + 1`,
  `price * 1.5`, and `double(count)` or `int(price)` to mix them. Comparisons mix them freely
  (`price > 2`). A `date` is a timestamp (`end - start >= duration("24h")`), a list or set of
  strings a `list<string>`, a record of ints a `map<string, int>`, and so on.
- An optional field may be absent, so its arg is `null` or the value, of any type (`dyn`), as is
  an arg that is not a plain `$state`, or one in a migration, which reads untyped JSON. An
  untyped whole number works as an int or a double, as the expression needs (`timeout * 1000`).
  Ints inside an object still arrive as ints.
- A URL or a regular expression arrives as its text. Whole results come back as numbers, so they
  fill `number` and `int` fields.
- `checkSpec` type-checks each expression against its args: a syntax error, a variable that is
  not an arg, or `price + 1` on a `number` is reported at its spot. Inside a definition, a
  relative pointer could read anything, so its arg is checked as `dyn`.
- `createCel({ environment })` starts from a cel-js `Environment` with functions of your own.

### JavaScript: `fieldspec/js`

For what CEL cannot say, `fieldspec/js` runs JavaScript in [QuickJS](https://github.com/gkurt/quickjs)
compiled to WebAssembly (`@gkurt/quickjs-wasi`). It is heavier, about 400 KB gzipped, so load it
where a spec needs it. Dates, bigints, maps, sets, bytes and regular expressions arrive as
themselves; a URL as its text. Compile the engine once, then give the language to a registry:

```ts
import { createRegistry } from "fieldspec";
import { loadJs } from "fieldspec/js";
import wasmUrl from "@gkurt/quickjs-wasi/quickjs.wasm?url"; // Vite; in Node or Bun, pass the file's bytes

const app = createRegistry({ languages: [await loadJs(fetch(wasmUrl))] });
const spec = app.define({ … });
```

`loadJs` takes the engine compiled, as bytes, or as a response; `createJs(module)` does the same
synchronously from a compiled module. Code then runs synchronously, in one VM per language:

- Each run has a time limit (`timeout`, default 50 ms), and the VM a memory limit
  (`memoryLimit`, 16 MiB) and a stack limit (`maxStackSize`, 256 KiB). Code that passes one
  fails like any other: a condition reports an issue, and a form treats it as holding.
- The VM's globals are frozen, so one expression cannot change what another sees. It has no
  I/O: no network, files or timers.
- Each piece of code is compiled once and kept. `checkSpec` compiles without running it, and
  reports a syntax error at its spot.
- Specs from sources that must not reach each other's code belong in registries with languages
  of their own.

## Translations: `locales`

A spec is written in one language and may carry others. `locales` holds, for each locale tag, a
table from a JSON Pointer into the spec to the text in its place:

```json
"locales": {
  "de": {
    "/fields/name/label": "Dienstname",
    "/fields/region/options/0/label": "Europa",
    "/fields/domain/label/$else/$template": "Domain für ${/name}",
    "/fields/end/checks/0/message": "Endet vor dem Beginn",
    "/layouts/tabs/children/0/props/title": "Dienst"
  }
}
```

- A pointer leads to a text the spec shows (a label, description, hint, placeholder,
  `patternMessage`, an option's or a variant's label, a group's label, a check's message, an
  element's text prop such as `title`), or to a string inside one: a template's
  (`…/$template`) or a `$cond` branch (`…/$then`). Text that is code (`$cel`, `$computed`) is
  replaced whole.
- A text the spec only implies may be given too: the label made from a field's key, a plain
  option's label (the option becomes `{ value, label }`), a preset's placeholder. A definition's
  text is translated once, at `/defs/<Name>/…`.
- `texts(spec)` lists every string there is to translate, by pointer, implied ones included:
  what goes to a translator, or a model.
- `localize(spec, "de")` is the spec with that locale's text laid over it, keeping its registry,
  functions and type. `"de-AT"` falls back to `"de"`. It also takes tables of your own, and a
  list, the first that translates a text winning: `localize(spec, [overrides, "de"])`.
- `createForm(spec, { locale: "de" })` (and `useForm`) shows the form in that locale, and keeps
  `form.locale` for renderers: their own words ("Add", "Remove") and number and date formats are
  theirs.
- `checkSpec` checks a spec's `locales`: a pointer that leads to no text (with "did you mean"),
  a value that is not text, and a translated template that reads values the original does not.
  It warns of the texts a locale leaves as written. `checkTranslations(spec, table)` checks a
  table of your own the same way.

The library's own issue messages ("is required", "must be at least 1") are English. Each
carries `params`, what it is about (`{ code: "min", params: { min: 1 } }`), and `messages`, on
`parse`, `validate`, `createForm` and `toZod`, says them another way:

```ts
const german: Messages = ({ code, params }) => (code === 'min' ? `Mindestens ${params.min}` : undefined);
parse(spec, json, { messages: german });
```

It is asked only for issues with `params`. Messages the spec writes, a check's or
`patternMessage`, have none: they translate with the spec.

## Versions and migrations

Values outlive the spec they were written for. Many changes need nothing: a new field takes its
`default`, and a renamed key can keep reading its old name through `aliases`. For the rest, a
spec says which `version` of its values it describes, and `migrations` bring values written for
an earlier version forward, keyed by the version each list of operations reaches:

```json
{
  "version": 3,
  "fields": { … },
  "migrations": {
    "2": [
      { "op": "move", "from": "/host", "path": "/server/host" },
      { "op": "move", "from": "/backends/*/address", "path": "/backends/*/url" }
    ],
    "3": [
      { "op": "move", "from": "/timeout", "path": "/timeoutMs" },
      { "op": "replace", "path": "/timeoutMs", "value": { "$cel": "timeoutMs * 1000.0", "args": { "timeoutMs": { "$state": "timeoutMs" } } } },
      { "op": "replace", "path": "/mode", "value": { "$cond": { "$state": "mode", "eq": "fast" }, "$then": "quick", "$else": "thorough" } },
      { "op": "add", "path": "/backends/*/weight", "value": 1 },
      { "op": "remove", "path": "/legacy" }
    ]
  }
}
```

- Each operation is JSON Patch (`add`, `replace`, `remove`, `move`, `copy`) over the values as
  stored, before decoding. In a pointer, `*` stands for every item or key at its level, and a
  target's `*`s take what its source's stood for, in order.
- `value` may be an expression, evaluated where the value goes: `{ "$state": "timeout" }` is a
  sibling. It reads the stored JSON, so a `$cel` arg has no field type: a number is a CEL double
  (`* 1000.0`). A value that cannot be worked out keeps its old one, and `parse` reports a
  `migration` issue there.
- What an operation does not find, it leaves be: an absent optional value, a list with no
  items. `replace` changes only what is there; `add` and a move's target make missing objects.
- `encode` writes `"$version": 3` first, and `decode` (so `parse` and `createForm`) migrates
  values that say an earlier one. Values that do not say are taken as current; `from` gives
  their version: `parse(spec, json, { from: 1 })`, `createForm(spec, { values, from: 1 })`.
  `migrate(spec, json)` does only the migrating, JSON to JSON.
- `parse` reports a `$version` later than the spec's, or one that is not a version.
- `checkSpec` checks `version` and `migrations`: each operation's shape and pointers, a
  migration keyed past the spec's version, `*`s that do not pair up, and expressions (whose
  pointers it cannot check, since they read an earlier shape). In the last migration, a target
  that is no field of the spec is a warning.
- In JSON Schema, `$version` is a property (`const` on output, an integer up to the version on
  input), and `version` and `migrations` ride along as `x-version` and `x-migrations`.

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
  becomes `$ref` with the field's added constraints beside it (or is written out when it changes
  one the definition has), a preset is written out; `x-` keywords keep what JSON Schema cannot say.
- Defined specs carry `~standard` (Standard Schema, with the JSON Schema extension).
- `fieldspec/zod`: `toZod(spec)` (refined with the spec's own validation, its messages said by
  `messages`), `fromZod(schema)`.
- `toFlat` / `fromFlat`: json-render's flat element format.
- `toJsonRender(spec, { values })`: the whole form as a json-render spec, bound to its state and
  drawn with `@json-render/shadcn`'s components (rename them with `components`). Lists, sets,
  records and maps repeat over state with add and remove buttons; a definition that contains
  itself is drawn `depth` levels deep (default 3), and the output stops at `maxElements`
  (default 20 000), past which fields are left out with a note. It is tested against json-render itself: its
  spec validator, the shadcn components' props, and its React renderer in a DOM.
  json-render's state holds JSON, except records and maps are lists of `{ key, value }`, an
  enum's value (and a variant's key) is its option's label, so shadcn's `Select` and `Radio`,
  which take plain strings, show labels (its value, as text, where labels are expressions or
  repeat), a set edited with `checks` is a comma-separated string, and a `json` field is text:
  `toJsonRenderState` / `fromJsonRenderState` convert, and conditions comparing an enum compare
  its label (a collection holding a value of the wrong shape becomes an empty list, which
  json-render can repeat over). An expression with code in it (`$cel`, `$js`, `$computed`)
  becomes a call to one function, which runs it as fieldspec does, with typed values read from
  json-render's state: pass `jsonRenderFunctions(spec)` to `JSONUIProvider` as `functions`. A
  derived `value` is drawn as text that follows the others. A list inside a list item
  removes its items with the `removeItem` action: declare `JSON_RENDER_ACTIONS` in your catalog
  and pass `jsonRenderActions(store)` as handlers. A `scroll` box is a `Stack` with Tailwind
  classes (`overflow-y-auto max-h-[18rem]`), so Tailwind must see the class.
- `prompt(registry)` and `metaSchema(registry)`: a system prompt and a JSON Schema for structured
  outputs, both generated from the registry's kinds, elements and presets. The prompt tells
  agents to start specs with `$schema`.

## Status

Experimental. Not yet:

- In json-render output: conditions with code in them (json-render's conditions have no way to
  call a function, so such a leaf holds and what it guards shows), and conditions that read an
  outer list's item from inside an inner list's (json-render reads only the innermost item).

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
Code proposes, the models decide, and the checker and `parse` have the last word. A third
experiment has a model that writes (Gemma 4) write whole specs from `prompt(registry)`, for
descriptions that call for checks, `$cel`, derived values, translations and migrations, each
held to a test of how the spec behaves, with the checker's faults sent back once. Over four
rounds, each changing the prompt or the checker where the one before failed, the specs that
behaved after that one repair went from 12 to 20 of 20. The homepage's
[models page](site/models.html) shows the recorded results.

```bash
bun experiments/jev-specs/generate.ts       # specs from descriptions, with Jev (TYPESAFE_API_KEY)
bun experiments/clairic-specs/hybrid.ts     # the same, with Clairic reading what the text states
bun experiments/fill/fill.ts                # filling forms from messages, scored field by field
bun experiments/delegate/delegate.ts        # handing what they cannot do to a writer model
bun --conditions=fieldspec@dev experiments/writer-specs/write.ts   # specs written from the prompt, held to tests
```

Keys go in `.env.local` (ignored by git): `TYPESAFE_API_KEY` for Jev, and `ANTHROPIC_API_KEY`
for Claude Haiku 5.5 as the writer. Clairic and the fallback writer run through the `cf` CLI's
sign-in.
