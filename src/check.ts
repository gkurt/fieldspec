/**
 * Checking a spec. Total: every fault is collected, each at a JSON Pointer into the spec and
 * phrased as the fix, because whoever wrote it (often an agent) fixes them all in one pass.
 */
import type { ElementDef } from "./elements.ts";
import { isBuiltinName, isUserName, toUserName } from "./names.ts";
import { SCHEMA_URL, SCHEMA_URL_PATTERN, VERSION } from "./version.ts";
import { EXPR_KEYS, isDynamic, OPERATORS, type Functions } from "./expr.ts";
import { BASE_PROPS, formatOf, functionsOf, type Format, type Rule } from "./format.ts";
import { CONTAINER_KINDS, type AnyKind } from "./kinds.ts";
import { deref, requiresItself, type Lookup } from "./defs.ts";
import { escapeSegment, joinPointer, resolveSegments } from "./pointer.ts";
import type {
  ArrayField,
  Fault,
  FieldDecl,
  GroupDecl,
  MapField,
  ObjectField,
  RecordField,
  RenderNode,
  Resolved,
  Spec,
  VariantField,
} from "./types.ts";
import { checkField, decodeField, suggest } from "./values.ts";

export interface CheckOptions {
  readonly format?: Format;
  /** When given, every `$computed` name must be implemented here. */
  readonly fns?: Functions;
  readonly rules?: readonly Rule[];
}

type Fields = { readonly [key: string]: FieldDecl };
type Groups = { readonly [id: string]: GroupDecl } | undefined;

/** A fields map and where it sits, for resolving references statically. */
interface Scope {
  readonly fields: Fields;
  readonly groups: Groups;
  /** Static path of the object in decl space, `*` standing for any item or key. */
  readonly base: readonly string[];
  readonly inItem: boolean;
  /** Inside a definition, which can be placed anywhere: relative pointers cannot be checked. */
  readonly floating?: boolean;
}

interface Checker {
  readonly spec: Spec;
  readonly format: Format;
  readonly faults: Fault[];
  readonly computed: Map<string, string>;
  fault(path: string, message: string, severity?: Fault["severity"]): void;
}

const ROOT_PROPS = ["$schema", "title", "description", "fields", "groups", "defs", "layouts", "functions"];
const GROUP_PROPS = ["label", "description", "render", "visible", "group"];
const ELEMENT_KEYS = ["type", "props", "children", "visible"];

const lookupOf = (c: Checker): Lookup => ({ defs: c.spec.defs, presets: c.format.presets });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const listOf = (names: Iterable<string>) => [...names].map((n) => `"${n}"`).join(", ");

function mean(word: string, candidates: Iterable<string>): string {
  const near = suggest(word, [...candidates]);
  return near ? ` Did you mean "${near}"?` : "";
}

export function checkSpec(spec: unknown, options: CheckOptions = {}): Fault[] {
  const faults: Fault[] = [];
  if (!isObject(spec)) return [{ path: "", message: "must be an object with `fields`", severity: "error" }];
  const s = spec as unknown as Spec;
  const format = options.format ?? formatOf(s);
  const c: Checker = {
    spec: s,
    format,
    faults,
    computed: new Map(),
    fault: (path, message, severity = "error") => faults.push({ path, message, severity }),
  };
  for (const key of Object.keys(spec)) {
    if (!ROOT_PROPS.includes(key)) c.fault(`/${escapeSegment(key)}`, `is not a property of a spec.${mean(key, ROOT_PROPS)}`);
  }
  if (spec.$schema !== undefined) {
    const written = typeof spec.$schema === "string" ? SCHEMA_URL_PATTERN.exec(spec.$schema)?.[1] : undefined;
    if (typeof spec.$schema !== "string") c.fault("/$schema", "must be the URL of the schema the spec is written for");
    else if (written !== undefined && written !== VERSION) {
      c.fault("/$schema", `the spec is written for fieldspec ${written}; this is ${VERSION}. Check it against ${SCHEMA_URL} and update $schema.`, "warning");
    }
  }
  if (!isObject(spec.fields)) {
    c.fault("/fields", "required: an object of field declarations");
    return faults;
  }
  const root: Scope = { fields: s.fields, groups: s.groups, base: [], inItem: false };
  checkFieldsMap(c, root, "/fields");
  checkGroups(c, root, "/groups");
  if (spec.layouts !== undefined) {
    if (!isObject(spec.layouts)) c.fault("/layouts", "must be an object of named render nodes");
    else for (const [name, node] of Object.entries(spec.layouts)) checkNode(c, node as RenderNode, `/layouts/${escapeSegment(name)}`, { scope: root, view: newView() });
  }
  if (spec.defs !== undefined) {
    if (!isObject(spec.defs)) c.fault("/defs", "must be an object of named field declarations");
    else checkDefs(c, s.defs!);
  }
  checkFunctions(c, options.fns ?? functionsOf(s));
  const report = (path: string, message: string, severity?: Fault["severity"]) => c.fault(path, message, severity);
  for (const rule of [...format.rules, ...(options.rules ?? [])]) rule(s, report);
  return faults;
}

