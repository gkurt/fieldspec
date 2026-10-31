# Example renderers

fieldspec draws forms but leaves their look to you: `FormView` asks a renderer set to draw each
element of a form's layout. These are four sets to copy into your app and make your own. They
use only fieldspec's public API, so they read as you would write them.

| File                               | Draws with                                                                                                                                                                                                                                      | Needs                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`html.tsx`](html.tsx)             | Plain HTML: inputs, selects, fieldsets; lists reorder by dragging or the keyboard, record keys are renamed in place. `htmlStyles` is its look, all `fs-*` classes.                                                                              | `react`                                                                             |
| [`dialkit.tsx`](dialkit.tsx)       | [DialKit](https://github.com/joshpuckett/dialkit)'s sliders, toggles, selects, colour pickers and folders, in its panel. `DialKitView` is an inline panel.                                                                                      | `dialkit`, `motion`                                                                 |
| [`react-aria.tsx`](react-aria.tsx) | [React Aria Components](https://react-spectrum.adobe.com/react-aria/): number fields, date pickers, radio and toggle-button groups, colour fields. Unstyled; `reactAriaStyles` is a starting look.                                              | `react-aria-components`, `@internationalized/date`                                  |
| [`shadcn.tsx`](shadcn.tsx)         | [shadcn/ui](https://ui.shadcn.com): every element, with `Field`, input groups, selects, radio and toggle groups, sliders, a calendar, a combobox for suggestions, tabs, accordions. Built on Base UI; styled by Tailwind and your shadcn theme. | shadcn's components (in [`shadcn/ui`](shadcn/ui)), `@base-ui/react`, Tailwind CSS 4 |

The DialKit and React Aria sets are laid over the HTML set, which draws what they have no
control for (lists, records, variants, files). The shadcn set draws everything itself, borrowing
only the HTML set's `useReorder` for dragging list items.

[`shadcn/ui`](shadcn/ui) holds the shadcn components the set uses, on Base UI in shadcn's default
style (`base-nova`), as `npx shadcn add accordion button calendar checkbox collapsible combobox
field input input-group label popover radio-group select separator slider switch tabs textarea
toggle-group` writes them, adapted to this repository's lint rules. Suggestions use Base UI's
`Autocomplete`, which shares its parts with the combobox, so shadcn's combobox draws it. In your app, use your own `components/ui` and import from
`@/components/ui/*`; two of these are edited, and worth editing in yours: the checkbox shows a
dash for mixed values, and the slider passes its `aria-label` and `aria-labelledby` on to its
thumb, so the field's label names it.

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
