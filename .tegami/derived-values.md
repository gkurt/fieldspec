---
packages:
  'fieldspec': minor
---

### Derived values with `value`

A field's `value` decides it every time, usually an expression over other values: `"total": { "type": "number", "value": { "$cel": "price * double(qty)", "args": { … } } }`. `parse` replaces a given value and a form recomputes it on every edit; its field state is `readOnly`. Values may read values, in any order, and it is validated like any value. JSON Schema marks it `readOnly` with `x-value`, and the checker, meta-schema and prompt know it.
