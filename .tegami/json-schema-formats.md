---
packages:
  fieldspec:
    type: patch
---

### `fromJSONSchema` keeps a string's `format` and reads `enumNames`

A string's `format` comes in as the field's `format`, so `email`, `uri` and the other formats fieldspec checks are checked once read, and other formats are kept as hints. An enum's `enumNames`, which older schemas such as MCP's elicitation forms label options with, become the options' labels.
