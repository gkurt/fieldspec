---
packages:
  'fieldspec': minor
---

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
