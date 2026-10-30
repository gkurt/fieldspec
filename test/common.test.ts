import { describe, expect, test } from "bun:test";
import { checkSpec, commonFields, createForm, define, parse, type Spec } from "../src/index.ts";

const text = define({
  fields: {
    x: { type: "number" },
    y: { type: "number" },
    opacity: { use: "percent", label: "Opacity" },
    fill: { use: "color", default: "#000000" },
    font: { type: "enum", options: ["sans", "serif", "mono"] },
    size: { type: "int", visible: { $state: "font", neq: "mono" } },
    padding: { type: "int", min: 0, max: 64 },
    link: { type: "url", optional: true, protocols: ["https:", "mailto:"] },
    name: { type: "string", pattern: "[a-z]+" },
    border: { type: "object", fields: { width: { type: "int", min: 0 }, style: { type: "enum", options: ["solid", "dashed"] } } },
    tags: { type: "array", items: { type: "string" } },
    shadow: {
      type: "variant",
      key: "kind",
      variants: {
        none: { fields: {} },
        drop: { label: "Drop", fields: { blur: { type: "number", min: 0 }, color: { use: "color" } } },
      },
    },
  },
});

const shape = define({
  fields: {
    x: { type: "number" },
    y: { type: "number" },
    opacity: { use: "percent", label: "Alpha" },
    fill: { use: "color", default: "#000000" },
    font: { type: "string" },
    size: { type: "int", visible: { $state: "font", neq: "mono" } },
    padding: { type: "number", min: 8, max: 128 },
    link: { type: "url", optional: true, protocols: ["https:"] },
    name: { type: "string", pattern: ".{0,8}" },
    border: { type: "object", fields: { width: { type: "int", min: 1 }, radius: { type: "int" } } },
    tags: { type: "array", items: { type: "int" } },
    shadow: {
      type: "variant",
      key: "kind",
      variants: {
        drop: { label: "Drop", fields: { blur: { type: "number", min: 0, max: 50 }, color: { use: "color" } } },
        glow: { fields: { radius: { type: "number" } } },
      },
    },
    corner: { type: "int" },
  },
});

const textValues = { x: 10, y: 5, opacity: 0.5, fill: "#ff0000", padding: 10, border: { width: 2, style: "solid" }, shadow: { kind: "drop", blur: 4, color: "#000000" } };
const shapeValues = { x: 10, y: 20, opacity: 0.5, fill: "#00ff00", padding: 12, border: { width: 2, radius: 4 }, shadow: { kind: "drop", blur: 8, color: "#000000" }, corner: 3 };

