---
packages:
  'fieldspec': minor
---

### CEL expressions with `$cel`

`{ "$cel": "end >= start", "args": { … } }` evaluates a CEL (Common Expression Language) expression over its `args`, wherever `$js` may go. `fieldspec/cel` runs it with `@marcbachmann/cel-js` (an optional peer, about 25 KB gzipped) and is the engine to reach for: `createRegistry({ languages: [createCel()] })`. The checker type-checks each expression against its args.
