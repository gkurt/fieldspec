---
packages:
  fieldspec:
    type: patch
---

### `fromJSONSchema` reads `uniqueItems` as a set

An array schema with `uniqueItems: true` comes in as a `set`, as `toJSONSchema` writes one, so a set of an enum read from a plain JSON Schema draws as `checks`.
