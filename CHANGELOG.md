# Changelog

fieldspec follows [semantic versioning](https://semver.org). Before 1.0, a minor version may
change the API; each such change is listed here with what to do.

## 0.1.0

The first release.

**The format.** One JSON document, a spec, says what a config's values are and, optionally,
how a form for them is drawn.

- Kinds: text, numbers, booleans, enums, dates, colours, URLs, files, JSON, and the containers
  (objects, variants, lists, sets, records, maps), with constraints and defaults.
- Presets (`use: "email"`, `"percent"`, …) and definitions for shapes used more than once,
  including ones that contain themselves.
- Conditions (`visible`, `enabled`, `required`) and text as serializable expressions over the
  form's state, with named functions (`$computed`) you supply at runtime.
- Layout: groups, and a `render` on any field or group that names a control or arranges a
  layout of catalog elements; named layouts as alternative views.
- A format is extensible: your own kinds, elements and presets, capitalized by rule.
- `checkSpec` reports faults at their exact spot, phrased as the fix, with a "did you mean".

**TypeScript.** `Infer<typeof spec>` is the value type, from a `define`d spec.

**Values.** `parse`, `validate`, `encode`, `decode`, and JSON Patch with `applyPatch`.

**Forms.** `createForm`: a headless form with values, touched state, issues, conditions and a
layout tree; `commonFields` edits many values at once, with mixed fields.

**Interop.** JSON Schema both ways, Zod both ways (`fieldspec/zod`), Standard Schema, and
json-render specs and state.

**Agents.** `prompt(format)` and `metaSchema(format)`: a system prompt and a JSON Schema for
structured outputs, generated from the format.

**Rendering.**

- `fieldspec/react`: `FormView` draws a form with a renderer table keyed by element name, or a
  function that picks a renderer for each element from the field it draws (`ResolveRenderer`,
  `extendRenderers`, `useRenderer`). Each renderer gets its role's props (`ControlProps`,
  `FieldProps`, `LayoutProps`, `PartProps`), and `defineRenderers` types them. Lists reorder
  by dragging or the keyboard; record keys are renamed in place.
- `fieldspec/dialkit`: forms drawn with DialKit's controls and folders.
- `fieldspec/react-aria`: forms drawn with React Aria Components.

**Packaging.** ES modules only, with types and source maps. React, Zod, DialKit and React Aria
are optional peer dependencies.
