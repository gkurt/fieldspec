---
packages:
  'fieldspec': minor
---

### CEL expressions with `$cel`

`{ "$cel": "end >= start", "args": { … } }` evaluates a CEL (Common Expression Language) expression over its `args`, wherever `$js` may go. `fieldspec/cel` runs it with `@marcbachmann/cel-js` (an optional peer, about 25 KB gzipped) and is the engine to reach for: `createRegistry({ languages: [createCel()] })`. An arg that reads a field has that field's type (an `int` is a CEL int, a `date` a timestamp), and the checker type-checks each expression against them.
