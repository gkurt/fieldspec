/** A form drawn with React Aria Components, beside the values it edits. */
import { define } from "../../src/index.ts";
import { reactAriaRenderers, reactAriaStyles } from "../../src/react-aria.tsx";
import { FormView, useForm, useFormVersion } from "../../src/react/index.tsx";
import { Json } from "./Code.tsx";

export const meetupSpec = define({
  fields: {
    title: { type: "string", default: "Bring-your-own-schema night", required: true },
    starts: { type: "date", default: "2026-11-19", group: "when" },
    capacity: { type: "int", min: 5, max: 500, default: 40, group: "when" },
    format: { type: "enum", options: [{ value: "venue", label: "In person" }, { value: "online", label: "Online" }], default: "venue", render: "radio" },
    city: {
      type: "enum",
      options: ["Amsterdam", "Berlin", "Istanbul", "Lisbon"],
      default: "Istanbul",
      visible: { $state: "format", eq: "venue" },
    },
    link: { type: "url", label: "Stream link", visible: { $state: "format", eq: "online" } },
    listing: { type: "enum", options: ["public", "unlisted", "private"], default: "public", render: "segmented" },
    topics: { type: "set", items: { type: "enum", options: ["forms", "schemas", "a11y", "AI"] }, default: ["forms"] },
    waitlist: { type: "boolean", default: true, render: "switch", label: "Keep a waitlist" },
    reminder: { use: "percent", default: 0.25, label: "Remind when this full" },
    accent: { use: "color", default: "#2456e6", render: { type: "color", props: { swatches: ["#2456e6", "#1a7f4b", "#a3348f", "#b4520a"] } } },
  },
  groups: { when: { label: "When", render: "row" } },
});

export const meetupSource = `import { FormView, defaultStyles } from "fieldspec/react";
import { reactAriaRenderers, reactAriaStyles } from "fieldspec/react-aria";

<style>{defaultStyles + reactAriaStyles}</style>
<FormView form={form} renderers={reactAriaRenderers} />`;

export function ReactAriaDemo() {
  const form = useForm(meetupSpec);
  useFormVersion(form);
  return (
    <div className="aria-demo">
      <style>{reactAriaStyles}</style>
      <figure>
        <figcaption>fieldspec/react-aria</figcaption>
        <div className="card form-card aria-host">
          <FormView form={form} renderers={reactAriaRenderers} />
        </div>
      </figure>
      <figure>
        <figcaption>form.json()</figcaption>
        <Json value={form.json()} className="aria-json" />
      </figure>
    </div>
  );
}
