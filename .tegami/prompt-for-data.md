---
packages:
  fieldspec:
    type: minor
---

### `prompt(registry, { purpose: 'data' })` teaches a model to write a spec for data, not a form

For the shape of data a program or a model sends and others read. The prompt says no form is drawn and leaves out labels, groups, layouts, controls and translations; it asks for a `description` on every field at every depth, nesting instead of keys with a shared prefix, `required: true` for what the sender must always give, and `optional: true` for a value that may be unknown, since an absent field that is not optional reads as its kind's zero. The default, `purpose: 'form'`, is unchanged.
