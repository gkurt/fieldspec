---
packages:
  'fieldspec': minor
---

### JavaScript expressions with `$js`

`{ "$js": "end >= start", "args": { … } }` runs a JavaScript expression over its `args`, wherever an expression or the value a condition tests may go. `fieldspec/js` runs it sandboxed in QuickJS (`@gkurt/quickjs-wasi`, an optional peer), with a time, memory and stack limit, and a registry takes it with `createRegistry({ languages: [await loadJs(wasm)] })`. The checker reports syntax errors at their spot.
