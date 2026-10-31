---
packages:
  'fieldspec': minor
---

### json-render output runs code, shows enum labels, and draws derived values

An expression with `$cel`, `$js` or `$computed` in `toJsonRender`'s output is a call to one function, which runs it as fieldspec does: pass `jsonRenderFunctions(spec)` to `JSONUIProvider` as `functions`. json-render's state holds an enum's (and a variant key's) label where labels are plain and distinct, so `Select` and `Radio` show labels, and conditions comparing an enum compare its label. A derived `value` is drawn as text that follows the others. A condition with code in it holds there, as json-render's conditions cannot call a function.
