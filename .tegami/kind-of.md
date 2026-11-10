---
packages:
  fieldspec:
    type: minor
---

### `kindOf(decl, spec)` gives a field's kind with `use` followed

`kindOf({ use: 'email' })` is `"string"`. With the spec, it follows the spec's `defs` and its registry's presets; it is undefined where `use` names nothing.
