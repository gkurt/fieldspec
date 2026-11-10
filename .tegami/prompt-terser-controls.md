---
packages:
  fieldspec:
    type: patch
---

### `prompt` offers only the controls worth choosing, and prints its example compactly

Without the `layout` topic, the controls list leaves out a control that is a kind's own and takes no props (`select`, `checkbox`, `date`, `file`, `entries`, `fields`, `variant`), since a field has it without `render`, and says which kinds a control edits in brackets. The example has a line per field instead of a line per property. `aliases` and `deprecated` are taught with the `migrations` topic. The default prompt for a form is about 10,400 characters and the one for data about 6,800.