describe("commonFields", () => {
  const common = commonFields([text, shape], { values: [textValues, shapeValues] });

  test("keeps the fields every spec has, each declared as narrowly as all of them need", () => {
    expect(Object.keys(common.spec.fields)).toEqual(["x", "y", "opacity", "fill", "size", "padding", "link", "name", "border", "shadow"]);
    expect(common.spec.fields.x).toEqual({ type: "number" });
    expect(common.spec.fields.opacity).toEqual({ use: "percent", label: "Opacity" });
    expect(common.spec.fields.padding).toEqual({ type: "int", min: 8, max: 64 });
    expect(common.spec.fields.link).toEqual({ type: "url", optional: true, protocols: ["https:"] });
    expect(common.spec.fields.border).toEqual({ type: "object", fields: { width: { type: "int", min: 1 } } });
    expect(common.spec.fields.shadow).toEqual({
      type: "variant",
      key: "kind",
      variants: { drop: { label: "Drop", fields: { blur: { type: "number", min: 0, max: 50 }, color: { use: "color" } } } },
    });
    expect(checkSpec(common.spec).filter((f) => f.severity === "error")).toEqual([]);
  });

  test("a value valid for the common spec is valid for every spec", () => {
    const name = common.spec.fields.name!;
    const one = (value: string) => parse({ fields: { name } }, { name: value }).ok;
    expect([one("abc"), one("ABC"), one("abcdefghij")]).toEqual([true, false, false]);
  });

  test("says what it left out and why", () => {
    expect(common.dropped).toEqual([
      { path: "/font", reason: "is an enum in spec 0 but a string in spec 1" },
      { path: "/border/style", reason: "is not in spec 1" },
      { path: "/border/radius", reason: "is not in spec 0" },
      { path: "/tags", reason: "its item declaration is a string in spec 0 but an int in spec 1" },
      { path: "/corner", reason: "is not in spec 0" },
    ]);
  });

  test("drops conditions that read a field no longer there", () => {
    expect(common.spec.fields.size).toEqual({ type: "int" });
  });

  test("summarizes the values: the first spec's, with the ones that differ marked mixed", () => {
    expect(common.values).toEqual({
      x: 10,
      y: 5,
      opacity: 0.5,
      fill: "#ff0000",
      size: 0,
      padding: 10,
      name: "",
      border: { width: 2 },
      shadow: { kind: "drop", blur: 4, color: "#000000" },
    });
    expect(common.mixed).toEqual(["/y", "/fill", "/padding", "/shadow/blur"]);
  });

  test("writes back only what was edited, keeping what each spec has of its own", () => {
    const edited = { ...common.values, y: 7, border: { width: 3 }, shadow: { kind: "drop", blur: 4, color: "#111111" } };
    const [t, s] = common.apply(edited);
    expect(t).toEqual({ ...textValues, y: 7, border: { width: 3, style: "solid" }, shadow: { kind: "drop", blur: 4, color: "#111111" } });
    expect(s).toEqual({ ...shapeValues, y: 7, border: { width: 3, radius: 4 }, shadow: { kind: "drop", blur: 8, color: "#111111" } });
  });

  test("a form over them marks mixed fields until they are edited", () => {
    const form = createForm(common.spec, { values: common.values, mixed: common.mixed });
    expect(["/x", "/y", "/shadow", "/shadow/blur"].map((p) => form.field(p)!.mixed)).toEqual([false, true, false, true]);
    form.set("/y", 7);
    form.set("/shadow", { kind: "drop", blur: 4, color: "#000000" });
    expect([form.field("/y")!.mixed, form.field("/shadow/blur")!.mixed]).toEqual([false, false]);
    expect(common.apply(form.values)).toEqual([
      { ...textValues, y: 7 },
      { ...shapeValues, y: 7 },
    ]);
  });

  test("with match: some, keeps fields only some specs have, and edits reach only those", () => {
    const some = commonFields([text, shape], { values: [textValues, shapeValues], match: "some" });
    expect(some.sources.corner).toEqual([1]);
    expect(some.sources.x).toEqual([0, 1]);
    expect(some.spec.fields.font).toBeUndefined();
    const [t, s] = some.apply({ ...some.values, corner: 9 });
    expect(t).toEqual(textValues);
    expect(s).toEqual({ ...shapeValues, corner: 9 });
  });

  test("an edit inside a variant reaches only the values of that variant", () => {
    const one = define({ fields: { shadow: shape.fields.shadow } });
    const values = [{ shadow: { kind: "drop", blur: 1, color: "#000000" } }, { shadow: { kind: "glow", radius: 2 } }];
    const c = commonFields([one, one], { values });
    expect(c.mixed).toEqual(["/shadow"]);
    expect(c.apply({ shadow: { kind: "drop", blur: 6, color: "#000000" } })).toEqual([
      { shadow: { kind: "drop", blur: 6, color: "#000000" } },
      { shadow: { kind: "glow", radius: 2 } },
    ]);
    // Choosing a variant sets it everywhere.
    expect(c.apply({ shadow: { kind: "glow", radius: 5 } })).toEqual([{ shadow: { kind: "glow", radius: 5 } }, { shadow: { kind: "glow", radius: 5 } }]);
  });

  test("keeps definitions the specs share, and expands those that differ", () => {
    const entry = (extra: object): Spec => ({
      fields: { menu: { use: "Entry" } },
      defs: { Entry: { type: "object", fields: { label: { type: "string" }, ...extra, children: { type: "array", items: { use: "Entry" } } } } },
    });
    const same = commonFields([entry({}), entry({})]);
    expect(same.spec.fields.menu).toEqual({ use: "Entry" });
    expect(same.spec.defs).toEqual(entry({}).defs);

    const differ = commonFields([entry({}), entry({ icon: { type: "string" } })]);
    expect(differ.spec.fields.menu).toEqual({ type: "object", fields: { label: { type: "string" } } });
    expect(differ.spec.defs).toBeUndefined();
    expect(differ.dropped).toEqual([
      { path: "/menu/children", reason: "its item declaration differs inside the recursive definition Entry" },
      { path: "/menu/icon", reason: "is not in spec 0" },
    ]);
  });

  test("values given as JSON compare equal to the form's decoded ones", () => {
    const site = define({ fields: { home: { type: "url" }, since: { type: "date" } } });
    const json = [{ home: "https://a.example/", since: "2024-01-01T00:00:00.000Z" }];
    const c = commonFields([site], { values: json });
    const form = createForm(c.spec, { values: c.values });
    expect(form.values.home).toBeInstanceOf(URL);
    expect(c.apply(form.values)).toEqual(json);
  });

  test("conflicting constraints drop the field", () => {
    const a = define({ fields: { n: { type: "int", min: 10 }, e: { type: "enum", options: ["a", "b"] } } });
    const b = define({ fields: { n: { type: "int", max: 5 }, e: { type: "enum", options: ["c"] } } });
    expect(commonFields([a, b]).dropped).toEqual([
      { path: "/n", reason: "has no value within every spec's min and max" },
      { path: "/e", reason: "has no option every spec allows" },
    ]);
  });
});