/** Throws with every fault, one per line. */
export function assertSpec(spec: unknown, options?: CheckOptions): asserts spec is Spec {
  const errors = checkSpec(spec, options).filter((f) => f.severity === "error");
  if (errors.length > 0) throw new Error(`Invalid spec:\n${formatFaults(errors).join("\n")}`);
}

export function formatFaults(faults: readonly Fault[]): string[] {
  return faults.map((f) => `  ${f.path || "/"}: ${f.message}${f.severity === "warning" ? " (warning)" : ""}`);
}

function checkFunctions(c: Checker, fns: Functions | undefined) {
  const declared = c.spec.functions;
  for (const [name, at] of c.computed) {
    if (declared && !(name in declared)) c.fault(at, `calls "${name}", which \`functions\` does not declare.${mean(name, Object.keys(declared))}`);
    if (fns && !(name in fns)) c.fault(at, `calls "${name}", which the function table does not implement.`);
  }
  for (const name of Object.keys(declared ?? {})) {
    if (!c.computed.has(name)) c.fault(`/functions/${escapeSegment(name)}`, "is declared but never called", "warning");
  }
}

// ── Fields ───────────────────────────────────────────────────────────────────────────────

function checkFieldsMap(c: Checker, scope: Scope, at: string, extra?: string) {
  const aliases = new Map<string, string>();
  for (const [key, decl] of Object.entries(scope.fields)) {
    const path = `${at}/${escapeSegment(key)}`;
    if (key === "") c.fault(path, "a field key must not be empty");
    else if (key.startsWith("$")) c.fault(path, "a field key must not start with $, which marks expressions");
    else if (key.includes("/")) c.fault(path, "a field key must not contain /, which separates pointer segments");
    if (key === extra) c.fault(path, `clashes with the variant key "${extra}"`);
    if (isObject(decl) && Array.isArray(decl.aliases)) {
      for (const alias of decl.aliases as unknown[]) {
        if (typeof alias !== "string") continue;
        if (alias in scope.fields) c.fault(`${path}/aliases`, `"${alias}" is already a field here`);
        else if (aliases.has(alias)) c.fault(`${path}/aliases`, `"${alias}" is already an alias of "${aliases.get(alias)}"`);
        aliases.set(alias, key);
      }
    }
    checkDecl(c, decl, path, scope, [...scope.base, key]);
  }
}

function checkDecl(c: Checker, decl: unknown, at: string, scope: Scope, self: readonly string[]) {
  if (!isObject(decl)) return c.fault(at, "must be a field declaration: an object with a `type`, or a `use`");
  // A field built with `use` is checked as its base with its own properties laid over.
  const usesBase = decl.use !== undefined;
  let resolved: Record<string, unknown> = decl;
  if (usesBase) {
    if (decl.type !== undefined) c.fault(`${at}/type`, "a field with `use` takes its kind from the base; leave `type` out");
    if (!checkUse(c, decl.use, `${at}/use`)) return;
    resolved = deref(lookupOf(c), decl as unknown as FieldDecl) as unknown as Record<string, unknown>;
  }
  const type = resolved.type;
  if (typeof type !== "string") {
    return c.fault(`${at}/type`, `required: one of ${listOf(c.format.kinds.keys())}, or \`use\` with a preset or definition`);
  }
  const chain = kindChain(c.format, type);
  if (chain.length === 0) return c.fault(`${at}/type`, unknownName("kind", type, c.format.kinds.keys()));
  const d = resolved as unknown as Resolved;

  const allowed = new Set(Object.keys(BASE_PROPS));
  for (const kind of chain) for (const prop of Object.keys(kind.props ?? {})) allowed.add(prop);
  for (const prop of Object.keys(decl)) {
    if (!allowed.has(prop)) c.fault(`${at}/${escapeSegment(prop)}`, `is not a property of a ${type} field.${mean(prop, allowed)}`);
  }
  for (const kind of chain) {
    for (const [prop, info] of Object.entries(kind.props ?? {})) {
      if (info.required && resolved[prop] === undefined) c.fault(`${at}/${prop}`, `required: ${info.description}`);
    }
  }
  for (const prop of ["label", "description", "hint", "placeholder"] as const) {
    if (decl[prop] !== undefined) checkText(c, decl[prop], `${at}/${prop}`, scope);
  }
  if (decl.optional !== undefined && typeof decl.optional !== "boolean") c.fault(`${at}/optional`, "must be true or false");
  if (decl.deprecated !== undefined && typeof decl.deprecated !== "boolean" && typeof decl.deprecated !== "string") {
    c.fault(`${at}/deprecated`, "must be true, or a string saying what to use instead");
  }
  for (const prop of ["visible", "enabled", "required"] as const) {
    if (decl[prop] !== undefined) checkCondition(c, decl[prop], `${at}/${prop}`, scope);
  }
  // A definition's own `group` belongs to wherever it is placed, so only its uses are checked.
  if (decl.group !== undefined && scope.fields !== DEF_SITE) {
    if (typeof decl.group !== "string") c.fault(`${at}/group`, "must be a group id");
    else if (!scope.groups?.[decl.group]) {
      c.fault(`${at}/group`, `no group "${decl.group}" in this scope.${mean(decl.group, Object.keys(scope.groups ?? {}))} Declare it under \`groups\`.`);
    }
  }

  // The base was checked where it is declared; a use is checked again only where it overrides the kind's own settings.
  const ownKindProps = Object.keys(decl).some((p) => !(p in BASE_PROPS));
  if (!usesBase || ownKindProps) {
    for (const kind of chain) {
      kind.checkDecl?.(d as never, {
        fault: (prop, message, severity) => c.fault(prop ? `${at}/${prop}` : at, message, severity),
      });
    }
  }

  // Containers recurse; the scope their fields resolve relative pointers in is the object itself.
  if (!usesBase) checkInside(c, d, type, at, scope, self);
  if (decl.render !== undefined) checkFieldRender(c, decl.render, `${at}/render`, scope, d, self);

  if (decl.default !== undefined) {
    if (isDynamic(decl.default)) checkExpr(c, decl.default, `${at}/default`, scope);
    else checkLiteral(c, d, decl.default, `${at}/default`);
  }
  if (Array.isArray(decl.examples)) {
    decl.examples.forEach((example, i) => checkLiteral(c, d, example, `${at}/examples/${i}`, "warning"));
  }
}

