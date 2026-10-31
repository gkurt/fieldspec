# Example renderers

fieldspec draws forms but leaves their look to you: `FormView` asks a renderer set to draw each
element of a form's layout. These are three sets to copy into your app and make your own. They
use only fieldspec's public API, so they read as you would write them.

| File                               | Draws with                                                                                                                                                                                         | Needs                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [`html.tsx`](html.tsx)             | Plain HTML: inputs, selects, fieldsets; lists reorder by dragging or the keyboard, record keys are renamed in place. `htmlStyles` is its look, all `fs-*` classes.                                 | `react`                                            |
| [`dialkit.tsx`](dialkit.tsx)       | [DialKit](https://github.com/joshpuckett/dialkit)'s sliders, toggles, selects, colour pickers and folders, in its panel. `DialKitView` is an inline panel.                                         | `dialkit`, `motion`                                |
| [`react-aria.tsx`](react-aria.tsx) | [React Aria Components](https://react-spectrum.adobe.com/react-aria/): number fields, date pickers, radio and toggle-button groups, colour fields. Unstyled; `reactAriaStyles` is a starting look. | `react-aria-components`, `@internationalized/date` |

The DialKit and React Aria sets are laid over the HTML set, which draws what they have no
control for (lists, records, variants, files).

```tsx
import { FormView, useForm } from 'fieldspec/react';
import { htmlRenderers, htmlStyles } from './renderers/html';

function Settings() {
  const form = useForm(settings);
  return (
    <>
      <style>{htmlStyles}</style>
      <FormView form={form} renderers={htmlRenderers} />
    </>
  );
}
```

What controls do (a list's add, remove and move; a record's key renames; variants; optional
objects) comes from `fieldspec/react` as `listOf`, `entriesOf`, `variantOf`, `objectOf`,
`choicesOf` and `checksOf`, so a set only draws. The website draws every form with these sets,
and the tests in `test/` run them in a DOM.
