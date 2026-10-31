---
packages:
  'fieldspec': minor
---

### Versions and migrations

A spec may say which `version` of its values it describes, and carry `migrations` that bring values written for an earlier version forward: by the version each reaches, a list of JSON Patch operations over the stored JSON, where `*` stands for every item or key and a `value` may be an expression. `encode` writes `$version`; `decode`, `parse` and `createForm` migrate values that say an earlier one, and take `from` for values that do not. `migrate(spec, json)` does only the migrating. `parse` reports a value that could not be migrated, and a `$version` later than the spec's. The checker, meta-schema, JSON Schema and prompt know them.