/** Whether `use` names something; faults saying where to look when it does not. */
function checkUse(c: Checker, name: unknown, at: string): boolean {
  if (typeof name !== "string") {
    c.fault(at, "must be the name of a preset or definition");
    return false;
  }
  const builtins = Object.keys(c.format.presets).filter(isBuiltinName);
  if (isBuiltinName(name)) {
    if (c.format.presets[name]) return true;
    c.fault(at, `"${name}" is not a built-in preset.${mean(name, builtins)} Built-ins: ${listOf(builtins)}. Your own presets and definitions are capitalized.`);
    return false;
  }
  const inDefs = !!c.spec.defs?.[name];
  const inPresets = !!c.format.presets[name];
  if (inDefs && inPresets) c.fault(at, `"${name}" is both a definition here and a preset of the format; rename the definition`);
  if (inDefs || inPresets) return true;
  const known = [...Object.keys(c.spec.defs ?? {}), ...Object.keys(c.format.presets)];
  c.fault(at, `no definition or preset named "${name}".${mean(name, known)}${isUserName(name) ? "" : " Your own names start with an uppercase letter."}`);
  return false;
}

/** Explains an unknown name, pointing at the naming rule. */
function unknownName(what: string, name: string, known: Iterable<string>): string {
  const near = mean(name, [...known]);
  const a = /^[aeiou]/.test(what) ? "an" : "a";
  if (isBuiltinName(name)) return `"${name}" is not a built-in ${what}.${near} Built-ins are lowercase; ${what}s your format adds are capitalized.`;
  if (isUserName(name)) return `"${name}" is not ${a} ${what} this format adds.${near}`;
  return `"${name}" is not ${a} ${what}.${near} Built-in names are lowercase; your own are capitalized.`;
}

function checkInside(c: Checker, d: Resolved, type: string, at: string, scope: Scope, self: readonly string[]) {
  switch (type) {
    case "object": {
      const o = d as ObjectField;
      if (isObject(o.fields)) {
        const inner: Scope = { fields: o.fields, groups: o.groups, base: self, inItem: scope.inItem, floating: scope.floating };
        checkFieldsMap(c, inner, `${at}/fields`);
        checkGroups(c, inner, `${at}/groups`);
      }
      break;
    }
    case "variant": {
      const v = d as VariantField;
      if (typeof v.key !== "string" || v.key === "") c.fault(`${at}/key`, "required: the property that names the variant");
      if (isObject(v.variants)) {
        if (Object.keys(v.variants).length === 0) c.fault(`${at}/variants`, "needs at least one variant");
        for (const [name, variant] of Object.entries(v.variants)) {
          const vat = `${at}/variants/${escapeSegment(name)}`;
          if (!isObject(variant) || !isObject(variant.fields)) {
            c.fault(vat, "must be an object with `fields`");
            continue;
          }
          for (const prop of Object.keys(variant)) {
            if (!["label", "description", "fields", "groups"].includes(prop)) c.fault(`${vat}/${escapeSegment(prop)}`, "is not a property of a variant");
          }
          const inner: Scope = { fields: variant.fields, groups: variant.groups, base: self, inItem: scope.inItem, floating: scope.floating };
          checkFieldsMap(c, inner, `${vat}/fields`, v.key);
          checkGroups(c, inner, `${vat}/groups`);
        }
      }
      break;
    }
    case "array":
    case "set": {
      const items = (d as ArrayField).items;
      if (items !== undefined) {
        const item: Scope = { ...scope, base: [...self, "*"], inItem: true };
        checkDecl(c, items, `${at}/items`, item, [...self, "*"]);
        const real = isObject(items) ? deref(lookupOf(c), items) : undefined;
        if (type === "set" && real && CONTAINER_KINDS.has(String(real.type))) {
          c.fault(`${at}/items`, "a set holds plain values; use an array for objects and lists", "warning");
        }
      }
      break;
    }
    case "record":
    case "map": {
      const values = (d as RecordField).values;
      const item: Scope = { ...scope, base: [...self, "*"], inItem: true };
      if (values !== undefined) checkDecl(c, values, `${at}/values`, item, [...self, "*"]);
      if (type === "map") {
        const keys = (d as MapField).keys;
        if (keys !== undefined) {
          checkDecl(c, keys, `${at}/keys`, scope, [...self, "*"]);
          const real = isObject(keys) ? deref(lookupOf(c), keys) : undefined;
          if (real && !["string", "int", "number", "enum"].includes(String(real.type))) {
            c.fault(`${at}/keys/type`, "map keys must be string, int, number or enum");
          }
        }
      }
      if (type === "record" && typeof (d as RecordField).keyPattern === "string") {
        try {
          new RegExp((d as RecordField).keyPattern!, "u");
        } catch {
          c.fault(`${at}/keyPattern`, "must be a valid regular expression");
        }
      }
      break;
    }
  }
}

