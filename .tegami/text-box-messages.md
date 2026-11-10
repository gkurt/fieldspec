---
packages:
  fieldspec:
    type: patch
---

### A text box's own errors are said with the form's `messages`

A form keeps the `messages` it was created with, as `form.messages`, and `useParsedText` (so `input` and `textarea`) says text that does not read as the field's kind, such as "Enter a number", through them, as a `type` issue whose `expected` is the field's kind.
