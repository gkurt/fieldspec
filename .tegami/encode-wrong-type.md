---
packages:
  'fieldspec': patch
---

### `encode` leaves a value of the wrong kind as it is

A date, bigint, URL, regular expression or bytes field holding something else, as a form may while it is being edited, no longer makes `encode` and `form.json()` throw.
