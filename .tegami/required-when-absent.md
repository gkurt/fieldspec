---
packages:
  fieldspec:
    type: minor
---

### `parse` refuses a required field that the input leaves out

A field with `required` whose key is absent from what `parse` is given now has the `required` issue even when the field's zero would pass, so a required number or boolean must be sent: `0` and `false` count as sent. A field with a `default` or a `value` is never absent, and a form, which holds a value for every field, is unchanged. `toJSONSchema(spec, { io: "input" })` lists a field whose `required` is `true` and that is never hidden under `required`.
