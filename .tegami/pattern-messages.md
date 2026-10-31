---
packages:
  'fieldspec': minor
---

### Readable pattern messages

A string that does not match its `pattern` says "This isn't a valid slug", named after the definition or preset the field uses, else its label or key; `patternMessage` replaces it. Custom kinds read the same name from `ctx.name`.

### Constraints beside a definition's `$ref`

In JSON Schema, what a field adds to its definition's constraints sits beside the `$ref`, so validators apply it, and a field that changes one is written out in full.
