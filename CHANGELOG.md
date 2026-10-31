## fieldspec@0.2.0

### JavaScript expressions with `$js`

`{ "$js": "end >= start", "args": { … } }` runs a JavaScript expression over its `args`, wherever an expression or the value a condition tests may go. `fieldspec/js` runs it sandboxed in QuickJS (`@gkurt/quickjs-wasi`, an optional peer), with a time, memory and stack limit, and a registry takes it with `createRegistry({ languages: [await loadJs(wasm)] })`. The checker reports syntax errors at their spot.

### Defaults that would never end, end

A default that reads the object it sits in reads nothing, as that holds the field itself, and an expression default no longer counts as ending a definition that holds itself: the checker says it requires itself. Specs like these hung `parse`, a form and `toJsonRender`.

### What a small model writing specs got wrong, the library now heads off

`fieldspec/cel`'s part of the prompt lists the string, list and duration functions there are (no `len`, `replace` or `math`) and how to count days; the migrations part says when to `add` and when to `replace`. An untyped whole number (an optional field's, or one a migration reads) works in CEL as an int or a double, as the expression needs, so `timeout * 1000` runs. The checker shows the shape it wants for a `$cond` with its branches inside it and a condition with no value to test (with a "did you mean" for `$gte`), reports an invented `$` operator such as `$multiply` instead of taking it as a literal, and says a layout is not wrapped in `render`.

### A skill for agents, and llms.txt

The package ships `SKILL.md`, a skill for coding agents in projects that use fieldspec: how to write a spec from the generated prompt, check it, and use it. The website serves `llms.txt`.

### CEL expressions with `$cel`

`{ "$cel": "end >= start", "args": { … } }` evaluates a CEL (Common Expression Language) expression over its `args`, wherever `$js` may go. `fieldspec/cel` runs it with `@marcbachmann/cel-js` (an optional peer, about 25 KB gzipped) and is the engine to reach for: `createRegistry({ languages: [createCel()] })`. An arg that reads a field has that field's type (an `int` is a CEL int, a `date` a timestamp), and the checker type-checks each expression against them.

### Defaults fill the values of records and maps

An object in a record or map gets its fields' defaults and zeros, as one in a list does, instead of an issue for each.

### json-render output runs code, shows enum labels, and draws derived values

An expression with `$cel`, `$js` or `$computed` in `toJsonRender`'s output is a call to one function, which runs it as fieldspec does: pass `jsonRenderFunctions(spec)` to `JSONUIProvider` as `functions`. json-render's state holds an enum's (and a variant key's) label where labels are plain and distinct, so `Select` and `Radio` show labels, and conditions comparing an enum compare its label. A derived `value` is drawn as text that follows the others. A condition with code in it holds there, as json-render's conditions cannot call a function.

### Rules over several fields with `checks`

