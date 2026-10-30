/**
 * One spec drawn twice: as fieldspec's form and as a DialKit panel. Both edit the same values,
 * so a change in either shows in the other and in the card they style.
 */
import { DialRoot, type DialTheme } from "dialkit";
import "dialkit/styles.css";
import { useEffect, useState } from "react";
import { define, encode, type Infer } from "../../src/index.ts";
import { useDialSpec } from "../../src/dialkit.ts";
import { FormView, useForm, useFormVersion } from "../../src/react/index.tsx";

export const cardSpec = define({
  fields: {
    title: { type: "string", default: "Quarterly report", placeholder: "Title" },
    subtitle: { type: "string", default: "Revenue by region" },
    layout: { type: "enum", options: [{ value: "stack", label: "Stack" }, { value: "row", label: "Row" }], default: "stack", render: "segmented" },
    radius: { type: "int", min: 0, max: 40, default: 18, unit: "px", render: "slider", group: "shape" },
    padding: { type: "int", min: 8, max: 48, default: 24, unit: "px", render: "slider", group: "shape" },
    accent: { use: "color", default: "#2456e6" },
    badge: { type: "boolean", default: true, render: "switch", label: "Show badge" },
    shadow: {
      type: "object",
      fields: {
        blur: { type: "int", min: 0, max: 60, default: 24, render: "slider" },
        strength: { use: "percent", default: 0.3 },
      },
    },
    tags: { type: "array", items: { type: "string" }, default: ["Q3", "EMEA"] },
  },
  groups: { shape: { label: "Shape", render: "row" } },
});

export const cardSource = `import { DialRoot } from "dialkit";
import { useDialSpec } from "fieldspec/dialkit";

function Card() {
  const { value, issues, panel, dial } = useDialSpec("Card", card);
  // value: Infer<typeof card>, decoded and checked by parse
  // panel.dropped: [{ path: "/tags", reason: "is an array, …" }]
  return <>
    <Preview card={value} />
    <DialRoot />
  </>;
}`;

type Card = Infer<typeof cardSpec>;

export function DialKitDemo() {
  const form = useForm(cardSpec);
  useFormVersion(form);
  const { panel, dial } = useDialSpec("Card", cardSpec);
  const theme = useSiteTheme();

  // The panel follows the form…
  useEffect(() => form.subscribe(() => dial.setValues(panel.updates(form.values))), [form, dial, panel]);
  // …and the form follows the panel. Read over the form's own values, so what the panel does
  // not show (the tags) is kept.
  useEffect(() => {
    const { value } = panel.read(dial.values, form.json());
    if (value !== undefined && JSON.stringify(encode(cardSpec, value)) !== JSON.stringify(form.json())) form.reset(value);
  }, [dial.values, form, panel]);

  return (
    <div className="dial-demo">
      <div className="dial-preview">
        <Preview card={form.values} />
      </div>
      <div className="dial-pair">
        <figure>
          <figcaption>fieldspec/react</figcaption>
          <div className="card form-card" data-fieldspec="">
            <FormView form={form} />
          </div>
        </figure>
        <figure>
          <figcaption>DialKit</figcaption>
          <div className="dial-host">
            <DialRoot mode="inline" theme={theme} productionEnabled versions="menu" />
          </div>
          <p className="caption">
            Left out: {panel.dropped.map((d) => `${d.path} ${d.reason}`).join("; ")}.
          </p>
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
      style={{ borderRadius: card.radius, padding: card.padding, boxShadow: shadow, flexDirection: card.layout === "row" ? "row" : "column", ["--card-accent" as string]: card.accent }}
    >
      <div className="dial-card-mark" aria-hidden="true" />
      <div>
        <h3>
          {card.title || "Untitled"} {card.badge && <span className="dial-badge">New</span>}
        </h3>
        <p>{card.subtitle}</p>
        <p className="dial-tags">{card.tags.map((t) => `#${t}`).join(" ")}</p>
      </div>
    </article>
  );
}

/** The site's theme as DialKit names it, following the theme button. */
function useSiteTheme(): DialTheme {
  const read = (): DialTheme => (document.documentElement.dataset.theme as "light" | "dark" | undefined) ?? "system";
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const watch = new MutationObserver(() => setTheme(read()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);
  return theme;
}
