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