A field's `checks` hold its value to rules beyond its kind's own constraints, usually over other fields: `{ "assert": <condition>, "message": "Ends before it starts" }`. While `assert` fails, the field has an issue (`code: "check"`, or the check's own `code`) in `parse`, `validate`, a form's field state and `toZod`. Checks run on a present, otherwise valid value of a visible field; `message` may be an expression; a definition's checks add up with a use's own. `assert` takes any condition, `$cel` included, and the checker type-checks it. JSON Schema carries them as `x-checks`, and the prompt and meta-schema teach them.

### Derived values with `value`

A field's `value` decides it every time, usually an expression over other values: `"total": { "type": "number", "value": { "$cel": "price * double(qty)", "args": { … } } }`. `parse` replaces a given value and a form recomputes it on every edit; its field state is `readOnly`. Values may read values, in any order, and it is validated like any value. JSON Schema marks it `readOnly` with `x-value`, and the checker, meta-schema and prompt know it.

### `encode` leaves a value of the wrong kind as it is

A date, bigint, URL, regular expression or bytes field holding something else, as a form may while it is being edited, no longer makes `encode` and `form.json()` throw.

### A spec may state its format version in `fieldspec`

`"fieldspec": 1` says which version of the spec format a spec is written for. It is optional, and unlike the package version in `$schema` it changes only when the grammar does. `FORMAT_VERSION` is the one this fieldspec reads; the checker rejects a spec written for another, the meta-schema and prompt know it, and JSON Schema carries it as `x-fieldspec`.

### Versions and migrations

A spec may say which `version` of its values it describes, and carry `migrations` that bring values written for an earlier version forward: by the version each reaches, a list of JSON Patch operations over the stored JSON, where `*` stands for every item or key and a `value` may be an expression. `encode` writes `$version`; `decode`, `parse` and `createForm` migrate values that say an earlier one, and take `from` for values that do not. `migrate(spec, json)` does only the migrating. `parse` reports a value that could not be migrated, and a `$version` later than the spec's. The checker, meta-schema, JSON Schema and prompt know them.

### Translations with `locales`

A spec may carry its text in other languages: `"locales": { "de": { "/fields/name/label": "Dienstname" } }`, a table per locale from a JSON Pointer into the spec to the text in its place. A pointer reaches any text the spec shows (labels, hints, options, check messages, element titles) or a string inside one (a template's, a `$cond` branch), and may give text the spec only implies, like a label made from the key. `texts(spec)` lists what there is to translate; `localize(spec, "de")` lays a locale over the spec, falling back from `de-AT` to `de`, and takes tables of your own; `createForm(spec, { locale })` shows a form in one. `checkSpec` checks a spec's locales, and `checkTranslations` a table of your own.

### Issue messages in other languages

The library's own issue messages carry `params`, what they are about (`{ code: "min", params: { min: 1 } }`), and a `messages` function on `parse`, `validate`, `createForm` and `toZod` says them another way. Messages the spec writes have no `params` and translate with the spec.

## fieldspec@0.1.0

### Readable pattern messages

A string that does not match its `pattern` says "This isn't a valid slug", named after the definition or preset the field uses, else its label or key; `patternMessage` replaces it. Custom kinds read the same name from `ctx.name`.

### Constraints beside a definition's `$ref`

In JSON Schema, what a field adds to its definition's constraints sits beside the `$ref`, so validators apply it, and a field that changes one is written out in full.

### First release

One JSON document, a spec, says what a config's values are and, optionally, how a form for them is drawn.

### The format

Kinds for text, numbers, booleans, enums, dates, colours, URLs, files, JSON and containers (objects, variants, lists, sets, records, maps); presets and definitions, including ones that contain themselves; conditions and text as serializable expressions over the form's state; groups, layouts and a `render` on any field or group. Registries extend the core with your own kinds, elements and presets, and `checkSpec` reports each fault at its spot, phrased as the fix.

### Types, values and forms

`Infer<typeof spec>` is the value type. `parse`, `validate`, `encode`, `decode` and `applyPatch` work on values; `createForm` is a headless form with conditions, issues and a layout tree, and `commonFields` edits many values at once.

### Interop and agents

JSON Schema and Zod (`fieldspec/zod`) both ways, Standard Schema, and json-render specs and state. `prompt(registry)` and `metaSchema(registry)` give agents a system prompt and a structured-output schema.

### Rendering

`fieldspec/react` draws a form with renderers you bring: a table or a function that picks one per element, each typed by its role. It ships no look of its own; `listOf`, `entriesOf`, `variantOf`, `objectOf`, `choicesOf` and `checksOf` carry what controls do, and the repository's `examples/renderers` are sets to copy (plain HTML, DialKit, React Aria).

### Items named by `namedBy`

A list's, record's or map's `namedBy` names its items by a field of theirs or a text expression, in place of their position or key.

### Strings with `suggestions`

A string's `suggestions`, a list or an expression, are offered as it is typed, and draw as the new `autocomplete` control.

### The `accordion` control

Draws a list's, record's or map's items as sections headed by their names.

### `useFormState`

Reads a form's values, issues and JSON as a new object on every change, so components stay current under the React Compiler; `useField` does too, and `FormView` opts out of compiling.
