## fieldspec@0.4.0

### A spec has `meta` for what the application keeps, and `fingerprint` says whether its description still matches

A spec takes a top-level `meta`, never interpreted, whose `description` is `{ text, of }`: the spec in plain words and the fingerprint of the spec the text last matched. `fingerprint(spec)` is the same whatever the order of keys and leaves out `meta` and `$schema`; `withDescription`, `descriptionOf`, `stampDescription` and `isDescriptionStale` write, read, stamp and compare the description. `toJSONSchema` carries `meta` as `x-meta`.

### `describePrompt` and `describeMessage` ask a model for a spec's description, the mirror of `prompt`

`describePrompt(registry, { maxLength, customRules })` is a system prompt for saying a spec in plain words such that a writer given `prompt` writes the same fields from it, naming kinds and presets from the registry as `prompt` does. `describeMessage(spec)` is the user message: the spec as JSON without `$schema`, `fieldspec` and `meta`. `prompt` gains one rule, so its text changes: where what the writer is asked for names a key, a kind, options, a limit, a default or whether a field is required, it uses exactly those.

### `createSpecEditor` holds a spec while its fields, its JSON or its description are edited

The headless counterpart of `createForm` for the spec itself: `add`, `remove`, `rename`, `move`, `setKind` and `set` work on fields at any depth by JSON Pointer, `json()` and `applyJson(text)` are the JSON way, and `setDescription`, `generate()` and `describe()` keep the description in `meta.description` through callbacks to the application's own model. An edit is taken only when `checkSpec` finds no errors in the spec it makes; otherwise it returns the faults and the last good spec stays. `rename` rewrites the pointers, placements, `namedBy`, translations and default values that name the field. `readSpec(text)` parses and checks JSON without an editor, `fieldspec/react` adds `useSpecEditor` and `useSpecEditorState`, and `examples/editor.tsx` draws the editor with plain elements.

## fieldspec@0.3.0

### `parse` refuses a required field that the input leaves out

A field with `required` whose key is absent from what `parse` is given now has the `required` issue even when the field's zero would pass, so a required number or boolean must be sent: `0` and `false` count as sent. A field with a `default` or a `value` is never absent, and a form, which holds a value for every field, is unchanged. `toJSONSchema(spec, { io: "input" })` lists a field whose `required` is `true` and that is never hidden under `required`.

## fieldspec@0.2.1

### A value for no field can be said another way

The `unknown` issue, for a value given for a field the spec does not have, carries `params` now (`near`, the field it may have meant, where there is one), so `messages` says it in another language as it does the others.

### A text box's own errors are said with the form's `messages`

A form keeps the `messages` it was created with, as `form.messages`, and `useParsedText` (so `input` and `textarea`) says text that does not read as the field's kind, such as "Enter a number", through them, as a `type` issue whose `expected` is the field's kind.

### `fromJSONSchema` reads `uniqueItems` as a set

An array schema with `uniqueItems: true` comes in as a `set`, as `toJSONSchema` writes one, so a set of an enum read from a plain JSON Schema draws as `checks`.

### One titled option from JSON Schema keeps its label

A `oneOf` or `anyOf` of a single `const` with a `title` comes in as an enum of that one option, labelled by its title, as one of several does, rather than as a field labelled by it.

### `fromJSONSchema` keeps a string's `format` and reads `enumNames`

A string's `format` comes in as the field's `format`, so `email`, `uri` and the other formats fieldspec checks are checked once read, and other formats are kept as hints. An enum's `enumNames`, which older schemas such as MCP's elicitation forms label options with, become the options' labels.

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
