---
packages:
  fieldspec:
    type: minor
---

### `createSpecEditor` holds a spec while its fields, its JSON or its description are edited

The headless counterpart of `createForm` for the spec itself: `add`, `remove`, `rename`, `move`, `setKind` and `set` work on fields at any depth by JSON Pointer, `json()` and `applyJson(text)` are the JSON way, and `setDescription`, `generate()` and `describe()` keep the description in `meta.description` through callbacks to the application's own model. An edit is taken only when `checkSpec` finds no errors in the spec it makes; otherwise it returns the faults and the last good spec stays. `rename` rewrites the pointers, placements, `namedBy`, translations and default values that name the field. `readSpec(text)` parses and checks JSON without an editor, `fieldspec/react` adds `useSpecEditor` and `useSpecEditorState`, and `examples/editor.tsx` draws the editor with plain elements.
