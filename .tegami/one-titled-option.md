---
packages:
  fieldspec:
    type: patch
---

### One titled option from JSON Schema keeps its label

A `oneOf` or `anyOf` of a single `const` with a `title` comes in as an enum of that one option, labelled by its title, as one of several does, rather than as a field labelled by it.