function kindChain(format: Format, type: string): AnyKind[] {
  const chain: AnyKind[] = [];
  const seen = new Set<string>();
  let name: string | undefined = type;
  while (name !== undefined && !seen.has(name)) {
    seen.add(name);
    const kind = format.kinds.get(name);
    if (!kind) break;
    chain.unshift(kind);
    name = kind.base;
  }
  return chain;
}

/** A literal value the spec gives (a default or an example) must itself be valid. */
function checkLiteral(c: Checker, decl: FieldDecl, value: unknown, at: string, severity: Fault["severity"] = "error") {
  // Dynamic options cannot be known until the values are.
  if (decl.type === "enum" && !Array.isArray(decl.options)) return;
  const ctx = { format: c.format, fns: undefined, defs: c.spec.defs };
  const issues: { path: string; message: string; code: string }[] = [];
  const scrubbed: FieldDecl = { ...decl, required: undefined, visible: undefined } as FieldDecl;
  try {
    checkField(ctx, { values: {} }, scrubbed, decodeField(ctx, decl, value), "", { base: "" }, issues);
  } catch {
    return;
  }
  for (const issue of issues) {
    // An object's absent members are fine here: their own defaults fill them.
    if (issue.code === "required" && issue.path !== "") continue;
    c.fault(at + issue.path, issue.message, severity);
  }
}

// ── Groups ───────────────────────────────────────────────────────────────────────────────

function checkGroups(c: Checker, scope: Scope, at: string) {
  const groups = scope.groups;
  if (groups === undefined) return;
  if (!isObject(groups)) return c.fault(at, "must be an object of group declarations");
  for (const [id, group] of Object.entries(groups)) {
    const gat = `${at}/${escapeSegment(id)}`;
    if (!isObject(group)) {
      c.fault(gat, "must be a group declaration");
      continue;
    }
    for (const prop of Object.keys(group)) {
      if (!GROUP_PROPS.includes(prop)) c.fault(`${gat}/${escapeSegment(prop)}`, `is not a property of a group.${mean(prop, GROUP_PROPS)}`);
    }
    if (group.label !== undefined) checkText(c, group.label, `${gat}/label`, scope);
    if (group.description !== undefined) checkText(c, group.description, `${gat}/description`, scope);
    if (group.visible !== undefined) checkCondition(c, group.visible, `${gat}/visible`, scope);
    if (group.group !== undefined) {
      const seen = new Set([id]);
      let parent: string | undefined = group.group as string;
      if (!groups[parent]) c.fault(`${gat}/group`, `no group "${parent}" in this scope.${mean(parent, Object.keys(groups))}`);
      while (parent !== undefined && groups[parent]) {
        if (seen.has(parent)) {
          c.fault(`${gat}/group`, "groups nest in a cycle");
          break;
        }
        seen.add(parent);
        parent = groups[parent]!.group;
      }
    }
    if (group.render !== undefined) checkGroupRender(c, group.render, `${gat}/render`, scope, membersOf(c, scope, id));
  }
  const used = new Set<string>();
  for (const decl of Object.values(scope.fields)) if (isObject(decl) && typeof decl.group === "string") used.add(decl.group);
  for (const g of Object.values(groups)) if (isObject(g) && typeof g.group === "string") used.add(g.group);
  for (const id of Object.keys(groups)) {
    if (!used.has(id)) c.fault(`${at}/${escapeSegment(id)}`, "has no fields; it draws nothing", "warning");
  }
}

