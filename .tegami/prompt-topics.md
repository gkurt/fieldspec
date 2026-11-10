---
packages:
  fieldspec:
    type: minor
---

### `prompt` teaches only the `topics` it is given, so its default is shorter

`prompt(registry, { topics })` names the parts of the format to teach beyond fields, kinds and presets: `conditions`, `checks`, `expressions`, `defs`, `locales`, `migrations`, `groups`, `controls`, `layout`. The default for a form is now `conditions`, `groups` and `controls`, about 11,800 characters where it was 18,650, so `prompt()` no longer teaches `checks`, expressions and code, `defs`, translations, migrations or layout elements. `topics: 'all'` gives the text `prompt()` gave before, and data takes the topics a form does not draw.
