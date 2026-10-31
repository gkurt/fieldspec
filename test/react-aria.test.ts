/** React Aria's controls drawing a fieldspec form: the form stays fieldspec's, the controls are React Aria's. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createForm, define } from "../src/index.ts";

const spec = define({
  fields: {
    name: { type: "string", required: true, description: "Shown on the card." },
    email: { use: "email" },
    port: { type: "int", min: 1, max: 65535, default: 8080 },
    opacity: { use: "percent", default: 0.5 },
    public: { type: "boolean", render: "switch" },
    agree: { type: "boolean" },
    region: { type: "enum", options: ["eu", "us"], default: "eu" },
    size: { type: "enum", options: ["s", "m", "l"], default: "m", render: "radio" },
    layout: { type: "enum", options: ["stack", "grid"], default: "stack", render: "segmented" },
    days: { type: "set", items: { type: "enum", options: ["mon", "tue", "wed"] } },
    start: { type: "date", default: "2026-10-31" },
    accent: { use: "color", default: "#2456e6" },
    gap: { type: "int", default: 8, enabled: { $state: "layout", eq: "grid" } },
    tags: { type: "array", items: { type: "string" }, default: ["a"] },
  },
});

describe("React Aria renderers", () => {
  let React: typeof import("react");
  let client: typeof import("react-dom/client");
  let ui: typeof import("../src/react/index.tsx");
  let aria: typeof import("../src/react-aria.tsx");

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import("react");
    client = await import("react-dom/client");
    ui = await import("../src/react/index.tsx");
    aria = await import("../src/react-aria.tsx");
  });
  afterAll(() => GlobalRegistrator.unregister());

  async function mount() {
    const form = createForm(spec);
    const host = document.createElement("div");
    document.body.append(host);
    const root = client.createRoot(host);
    const act = (fn: () => void) => React.act(async () => fn());
    await act(() => root.render(React.createElement(ui.FormView, { form, renderers: aria.reactAriaRenderers })));
    const q = (s: string) => [...host.querySelectorAll<HTMLElement>(s)];
    const type = (input: HTMLInputElement, text: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    return { form, host, q, act, type, unmount: () => act(() => root.unmount()) };
  }

  test("draws each control with React Aria's own, labelled and described", async () => {
    const { q, unmount } = await mount();
    for (const cls of ["text", "number", "slider", "switch", "checkbox", "select", "radios", "segmented", "checks", "date", "colorfield"]) {
      expect(q(`.fs-aria-${cls}`).length, cls).toBeGreaterThan(0);
    }
    // React Aria ties label and help to the input itself.
    const name = q(".fs-aria-text input")[0]!;
    const label = document.getElementById(name.getAttribute("aria-labelledby")!.split(" ")[0]!)!;
    expect(label.textContent).toBe("Name *");
    expect(document.getElementById(name.getAttribute("aria-describedby")!)!.textContent).toBe("Shown on the card.");
    expect(name.getAttribute("aria-required")).toBe("true");
    // A percent slider shows a percent; the radios and toggles are named by their options.
    expect(q(".fs-aria-slider .fs-aria-output")[0]!.textContent).toBe("50%");
    expect(q(".fs-aria-radio").map((r) => r.textContent)).toEqual(["s", "m", "l"]);
    expect(q(".fs-aria-toggle[data-selected]").map((t) => t.textContent)).toEqual(["stack"]);
    await unmount();
  });

  test("keeps fieldspec's own controls, and frame, where React Aria has none", async () => {
    const { q, unmount } = await mount();
    expect(q("fieldset.fs-group legend").map((l) => l.textContent)).toEqual(["Tags"]);
    expect(q(".fs-handle")).toHaveLength(1);
    await unmount();
  });

  test("edits the form, and follows it", async () => {
    const { form, q, act, type, unmount } = await mount();
    const values = () => form.values as { name: string; public: boolean; size: string; days: Set<string>; port: number; layout: string };
    await type(q(".fs-aria-text input")[0] as HTMLInputElement, "Ada");
    expect(values().name).toBe("Ada");
    await act(() => q(".fs-aria-switch input")[0]!.click());
    expect(values().public).toBe(true);
    await act(() => (q(".fs-aria-radio input")[2] as HTMLInputElement).click());
    expect(values().size).toBe("l");
    await act(() => (q(".fs-aria-checks input")[1] as HTMLInputElement).click());
    expect([...values().days]).toEqual(["tue"]);
    await act(() => form.set("/port", 443));
    expect((q(".fs-aria-number input")[0] as HTMLInputElement).value).toBe("443");
    await act(() => form.set("/layout", "grid"));
    expect(q(".fs-aria-toggle[data-selected]").map((t) => t.textContent)).toEqual(["grid"]);
    await unmount();
  });

  test("a date is the day it is in fieldspec, and a colour its hex", async () => {
    const { form, q, act, unmount } = await mount();
    const segments = () => q(".fs-aria-date .fs-aria-segment").map((s) => s.textContent).join("");
    expect(segments()).toContain("31");
    await act(() => form.set("/start", new Date("2027-02-03T00:00:00Z")));
    expect(segments()).toContain("2027");
    expect((q(".fs-aria-colorfield input")[0] as HTMLInputElement).value.toLowerCase()).toBe("#2456e6");
    await unmount();
  });

  test("shows issues once touched, and disables by condition", async () => {
    const { form, q, act, unmount } = await mount();
    expect(q(".fs-aria-text[data-invalid]")).toHaveLength(0);
    await act(() => form.touch("/name"));
    expect(q(".fs-aria-text[data-invalid]").length).toBeGreaterThan(0);
    expect(q(".fs-aria-text .fs-errors")[0]!.textContent).not.toBe("");
    const gap = () => q(".fs-aria-number[data-disabled]");
    expect(gap()).toHaveLength(1);
    await act(() => form.set("/layout", "grid"));
    expect(gap()).toHaveLength(0);
    await unmount();
  });
});