/** The fields and subgroups that belong to a group. */
function membersOf(c: Checker, scope: Scope, id: string): Members {
  const fields = new Set<string>();
  const groups = new Set<string>();
  for (const [key, decl] of Object.entries(scope.fields)) if (isObject(decl) && deref(lookupOf(c), decl).group === id) fields.add(key);
  for (const [gid, g] of Object.entries(scope.groups ?? {})) if (isObject(g) && g.group === id) groups.add(gid);
  return { fields, groups };
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────

type Members = { readonly fields: Set<string>; readonly groups: Set<string> };

interface View {
  readonly placed: Map<string, string>;
  readonly groups: Map<string, string>;
  rest: boolean;
}

/**
 * Where a render node sits. On a plain field (`self`), parts and controls bind to it and name
 * no field; elsewhere they name a field in `scope`. `members` limits a group's container to
 * the group's own fields.
 */
interface Site {
  readonly scope: Scope;
  readonly self?: Resolved;
  readonly members?: Members;
  readonly view: View;
}

const newView = (): View => ({ placed: new Map(), groups: new Map(), rest: false });

/** A field's own `render`: its control, or a layout of its parts (of its fields, on an object). */
function checkFieldRender(c: Checker, node: unknown, at: string, scope: Scope, decl: Resolved, self: readonly string[]) {
  if (decl.type === "object") {
    const name = typeof node === "string" ? node : isObject(node) ? node.type : undefined;
    if (typeof name === "string" && c.format.elements.get(name)?.role === "control") {
      return checkNode(c, node, at, { scope, self: decl, view: newView() });
    }
    const o = decl as ObjectField;
    if (!isObject(o.fields)) return;
    const inner: Scope = { fields: o.fields, groups: o.groups, base: self, inItem: scope.inItem, floating: scope.floating };
    return checkNode(c, node, at, { scope: inner, view: newView() });
  }
  checkNode(c, node, at, { scope, self: decl, view: newView() });
}

/** A group's `render`: a container, which its fields fill. */
function checkGroupRender(c: Checker, node: unknown, at: string, scope: Scope, members: Members) {
  const name = typeof node === "string" ? node : isObject(node) ? node.type : undefined;
  const def = typeof name === "string" ? c.format.elements.get(name) : undefined;
  if (def && (def.role !== "layout" || !def.children)) {
    const containers = [...c.format.elements.values()].filter((e) => e.role === "layout" && e.children).map((e) => e.name);
    c.fault(isObject(node) ? `${at}/type` : at, `a group's render is a container its fields go in: ${listOf(containers)}`);
    return;
  }
  checkNode(c, node, at, { scope, members, view: newView() });
}

function checkNode(c: Checker, node: unknown, at: string, site: Site): void {
  if (typeof node === "string") return checkNode(c, { type: node }, at, site);
  if (!isObject(node)) return c.fault(at, "must be an element name, or an element object with `type`");
  if ("field" in node && !("type" in node)) {
    if (site.self) return c.fault(at, "a field's own render draws only its own parts; leave `field` out");
    placeField(c, node.field, `${at}/field`, site, true);
    return;
  }
  if ("group" in node && !("type" in node)) {
    if (site.self) return c.fault(at, "a field's own render draws only its own parts");
    return placeGroup(c, node.group, `${at}/group`, site);
  }
  const type = node.type;
  if (typeof type !== "string") return c.fault(`${at}/type`, "required: an element name");
  const def = c.format.elements.get(type);
  if (!def) return c.fault(`${at}/type`, unknownName("element", type, c.format.elements.keys()));
  for (const key of Object.keys(node)) {
    if (!ELEMENT_KEYS.includes(key)) c.fault(`${at}/${escapeSegment(key)}`, "is not a property of an element; settings go under `props`");
  }
  if (node.props !== undefined && !isObject(node.props)) c.fault(`${at}/props`, "must be an object");
  const props = isObject(node.props) ? node.props : {};
  for (const [prop, value] of Object.entries(props)) {
    const info = def.props?.[prop];
    if (!info) {
      const own = Object.keys(def.props ?? {});
      c.fault(`${at}/props/${escapeSegment(prop)}`, `is not a prop of ${type}.${mean(prop, own)}${own.length ? ` Its props: ${own.join(", ")}.` : " It takes none."}`);
      continue;
    }
    const wrong = mismatch(value, info.schema);
    if (wrong) c.fault(`${at}/props/${escapeSegment(prop)}`, wrong);
    else if (isObject(value) && EXPR_KEYS.some((k) => k in value)) checkExpr(c, value, `${at}/props/${escapeSegment(prop)}`, site.scope);
  }
  if (node.visible !== undefined) checkCondition(c, node.visible, `${at}/visible`, site.scope);
  if (node.children !== undefined) {
    if (!def.children) c.fault(`${at}/children`, `${type} takes no children`);
    else if (!Array.isArray(node.children)) c.fault(`${at}/children`, "must be an array of render nodes");
    else node.children.forEach((child, i) => checkNode(c, child, `${at}/children/${i}`, site));
  }

  if (def.role === "part" || def.role === "control") {
    if (type === "label" && props.text !== undefined && props.field === undefined) return;
    if (site.self) {
      if (props.field !== undefined || props.fields !== undefined) c.fault(`${at}/props`, "a field's own render draws only its own parts; leave `field` out");
      if (def.role === "control") checkFits(c, def, site.self, at);
      return;
    }
    if (Array.isArray(props.fields)) {
      props.fields.forEach((f, i) => placeField(c, f, `${at}/props/fields/${i}`, site, false));
      return;
    }
    const target = placeField(c, props.field, `${at}/props/field`, site, false);
    if (target && def.role === "control") checkFits(c, def, target, at);
    return;
  }
  switch (type) {
    case "field":
      if (site.self) return c.fault(at, "a field's own render draws only its own parts");
      placeField(c, props.field, `${at}/props/field`, site, true);
      return;
    case "group":
      if (site.self) return c.fault(at, "a field's own render draws only its own parts");
      placeGroup(c, props.group, `${at}/props/group`, site);
      return;
    case "rest":
      if (site.self) return c.fault(at, "a field's own render draws only its own parts");
      if (site.view.rest) c.fault(at, "rest may appear once per render");
      site.view.rest = true;
  }
}

/** A control must be able to edit the field it draws. */
function checkFits(c: Checker, def: ElementDef, decl: Resolved, at: string) {
  if (!def.kinds) return;
  const chain = kindChain(c.format, decl.type).map((k) => k.name);
  if (!chain.some((k) => def.kinds!.includes(k))) {
    c.fault(at, `${def.name} edits ${def.kinds.join(", ")} fields; this is a ${decl.type} field`);
  }
}

/** A prop value against the small part of JSON Schema props use. Expressions pass. */
function mismatch(value: unknown, schema: { [keyword: string]: unknown }): string | undefined {
  if (isObject(value) && EXPR_KEYS.some((k) => k in value)) return undefined;
  if (Array.isArray(schema.anyOf)) {
    const misses = (schema.anyOf as { [keyword: string]: unknown }[]).map((branch) => mismatch(value, branch));
    return misses.some((m) => m === undefined) ? undefined : `must ${misses.map((m) => m!.replace(/^must /, "")).join(" or ")}`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`;
  const types = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? (schema.type as string[]) : [];
  if (types.length === 0) return undefined;
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value;
  const ok = types.some((t) => t === actual || (t === "number" && actual === "integer"));
  if (!ok) return `must be ${types.map((t) => (t === "integer" ? "a whole number" : t === "array" ? "an array" : `a ${t}`)).join(" or ")}`;
  if (typeof value === "string" && typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) return `must match ${schema.pattern}`;
  if (typeof value === "number" && typeof schema.exclusiveMinimum === "number" && !(value > schema.exclusiveMinimum)) return `must be more than ${schema.exclusiveMinimum}`;
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) return `must be at least ${schema.minimum}`;
  if (typeof value === "number" && typeof schema.maximum === "number" && value > schema.maximum) return `must be at most ${schema.maximum}`;
  return undefined;
}

/** Places a field from a scope render; returns its declaration when it resolves. */
function placeField(c: Checker, ref: unknown, at: string, site: Site, whole: boolean): Resolved | undefined {
  const { scope, members, view } = site;
  if (ref === undefined || ref === "") {
    c.fault(at, `required: which field. One of ${listOf(Object.keys(scope.fields))}`);
    return undefined;
  }
  if (typeof ref !== "string") {
    c.fault(at, "must be a field key or relative pointer");
    return undefined;
  }
  const head = ref.split("/")[0]!;
  if (!(head in scope.fields)) {
    c.fault(at, `no field "${head}" in this scope.${mean(head, Object.keys(scope.fields))}`);
    return undefined;
  }
  if (members && !members.fields.has(head)) {
    c.fault(at, `"${head}" is not in this group; a group's render places only its own fields. Give it \`group\` or place it elsewhere.`);
    return undefined;
  }
  const decl = ref.includes("/") ? resolveStatic(c, [...scope.base, ...ref.split("/")]) : deref(lookupOf(c), scope.fields[head]!);
  if (!decl) {
    c.fault(at, `"${ref}" does not lead to a field`);
    return undefined;
  }
  if (whole) {
    if (view.placed.has(ref)) c.fault(at, `"${ref}" is already placed at ${view.placed.get(ref)}; a field draws once per view`);
    view.placed.set(ref, at);
  }
  return decl as Resolved;
}

function placeGroup(c: Checker, ref: unknown, at: string, site: Site) {
  const { scope, members, view } = site;
  if (typeof ref !== "string" || !scope.groups?.[ref]) {
    return c.fault(at, `no group ${JSON.stringify(ref)} in this scope.${typeof ref === "string" ? mean(ref, Object.keys(scope.groups ?? {})) : ""}`);
  }
  if (members && !members.groups.has(ref)) c.fault(at, `"${ref}" is not a subgroup of this group`);
  if (view.groups.has(ref)) c.fault(at, `group "${ref}" is already placed at ${view.groups.get(ref)}`);
  view.groups.set(ref, at);
}

// ── Expressions and conditions ───────────────────────────────────────────────────────────

/** The declaration a static path leads to: `*` (or a number) steps into any item. */
function resolveStatic(c: Checker, segments: readonly string[]): FieldDecl | undefined {
  let fields: Fields | undefined = c.spec.fields;
  let decl: FieldDecl | undefined;
  for (const segment of segments) {
    if (fields) {
      decl = fields[segment];
      if (!decl && segment !== "*") return undefined;
    } else if (decl && ["array", "set", "record", "map"].includes(String(decl.type))) {
      decl = decl.type === "array" || decl.type === "set" ? (decl as ArrayField).items : (decl as RecordField).values;
    } else return undefined;
    if (!decl || !isObject(decl)) return undefined;
    decl = deref(lookupOf(c), decl);
    fields = undefined;
    if (decl.type === "object" && isObject((decl as unknown as ObjectField).fields)) fields = (decl as unknown as ObjectField).fields;
    if (decl.type === "variant" && isObject((decl as unknown as VariantField).variants)) {
      const v = decl as unknown as VariantField;
      const all: Record<string, FieldDecl> = { [v.key]: { type: "string" } };
      for (const variant of Object.values(v.variants)) if (isObject(variant?.fields)) Object.assign(all, variant.fields);
      fields = all;
    }
  }
  return decl;
}

function checkPointer(c: Checker, pointer: unknown, at: string, scope: Scope) {
  if (typeof pointer !== "string") return c.fault(at, "must be a JSON Pointer string");
  if (scope.floating && !pointer.startsWith("/")) return;
  let climbs = 0;
  for (let rest = pointer; rest === ".." || rest.startsWith("../"); rest = rest.slice(3)) climbs++;
  if (climbs > scope.base.length) {
    return c.fault(at, `"${pointer}" climbs above the root of the values; it has only ${scope.base.length} level${scope.base.length === 1 ? "" : "s"} to climb`);
  }
  const segments = resolveSegments(pointer, scope.base);
  if (segments.length > 0 && !resolveStatic(c, segments)) {
    c.fault(at, `"${pointer}" does not lead to a field. Absolute pointers start with /; others are relative to the enclosing object, and each ../ climbs one level.`, "warning");
  }
}

// ── Definitions ──────────────────────────────────────────────────────────────────────────

/** The scope a definition is checked in: it has no siblings of its own until it is placed. */
const DEF_SITE: Fields = {};

function checkDefs(c: Checker, defs: { readonly [name: string]: FieldDecl }) {
  const floating: Scope = { fields: DEF_SITE, groups: undefined, base: [], inItem: true, floating: true };
  for (const [name, decl] of Object.entries(defs)) {
    const at = `/defs/${escapeSegment(name)}`;
    if (!isUserName(name)) c.fault(at, `a definition's name starts with an uppercase letter, as all names you define do: "${toUserName(name)}"`);
    const builtin = Object.keys(c.format.presets).find((p) => isBuiltinName(p) && p.toLowerCase() === name.toLowerCase());
    if (builtin) c.fault(at, `differs from the built-in preset "${builtin}" only by case, which reads as a mistake`, "warning");
    checkDecl(c, decl, at, floating, [name]);
    const loop = requiresItself(c.spec.defs ?? {}, name);
    if (loop) {
      c.fault(at, `requires itself (${loop.join(" → ")}), so its value could never end. Make a step optional, or hold it in an array, set, record or map.`);
    }
  }
  const used = new Set<string>();
  JSON.stringify(c.spec, (key, value) => {
    if (key === "use" && typeof value === "string") used.add(value);
    return value;
  });
  for (const name of Object.keys(defs)) {
    if (!used.has(name)) c.fault(`/defs/${escapeSegment(name)}`, "is never used", "warning");
  }
  // Each use of a definition repeats it whole, so definitions that use one another several
  // times over double their value at each step. Said once, at the outermost such definition.
  const size = smallestSizes(c.spec);
  const huge = Object.keys(defs).filter((name) => size(name) > HUGE);
  const inside = new Set(huge.flatMap((name) => [...usesIn(defs[name])]));
  for (const name of huge) {
    if (inside.has(name)) continue;
    c.fault(
      `/defs/${escapeSegment(name)}`,
      `its smallest value holds more than ${HUGE.toLocaleString("en")} values, since each use of a definition repeats it whole; make some uses optional, or hold them in a list`,
      "warning",
    );
  }
}

/** More values than any form could hold or draw. */
const HUGE = 100_000;

/** The `use` names inside a declaration. */
function usesIn(decl: unknown): Set<string> {
  const names = new Set<string>();
  JSON.stringify(decl, (key, value) => {
    if (key === "use" && typeof value === "string") names.add(value);
    return value;
  });
  return names;
}

/** How many values a definition's smallest value holds: itself and every field it requires, all the way down. */
function smallestSizes(spec: Spec): (name: string) => number {
  const defs = spec.defs ?? {};
  const memo = new Map<string, number>();
  const ofDecl = (decl: FieldDecl): number => {
    if (!isObject(decl) || decl.optional || decl.default !== undefined) return 1;
    if (decl.use !== undefined && decl.type === undefined) return ofName(String(decl.use));
    let fields: Fields | undefined;
    if (decl.type === "object") fields = (decl as unknown as ObjectField).fields;
    if (decl.type === "variant") fields = Object.values((decl as unknown as VariantField).variants ?? {})[0]?.fields;
    let total = 1;
    for (const field of Object.values(fields ?? {})) total += ofDecl(field);
    return total;
  };
  const ofName = (name: string): number => {
    const known = memo.get(name);
    if (known !== undefined) return known;
    if (!isObject(defs[name])) return 1;
    memo.set(name, 1); // a definition that requires itself is reported on its own
    const total = ofDecl(defs[name]!);
    memo.set(name, total);
    return total;
  };
  return ofName;
}

function checkText(c: Checker, text: unknown, at: string, scope: Scope) {
  if (typeof text === "string") return;
  if (isObject(text) && EXPR_KEYS.some((k) => k in text)) return checkExpr(c, text, at, scope);
  c.fault(at, "must be a string or an expression ($template, $cond, $computed, $state)");
}

function checkExpr(c: Checker, expr: unknown, at: string, scope: Scope) {
  if (Array.isArray(expr)) return expr.forEach((e, i) => checkExpr(c, e, `${at}/${i}`, scope));
  if (!isObject(expr)) return;
  const keys = EXPR_KEYS.filter((k) => k in expr);
  if (keys.length === 0) {
    for (const [k, v] of Object.entries(expr)) checkExpr(c, v, `${at}/${escapeSegment(k)}`, scope);
    return;
  }
  if (keys.length > 1) return c.fault(at, `mixes ${keys.join(" and ")}; an expression has one of them`);
  const key = keys[0]!;
  const allowed: Record<string, string[]> = {
    $state: ["$state"],
    $item: ["$item"],
    $index: ["$index"],
    $computed: ["$computed", "args"],
    $cond: ["$cond", "$then", "$else"],
    $template: ["$template"],
  };
  for (const k of Object.keys(expr)) {
    if (!allowed[key]!.includes(k)) c.fault(`${at}/${escapeSegment(k)}`, `is not part of a ${key} expression`);
  }
  switch (key) {
    case "$state":
      return checkPointer(c, expr.$state, `${at}/$state`, scope);
    case "$item":
    case "$index":
      if (!scope.inItem) c.fault(at, `${key} works only inside an array item`);
      return;
    case "$computed":
      if (typeof expr.$computed !== "string") return c.fault(`${at}/$computed`, "must be a function name");
      if (!c.computed.has(expr.$computed)) c.computed.set(expr.$computed, `${at}/$computed`);
      if (expr.args !== undefined) {
        if (!isObject(expr.args)) c.fault(`${at}/args`, "must be an object of named arguments");
        else for (const [k, v] of Object.entries(expr.args)) checkExpr(c, v, `${at}/args/${escapeSegment(k)}`, scope);
      }
      return;
    case "$cond":
      checkCondition(c, expr.$cond, `${at}/$cond`, scope);
      if (!("$then" in expr) || !("$else" in expr)) c.fault(at, "a $cond needs both $then and $else");
      checkExpr(c, expr.$then, `${at}/$then`, scope);
      checkExpr(c, expr.$else, `${at}/$else`, scope);
      return;
    case "$template":
      if (typeof expr.$template !== "string") return c.fault(`${at}/$template`, "must be a string");
      for (const m of expr.$template.matchAll(/\$\{([^}]*)\}/g)) checkPointer(c, m[1]!.trim(), `${at}/$template`, scope);
  }
}

