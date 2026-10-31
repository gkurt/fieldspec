---
packages:
  'fieldspec': minor
---

### A spec may state its format version in `fieldspec`

`"fieldspec": 1` says which version of the spec format a spec is written for. It is optional, and unlike the package version in `$schema` it changes only when the grammar does. `FORMAT_VERSION` is the one this fieldspec reads; the checker rejects a spec written for another, the meta-schema and prompt know it, and JSON Schema carries it as `x-fieldspec`.
