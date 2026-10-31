---
packages:
  'fieldspec': minor
---

### Rules over several fields with `checks`

A field's `checks` hold its value to rules beyond its kind's own constraints, usually over other fields: `{ "assert": <condition>, "message": "Ends before it starts" }`. While `assert` fails, the field has an issue (`code: "check"`, or the check's own `code`) in `parse`, `validate`, a form's field state and `toZod`. Checks run on a present, otherwise valid value of a visible field; `message` may be an expression; a definition's checks add up with a use's own. `assert` takes any condition, `$cel` included, and the checker type-checks it. JSON Schema carries them as `x-checks`, and the prompt and meta-schema teach them.
