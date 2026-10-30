/** DialKit: a spec as a panel config, and the panel's values back as the spec's. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { define } from "../src/index.ts";
import { toDialKit } from "../src/dialkit.ts";

const card = define({
  fields: {
    title: { type: "string", default: "Hello", placeholder: "Title" },
    radius: { type: "int", min: 0, max: 64, default: 16, group: "shape" },
    opacity: { use: "percent", default: 1, group: "shape" },
    scale: { type: "number", default: 1.2 },
    accent: { use: "color", label: "Accent colour", default: "#2456e6" },
    layout: { type: "enum", options: [{ value: "stack", label: "Stack" }, "grid"], default: "stack" },
    columns: { type: "enum", options: [1, 2, 3], default: 2 },
    shadow: {
      type: "object",
      render: { type: "collapsible", props: { collapsed: true } },
      fields: { blur: { type: "int", min: 0, max: 40, default: 12 }, visible: { type: "boolean", default: true } },
    },
    link: { type: "url", optional: true },
    tags: { type: "array", items: { type: "string" }, default: ["a"] },
    CPU: { type: "int", label: "CPU cores", min: 1, max: 8, default: 2, order: 1 },
  },
  groups: { shape: { label: "Shape", render: { type: "collapsible", props: { collapsed: false } } } },
});

describe("toDialKit", () => {
  const panel = toDialKit(card);

  test("maps each kind to its control, groups and objects to folders, in drawing order", () => {
    expect(panel.config).toEqual({
      title: { type: "text", default: "Hello", placeholder: "Title" },
      Shape: { radius: [16, 0, 64, 1], opacity: [1, 0, 1, 0.05] },
      scale: 1.2,
      // "Accent colour" is printed as written, so it is used; "CPU cores" would be spaced out.
      "Accent colour": { type: "color", default: "#2456e6" },
      layout: { type: "select", options: [{ value: "stack", label: "Stack" }, "grid"], default: "stack" },
      columns: { type: "select", options: ["1", "2", "3"], default: "2" },
      shadow: { _collapsed: true, blur: [12, 0, 40, 1], visible: true },
      link: { type: "text", default: "" },
      CPU: [2, 1, 8, 1],
    });
    expect(Object.keys(panel.config).at(-1)).toBe("CPU");
  });

  test("lists what it leaves out", () => {
    expect(panel.dropped).toEqual([{ path: "/tags", reason: "is an array, which the panel has no control for" }]);
  });

  test("reads the panel's values back as the spec's, decoded and checked", () => {
    const result = panel.read({
      title: "Hi",
      Shape: { radius: 20.4, opacity: 0.5 },
      "Accent colour": "#ff0000",
      columns: "3",
      shadow: { blur: 4, visible: false },
      link: "https://example.com/",
    });
    expect(result.ok).toBe(true);
    const v = result.value!;
    expect(v.radius).toBe(20);
    expect(v.opacity).toBe(0.5);
    expect(v.accent).toBe("#ff0000");
    expect(v.columns).toBe(3);
    expect(v.shadow).toEqual({ blur: 4, visible: false });
    expect(v.link).toBeInstanceOf(URL);
    expect(v.tags).toEqual(["a"]);
    expect(panel.read({ link: "" }).value!.link).toBeUndefined();
    expect(panel.read({ link: "not a url" }).issues.map((i) => i.path)).toEqual(["/link"]);
  });

  test("turns the spec's values into an update for the panel", () => {
    const { value } = panel.read({ columns: "1", Shape: { radius: 8 } });
    expect(panel.updates(value)).toMatchObject({ columns: "1", Shape: { radius: 8 }, link: "", shadow: { blur: 12 } });
  });

  test("starts from given values, and can leave groups flat", () => {
    const flat = toDialKit(card, { values: { radius: 40 }, folders: false });
    expect(flat.config.radius).toEqual([40, 0, 64, 1]);
    expect(flat.config.Shape).toBeUndefined();
  });
});

describe("useDialSpec", () => {
  let React: typeof import("react");
  let client: typeof import("react-dom/client");
  let dialkit: typeof import("dialkit");
  let hook: typeof import("../src/dialkit.ts");

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import("react");
    client = await import("react-dom/client");
    dialkit = await import("dialkit");
    hook = await import("../src/dialkit.ts");
  });
  afterAll(() => GlobalRegistrator.unregister());

  test("draws the panel and returns the spec's values, following the controller", async () => {
    let seen: ReturnType<typeof hook.useDialSpec<typeof card>> | undefined;
    function App() {
      seen = hook.useDialSpec("Card", card);
      return React.createElement(dialkit.DialRoot, { mode: "inline", productionEnabled: true });
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = client.createRoot(host);
    await React.act(async () => root.render(React.createElement(App)));
    expect(host.textContent).toContain("Accent colour");
    expect(host.textContent).toContain("Shape");
    expect(seen!.ok).toBe(true);
    expect(seen!.value!.radius).toBe(16);
    await React.act(async () => seen!.dial.setValues(seen!.panel.updates({ ...seen!.value, radius: 33, columns: 1 })));
    expect(seen!.value!.radius).toBe(33);
    expect(seen!.value!.columns).toBe(1);
    await React.act(async () => root.unmount());
  });
});
