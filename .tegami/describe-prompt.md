---
packages:
  fieldspec:
    type: minor
---

### `describePrompt` and `describeMessage` ask a model for a spec's description, the mirror of `prompt`

`describePrompt(registry, { maxLength, customRules })` is a system prompt for saying a spec in plain words such that a writer given `prompt` writes the same fields from it, naming kinds and presets from the registry as `prompt` does. `describeMessage(spec)` is the user message: the spec as JSON without `$schema`, `fieldspec` and `meta`. `prompt` gains one rule, so its text changes: where what the writer is asked for names a key, a kind, options, a limit, a default or whether a field is required, it uses exactly those.
