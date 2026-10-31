---
name: fieldspec
description: Write, check and use fieldspec specs — one JSON document for a config's values (kinds, constraints, defaults, conditions, checks) and the form that edits them. Use when a project depends on `fieldspec`, when writing or fixing a spec, validating values against one, drawing a form with `fieldspec/react`, adding kinds or elements to a registry, or converting to and from JSON Schema, Zod or json-render.
---

# fieldspec

A spec is plain JSON: `{ "fields": { … }, "groups": { … }, "defs": { … }, "layouts": { … } }`.
TypeScript infers the value type from it, `parse` validates values against it, `createForm` is
the headless form, and `fieldspec/react` draws that form with renderers the application brings.
The full reference is the package's `README.md`; the format's JSON Schema is
`schema/spec.json`.

## Writing a spec

- Generate the rules instead of guessing them: `prompt(registry)` is a system prompt and
  `metaSchema(registry)` a JSON Schema for structured output, both from the registry that will
  read the spec. Read the prompt before writing a spec by hand.
- Then run `checkSpec(spec, { registry })` and fix every fault. Each sits at a JSON Pointer into
  the spec and is phrased as the fix, with "did you mean"; fix them all in one pass. Errors must
  go; warnings are worth reading.
- Built-in names (kinds, elements, presets) are lowercase; names the application or spec
  defines are capitalized (`Address`, `GradientPicker`).
- Start a spec with `"$schema": SCHEMA_URL`, so editors validate it and the checker knows its
  version.
- Prefer, in order: a kind's own constraints (`min`, `pattern`, `options`), a preset (`use:
  "email"`), plain conditions (`{ "$state": "plan", "eq": "pro" }`), and only then code.
- Pointers without a leading `/` are relative to the enclosing object; `../` climbs one level.
  Use relative pointers inside `defs`.

## Rules over several fields: `checks`

A field's `checks` hold its value to rules beyond its kind's, usually over other fields. Put
the check on the field whose value is wrong, and write the message for people:

```json
"end": {
  "type": "date",
  "checks": [{ "assert": { "$state": "end", "gte": { "$state": "start" } }, "message": "Ends before it starts" }]
}
```

A failing check is an issue at the field (`code: "check"`, or the check's `code`). Checks run
only on a present, otherwise valid, visible value. A definition's checks add up with a use's
own.

## Values worked out from others: `value`

A field that follows from others (a total, a slug, a count) takes `value`, not `default`: an
expression that decides it every time, so it cannot be edited and a given value is replaced.
`default` only fills an absent value, which people may then change.

```json
"slug": { "type": "string", "value": { "$cel": "name.lowerAscii().split(' ').join('-')", "args": { "name": { "$state": "name" } } } }
```

## Translations: `locales`

Write a spec in one language. When asked for others, `texts(spec)` lists every string to
translate by JSON Pointer, implied labels included; put each translation under
`"locales": { "de": { "<pointer>": "<text>" } }`, keep a template's `${…}` references as they
are, and run `checkSpec`. `createForm(spec, { locale: "de" })` or `localize(spec, "de")` shows it.
The library's own issue messages carry `params`; a `messages` function on `parse`, `validate`
or `createForm` says them in another language.

## Changing a spec whose values are stored

A new field with a `default` needs nothing; a renamed key can list its old name in `aliases`.
Otherwise raise `version` and add `"migrations": { "<new version>": [ … ] }`: JSON Patch
operations (`add`, `replace`, `remove`, `move`, `copy`) over the stored JSON, `*` for every
item or key, `value` an expression evaluated where the value goes. `$cel` args there are
untyped JSON (a whole number works as an int or a double). `encode` writes `$version`; `parse` and `createForm` migrate
older values, and take `from` for values that do not say their version.

## Code: `$cel` and `$js`

What a condition or expression cannot say goes in `$cel`, which is CEL (Common Expression
Language), with its inputs as `args`:

```json
{ "$cel": "admins <= seats / 2", "args": { "admins": { "$state": "admins" }, "seats": { "$state": "seats" } } }
```

- The core runs no code. Give the registry an engine:
  `createRegistry({ languages: [createCel()] })` from `fieldspec/cel` (needs
  `@marcbachmann/cel-js`). Define specs through that registry: `registry.define(spec)`.
- An arg that reads a field has its type: `int` is a CEL int and `number` a double, which CEL
  does not mix in arithmetic (`count + 1`, `price + 1.0`, `double(count)`); `date` is a
  timestamp. An optional field's arg may be `null`: guard it (`x == null || x > 0`).
- `checkSpec` type-checks each expression; fix what it reports.
- `$js` (`fieldspec/js`, QuickJS, about 400 KB) is for what CEL cannot say. Prefer CEL.

## Using a spec in code

```ts
import { checkSpec, createForm, createRegistry, define, parse, type Infer } from "fieldspec";

const spec = define({ fields: { … } }); // keeps its literal types; does not check it
type Value = Infer<typeof spec>;
const result = parse(spec, json); // { ok, value, issues: [{ path, code, message }] }
```

- `define` binds a spec to its registry (and `$computed` functions) without checking it. Check
  every spec with `checkSpec` (or `assertSpec`, which throws), above all one that arrives as
  data from a file or a model.
- `parse` decodes JSON (dates, bigints, URLs, Maps, Sets come back as real values), fills
  defaults, and validates. `encode` goes back to JSON.
- `createForm(spec, { values })` holds values and gives each field's state (`form.field(path)`:
  visible, enabled, required, label, options, issues). `applyPatch` applies JSON Patch.
- `$computed` names a function passed at runtime: `define(spec, { fns })`.

## Drawing a form

```tsx
import { FormView, useForm } from 'fieldspec/react';
<FormView form={useForm(spec)} renderers={renderers} />;
```

fieldspec ships no look. Copy a renderer set from the repository's `examples/renderers`
(`html.tsx`, `react-aria.tsx`, `dialkit.tsx`) and make it your own. Behaviour lives in
`listOf`, `entriesOf`, `objectOf`, `variantOf`, `choicesOf` and `checksOf`; renderers only draw.
Read a form in your own components with `useFormState(form)` or `useField(form, path)`.

## Extending

`createRegistry({ kinds, elements, presets, rules, languages })` adds to the core vocabulary
(`defineKind`, `defineElement`). The checker, JSON Schema, prompt and layout all read the
registry, so a custom kind or element works everywhere at once.

## Interop

`toJSONSchema` / `fromJSONSchema` (draft 2020-12, `x-` keywords for the rest), `toZod` /
`fromZod` from `fieldspec/zod`, Standard Schema on every defined spec (`spec["~standard"]`),
and `toJsonRender` for json-render's shadcn components; where a spec has code (`$cel`, `$js`,
`$computed`), pass `jsonRenderFunctions(spec)` to json-render's `JSONUIProvider` as `functions`.
