---
packages:
  fieldspec:
    type: patch
---

### `prompt` lists kinds more tersely

A kind has an example only where it has properties it needs (`enum`, `array`, `set`, `record`, `object`, `variant`), a kind that takes the same properties as an earlier one says so (`int` after `number`), and the blank lines between a kind's parts are gone. For data, `set`, `record` and `variant` gain an example without labels.
