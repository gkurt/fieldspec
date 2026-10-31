---
packages:
  'fieldspec': minor
---

### Translations with `locales`

A spec may carry its text in other languages: `"locales": { "de": { "/fields/name/label": "Dienstname" } }`, a table per locale from a JSON Pointer into the spec to the text in its place. A pointer reaches any text the spec shows (labels, hints, options, check messages, element titles) or a string inside one (a template's, a `$cond` branch), and may give text the spec only implies, like a label made from the key. `texts(spec)` lists what there is to translate; `localize(spec, "de")` lays a locale over the spec, falling back from `de-AT` to `de`, and takes tables of your own; `createForm(spec, { locale })` shows a form in one. `checkSpec` checks a spec's locales, and `checkTranslations` a table of your own.

### Issue messages in other languages

The library's own issue messages carry `params`, what they are about (`{ code: "min", params: { min: 1 } }`), and a `messages` function on `parse`, `validate`, `createForm` and `toZod` says them another way. Messages the spec writes have no `params` and translate with the spec.
