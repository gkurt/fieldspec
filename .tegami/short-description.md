---
packages:
  fieldspec:
    type: minor
---

### `describePrompt` asks for a short description, as a person would ask for the spec

`describePrompt` now asks for one or two sentences (under 300 characters, or `maxLength`) saying what the spec is for and its notable parts, and no longer for every field's key, kind, required, options, limits and default: the description is to read, not to write the same spec from. It takes its options alone, `describePrompt({ maxLength, customRules })`, and no registry. `prompt` loses the rule 0.4.0 added about using the keys and limits it is asked for.
