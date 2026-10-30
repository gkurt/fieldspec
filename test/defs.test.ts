import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { checkSpec, createForm, define, layout, parse, prompt, toJsonRender, walk, type Infer } from "../src/index.ts";
import { toZod } from "../src/zod.ts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>() => {};

const menu = define({
  defs: {
    Item: {
      type: "object",
      fields: {
        label: { type: "string", required: true },
        kind: { type: "enum", options: ["link", "folder"], default: "link" },
        url: { type: "url", optional: true, visible: { $state: "kind", eq: "link" } },
        // A child may only open in a new tab when its parent folder allows it.
        newTab: { type: "boolean", visible: { $state: "../../allowNewTab", eq: true } },
        allowNewTab: { type: "boolean", visible: { $state: "kind", eq: "folder" } },
        children: { type: "array", items: { use: "Item" }, visible: { $state: "kind", eq: "folder" } },
      },
    },
    Address: {
      type: "object",
      fields: { street: { type: "string" }, city: { type: "string", required: true } },
    },
  },
  fields: {
    root: { use: "Item", label: "Menu" },
    billing: { use: "Address", label: "Billing address" },
    shipping: { use: "Address", label: "Shipping address", optional: true },
  },
});

describe("definitions", () => {
  test("uses infer their definition's type, recursively", () => {
    type V = Infer<typeof menu>;
    type Item = V["root"];
    assertType<Equal<Item["children"][number]["children"][number]["label"], string>>();
    assertType<Equal<V["billing"], { street: string; city: string }>>();
    assertType<Equal<V["shipping"], { street: string; city: string } | undefined>>();
    expect(true).toBe(true);
  });

  test("the spec checks clean", () => {
    expect(checkSpec(menu)).toEqual([]);
  });

  test("a definition is reused with its own overrides", () => {
    const v = parse(menu, { billing: { city: "Oslo" } }).value!;
    expect(v.billing).toEqual({ street: "", city: "Oslo" });
    expect("shipping" in v).toBe(false);
    expect(createForm(menu).field("/shipping")?.label).toBe("Shipping address");
  });

  test("recursive values parse to any depth, with issues at their paths", () => {
    const result = parse(menu, {
      root: {
        label: "Top",
        kind: "folder",
        children: [
          { label: "Docs", url: "https://example.com/docs" },
          { label: "More", kind: "folder", children: [{ label: "" }] },
        ],
      },
      billing: { city: "Oslo" },
    });
    expect(result.issues).toEqual([{ path: "/root/children/1/children/0/label", code: "required", message: "is required" }]);
    expect(result.value!.root.children[1]!.children[0]).toEqual({ label: "", kind: "link", newTab: false, allowNewTab: false, children: [] });
  });

  test("../ reaches a parent's properties", () => {
    const form = createForm(menu, {
      values: { root: { label: "Top", kind: "folder", children: [{ label: "A" }] }, billing: { city: "x" } },
    });
    expect(form.field("/root/children/0/newTab")?.visible).toBe(false);
    form.set("/root/allowNewTab", true);
    expect(form.field("/root/children/0/newTab")?.visible).toBe(true);
  });

  test("a new item of a recursive list starts from the definition", () => {
    const form = createForm(menu, { values: { root: { label: "Top", kind: "folder" }, billing: { city: "x" } } });
    form.addItem("/root/children");
    form.addItem("/root/children/0/children");
    expect(form.values.root.children[0]!.children[0]!.kind).toBe("link");
  });

  test("layout is built only as deep as it is read", () => {
    const tree = layout(menu);
    const nodes = [...walk(tree)];
    const refs = nodes.filter((n) => n.use === "Item");
    expect(refs.length).toBe(2); // the root, and the item template of its children, where walking stops
    const children = nodes.find((n) => n.field === "children")!;
    expect(children.item?.inner?.children.some((n) => n.field === "children")).toBe(true);
  });

  test("Zod and json-render handle the recursion", () => {
    const schema = toZod(menu);
    const value = parse(menu, { root: { label: "a", kind: "folder", children: [{ label: "b", kind: "folder", children: [{ label: "c" }] }] }, billing: { city: "x" } }).value;
    expect(schema.safeParse(value).success).toBe(true);
    assertType<Equal<z.infer<typeof schema>, Infer<typeof menu>>>();
    const out = toJsonRender(define({ defs: { N: { type: "object", fields: { name: { type: "string" }, next: { use: "N", optional: true } } } }, fields: { head: { use: "N" } } }));
    expect(Object.values(out.elements).some((e) => String(e.props.text).includes("deeper levels are not shown"))).toBe(true);
  });

  test("the prompt teaches defs and ../", () => {
    const text = prompt();
    expect(text).toContain("## Presets and definitions (`use`)");
    expect(text).toContain("`../`");
  });
});

describe("checking definitions", () => {
  test("faults: unknown refs, endless recursion, pointers that climb too far", () => {
    const messages = checkSpec({
      defs: {
        Loop: { type: "object", fields: { self: { use: "Loop" } } },
        Fine: { type: "object", fields: { self: { use: "Fine", optional: true } } },
        Unused: { type: "string" },
        lower: { type: "string" },
      },
      fields: {
        a: { use: "Lop" },
        b: { use: "Loop" },
        c: { use: "Fine" },
        g: { use: "lower" },
        d: { type: "string", visible: { $state: "../../x" } },
        e: { type: "object", fields: { f: { type: "string", visible: { $state: "../d", eq: "y" } } } },
      },
    }).map((f) => `${f.path}: ${f.message}`);
    expect(messages).toContain('/fields/a/use: no definition or preset named "Lop". Did you mean "Loop"?');
    expect(messages).toContainEqual(expect.stringContaining(`/defs/lower: a definition's name starts with an uppercase letter, as all names you define do: "Lower"`));
    expect(messages).toContainEqual(expect.stringContaining('/fields/g/use: "lower" is not a built-in preset.'));
    expect(messages).toContainEqual(expect.stringContaining("/defs/Loop: requires itself (Loop → self)"));
    expect(messages.some((m) => m.startsWith("/defs/Fine:") && !m.includes("never used"))).toBe(false);
    expect(messages).toContain("/defs/Unused: is never used");
    expect(messages).toContainEqual(expect.stringContaining('/fields/d/visible/$state: "../../x" climbs above the root'));
    expect(messages.filter((m) => m.startsWith("/fields/e"))).toEqual([]);
  });
});
