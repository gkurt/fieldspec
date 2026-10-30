/** The React controls in a DOM: renaming entries' keys and reordering lists by dragging. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createForm, define } from "../src/index.ts";

const spec = define({
  fields: {
    headers: { type: "record", values: { type: "string" } },
    limits: { type: "map", keys: { type: "int" }, values: { type: "string" } },
    steps: { type: "array", items: { type: "string" } },
  },
});

describe("React controls", () => {
  let React: typeof import("react");
  let client: typeof import("react-dom/client");
  let ui: typeof import("../src/react/index.tsx");

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import("react");
    client = await import("react-dom/client");
    ui = await import("../src/react/index.tsx");
  });
  afterAll(() => GlobalRegistrator.unregister());

  async function mount(values: unknown) {
    const form = createForm(spec, { values });
    const host = document.createElement("div");
    document.body.append(host);
    const root = client.createRoot(host);
    const act = (fn: () => void) => React.act(async () => fn());
    await act(() => root.render(React.createElement(ui.FormView, { form })));
    const type = (input: HTMLInputElement, text: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const keys = () => [...host.querySelectorAll<HTMLInputElement>('input[aria-label="Key"]')];
    return { form, host, root, act, type, keys };
  }

  test("an entry's key is renamed in place, keeping its value and position", async () => {
    const { form, act, type, keys, root, host } = await mount({ headers: { A: "1", B: "2", C: "3" }, limits: [[10, "ten"]] });
    const b = keys()[1]!;
    await type(b, "Beta");
    await act(() => b.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(Object.entries(form.values.headers)).toEqual([["A", "1"], ["Beta", "2"], ["C", "3"]]);

    // A taken key is refused, with the reason; Escape puts the key back.
    const c = keys()[2]!;
    await type(c, "A");
    await act(() => c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(host.textContent).toContain('"A" is already a key');
    expect(Object.keys(form.values.headers)).toEqual(["A", "Beta", "C"]);
    await act(() => c.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(keys()[2]!.value).toBe("C");

    // A map's keys are read as its key kind.
    const ten = keys()[3]!;
    await type(ten, "x");
    await act(() => ten.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(host.textContent).toContain("Enter a whole number");
    await type(ten, "20");
    await act(() => ten.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect([...form.values.limits]).toEqual([[20, "ten"]]);
    await act(() => root.unmount());
  });

  test("a list item moves where its handle is dropped", async () => {
    const { form, act, host, root } = await mount({ steps: ["one", "two", "three"] });
    const rows = () => [...host.querySelectorAll<HTMLElement>(".fs-item")];
    const handle = rows()[0]!.querySelector<HTMLElement>(".fs-handle")!;
    expect(handle.getAttribute("draggable")).toBe("true");
    const drag = (type: string, target: HTMLElement) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
      event.dataTransfer = { setData() {}, setDragImage() {}, effectAllowed: "", dropEffect: "" };
      target.dispatchEvent(event);
    };
    await act(() => drag("dragstart", handle));
    await act(() => drag("dragover", rows()[2]!));
    expect(rows()[2]!.dataset.drop).toBe("after");
    await act(() => drag("drop", rows()[2]!));
    expect(form.values.steps).toEqual(["two", "three", "one"]);
    expect(rows().some((r) => r.dataset.drop !== undefined)).toBe(false);
    await act(() => root.unmount());
  });
});
