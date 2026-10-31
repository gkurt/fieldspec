/**
 * One form drawn twice: with fieldspec's own controls and with DialKit's. Both views are the
 * same form, so an edit in either shows in the other and in the card they style.
 */
import 'dialkit/styles.css';
import { useEffect, useState } from 'react';
import { DialKitView } from '#examples/renderers/dialkit.tsx';
import { htmlRenderers } from '#examples/renderers/html.tsx';
import { define, type Infer } from '#src/index.ts';
import { FormView, useForm, useFormState } from '#src/react/index.tsx';

export const cardSpec = define({
  fields: {
    title: { type: 'string', default: 'Quarterly report', placeholder: 'Title' },
    subtitle: { type: 'string', default: 'Revenue by region' },
    layout: {
      type: 'enum',
      options: [
        { value: 'stack', label: 'Stack' },
        { value: 'row', label: 'Row' },
      ],
      default: 'stack',
      render: 'segmented',
    },
    radius: { type: 'int', min: 0, max: 40, default: 18, unit: 'px', render: 'slider', group: 'shape' },
    padding: { type: 'int', min: 8, max: 48, default: 24, unit: 'px', render: 'slider', group: 'shape' },
    accent: { use: 'color', default: '#2456e6' },
    badge: { type: 'boolean', default: true, render: 'switch', label: 'Show badge' },
    shadow: {
      type: 'object',
      fields: {
        blur: { type: 'int', min: 0, max: 60, default: 24, render: 'slider' },
        strength: { use: 'percent', default: 0.3 },
      },
    },
    tags: { type: 'array', items: { type: 'string' }, default: ['Q3', 'EMEA'] },
  },
  groups: { shape: { label: 'Shape', render: 'row' } },
});

export const cardSource = `import "dialkit/styles.css";
import { DialKitView } from "./renderers/dialkit"; // copied from fieldspec's examples/renderers
import { useForm, useFormState } from "fieldspec/react";

function Card() {
  const form = useForm(card); // values, conditions, checks: fieldspec
  const { values } = useFormState(form);
  return <>
    <Preview card={values} />
    <DialKitView form={form} title="Card" /> {/* drawn with DialKit's controls */}
  </>;
}`;

type Card = Infer<typeof cardSpec>;

export function DialKitDemo() {
  const form = useForm(cardSpec);
  const { values } = useFormState(form);
  const theme = useSiteTheme();
  return (
    <div className="dial-demo">
      <div className="dial-preview">
        <Preview card={values} />
      </div>
      <div className="dial-pair">
        <figure>
          <figcaption>examples/renderers/html</figcaption>
          <div className="card form-card" data-fieldspec="">
            <FormView form={form} renderers={htmlRenderers} />
          </div>
        </figure>
        <figure>
          <figcaption>examples/renderers/dialkit</figcaption>
          <DialKitView form={form} title="Card" theme={theme} className="dial-host" />
        </figure>
      </div>
    </div>
  );
}

function Preview({ card }: { card: Card }) {
  const shadow = `0 ${Math.round(card.shadow.blur / 3)}px ${card.shadow.blur}px rgb(15 20 40 / ${card.shadow.strength})`;
  return (
    <article
      className="dial-card"
      style={{
        borderRadius: card.radius,
        padding: card.padding,
        boxShadow: shadow,
        flexDirection: card.layout === 'row' ? 'row' : 'column',
        ['--card-accent' as string]: card.accent,
      }}
    >
      <div className="dial-card-mark" aria-hidden="true" />
      <div>
        <h3>
          {card.title || 'Untitled'} {card.badge && <span className="dial-badge">New</span>}
        </h3>
        <p>{card.subtitle}</p>
        <p className="dial-tags">{card.tags.map((t) => `#${t}`).join(' ')}</p>
      </div>
    </article>
  );
}

/** The site's theme, following the theme button. */
function useSiteTheme(): 'light' | 'dark' | 'system' {
  const read = (): 'light' | 'dark' | 'system' => (document.documentElement.dataset.theme as 'light' | 'dark' | undefined) ?? 'system';
  const [theme, setTheme] = useState(read);
  // The theme button sets the root's `data-theme` outside React; watch it for changes.
  useEffect(() => {
    const watch = new MutationObserver(() => setTheme(read()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => watch.disconnect();
  }, []);
  return theme;
}