function checkCondition(c: Checker, cond: unknown, at: string, scope: Scope) {
  if (typeof cond === "boolean") return;
  if (Array.isArray(cond)) return cond.forEach((x, i) => checkCondition(c, x, `${at}/${i}`, scope));
  if (!isObject(cond)) return c.fault(at, "must be true/false, a condition object, an array (all hold), $and or $or");
  if ("$and" in cond || "$or" in cond) {
    const key = "$and" in cond ? "$and" : "$or";
    if (Object.keys(cond).length > 1) c.fault(at, `${key} stands alone; put other conditions inside it`);
    const list = cond[key];
    if (!Array.isArray(list)) return c.fault(`${at}/${key}`, "must be an array of conditions");
    return list.forEach((x, i) => checkCondition(c, x, `${at}/${key}/${i}`, scope));
  }
  const sources = ["$state", "$item", "$index", "$computed"].filter((k) => k in cond);
  if (sources.length !== 1) {
    return c.fault(at, sources.length === 0 ? "needs a value to test: $state, $item, $index or $computed" : `tests ${sources.join(" and ")}; a condition tests one value`);
  }
  const ops = OPERATORS.filter((op) => op in cond);
  if (ops.length > 1) c.fault(at, `has ${ops.join(" and ")}; use one operator per condition, and an array to require several`);
  for (const key of Object.keys(cond)) {
    if (key === sources[0] || key === "args" || key === "not" || (OPERATORS as readonly string[]).includes(key)) continue;
    c.fault(`${at}/${escapeSegment(key)}`, `is not part of a condition.${mean(key, [...OPERATORS, "not"])}`);
  }
  if (cond.not !== undefined && cond.not !== true) c.fault(`${at}/not`, "must be true, or left out");
  if (ops[0] === "in" && !Array.isArray(cond.in) && !isObject(cond.in)) c.fault(`${at}/in`, "must be an array, or an expression that yields one");
  const { not: _not, eq, neq, gt, gte, lt, lte, in: within, ...source } = cond;
  checkExpr(c, source, at, scope);
  for (const [op, operand] of Object.entries({ eq, neq, gt, gte, lt, lte, in: within })) {
    if (operand !== undefined) checkExpr(c, operand, `${at}/${op}`, scope);
  }
}

export { joinPointer };
