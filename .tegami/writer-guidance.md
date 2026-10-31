---
packages:
  'fieldspec': patch
---

### What a small model writing specs got wrong, the library now heads off

`fieldspec/cel`'s part of the prompt lists the string, list and duration functions there are (no `len`, `replace` or `math`) and how to count days; the migrations part says when to `add` and when to `replace`. An untyped whole number (an optional field's, or one a migration reads) works in CEL as an int or a double, as the expression needs, so `timeout * 1000` runs. The checker shows the shape it wants for a `$cond` with its branches inside it and a condition with no value to test (with a "did you mean" for `$gte`), reports an invented `$` operator such as `$multiply` instead of taking it as a literal, and says a layout is not wrapped in `render`.
