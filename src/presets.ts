/**
 * Built-in presets: a kind with settings filled in, which a field takes with `use` and
 * overrides as it likes. `{ "use": "percent", "label": "Opacity", "step": 0.01 }`.
 */
export const BUILTIN_PRESETS = {
  percent: { type: "number", min: 0, max: 1, step: 0.05, render: { type: "slider", props: { format: "percent" } } },
  email: { type: "string", format: "email", placeholder: "name@example.com" },
  password: { type: "string", render: { type: "input", props: { secret: true } } },
  multiline: { type: "string", render: "textarea" },
  port: { type: "int", min: 1, max: 65535 },
  color: { type: "string", format: "color", default: "#000000", render: "color" },
} as const;

/** One line each, for prompts. */
export const PRESET_DESCRIPTIONS: { readonly [name in keyof typeof BUILTIN_PRESETS]: string } = {
  percent: "A number from 0 to 1, drawn as a slider showing a percentage.",
  email: "An email address.",
  password: "Text typed hidden.",
  multiline: "Text over several lines.",
  port: "A network port, 1 to 65535.",
  color: "A colour as #rrggbb, with a colour picker.",
};
