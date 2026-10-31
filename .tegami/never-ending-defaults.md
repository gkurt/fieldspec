---
packages:
  'fieldspec': patch
---

### Defaults that would never end, end

A default that reads the object it sits in reads nothing, as that holds the field itself, and an expression default no longer counts as ending a definition that holds itself: the checker says it requires itself. Specs like these hung `parse`, a form and `toJsonRender`.
