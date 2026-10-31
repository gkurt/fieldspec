---
packages:
  'fieldspec': minor
---

### Items named by `namedBy`

A list's, record's or map's `namedBy` names its items by a field of theirs or a text expression, in place of their position or key.

### Strings with `suggestions`

A string's `suggestions`, a list or an expression, are offered as it is typed, and draw as the new `autocomplete` control.

### The `accordion` control

Draws a list's, record's or map's items as sections headed by their names.

### `useFormState`

Reads a form's values, issues and JSON as a new object on every change, so components stay current under the React Compiler; `useField` does too, and `FormView` opts out of compiling.
