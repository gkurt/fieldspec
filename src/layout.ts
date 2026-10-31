/**
 * Resolving what to draw. A spec's fields, groups and `render`s become one tree of catalog
 * elements, which every renderer walks the same way. The tree is static: conditions and
 * expressions stay in it, unevaluated, for the renderer to evaluate against live values.
 *
 * `render` is one grammar everywhere: an element name, or `{ type, props, children, visible }`.
 * - On a field, a control element picks the field's control; a layout element arranges its
 *   parts (`label`, `control`, `help`, `errors`), which then need no `field`. On an object,
 *   a layout element arranges the object's fields instead.
 * - On a group, a layout element is the group's container; the group's label fills `title`.
 * - In `layouts`, it arranges the whole form.
 * - A container without `children` is filled with what is in scope. With children, whatever
 *   in scope they do not place follows them, or goes where they put `rest`.
 * - Without any `render`, fields draw in declaration order, or by `order` where fields give
 *   one; a grouped field brings its group, drawn where its first field would be.
 */
import { deref, usedName, type Lookup } from './defs.ts';
import { PARTS, type ElementDef } from './elements.ts';
import { registryOf, type Registry } from './registry.ts';
import type {
  ArrayField,
  Condition,
  Expr,
  FieldDecl,
  GroupDecl,
  MapField,
  ObjectField,
  RecordField,
  RenderElement,
  RenderNode,
  Resolved,
  Spec,
  VariantField,
} from './types.ts';

export interface LayoutNode {
  /** A catalog element: `stack`, `row`, `field`, `label`, `slider`, … */
  readonly type: string;
  /** Stable within the tree, for keyed rendering. */
  readonly key: string;
  readonly props: { readonly [name: string]: Expr };
  readonly children: readonly LayoutNode[];
  readonly visible?: Condition;
  /** For `field`, parts and controls: the field, as a pointer relative to the anchor (the enclosing object or item). */
  readonly field?: string;
  /** For `errors` over several fields. */
  readonly fields?: readonly string[];
  /** For `field`: its declaration, with `use` followed. */
  readonly decl?: Resolved;
  /**
   * For `field`: the control element that edits it, and that element's props. `explicit` when
   * the declaration (or its preset) names the control; absent when it is the kind's default.
   */
  readonly control?: { readonly type: string; readonly props: { readonly [name: string]: Expr }; readonly explicit?: true };
  /** For an object `field`: how its fields draw, anchored at the object. */
  readonly inner?: LayoutNode;
  /** For a variant `field`: how each variant's fields draw, anchored at the variant value. */
  readonly variants?: { readonly [name: string]: LayoutNode };
  /** For a list, set, record or map `field`: how one item draws, anchored at the item. */
  readonly item?: LayoutNode;
  /** For a `field` whose `render` is a layout: its parts, arranged. */
  readonly fragment?: LayoutNode;
  /** For nodes that stand for a group. */
  readonly group?: string;
  /** For a `field` built with `use`: the name it uses. */
  readonly use?: string;
}

type Fields = { readonly [key: string]: FieldDecl };
type Groups = { readonly [id: string]: GroupDecl } | undefined;

interface Ctx {
  readonly registry: Registry;
  readonly lookup: Lookup;
}

interface ScopeInfo {
  readonly fields: Fields;
  /** The fields in drawing order: by `order`, then as declared. */
  readonly ordered: readonly (readonly [string, FieldDecl])[];
  readonly groups: Groups;
  readonly ctx: Ctx;
  /** The groups being drawn, so one placed inside itself is refused instead of drawn forever. */
  readonly drawing: Set<string>;
  /** Each group's chain of parents, worked out once. */
  readonly chains: Map<string | undefined, readonly string[]>;
}

/** What a fragment placed, so the rest can follow it. */
interface Placed {
  readonly fields: Set<string>;
  readonly groups: Set<string>;
}

const REST = '\u0000rest';

/** The tree for a spec, or for one of its named layouts. */
export function layout(spec: Spec, view?: string, registry: Registry = registryOf(spec)): LayoutNode {
  const fragment = view === undefined ? undefined : spec.layouts?.[view];
  if (view !== undefined && fragment === undefined) throw new Error(`no layout named "${view}"`);
  const ctx: Ctx = { registry, lookup: { defs: spec.defs, presets: registry.presets } };
  return layoutScope(scopeOf(spec.fields, spec.groups, ctx), fragment, 'root');
}

/** The control element that edits a declaration unless its `render` names one. */
export function defaultControl(registry: Registry, decl: Resolved): string {
  const seen = new Set<string>();
  for (let name: string | undefined = decl.type; name !== undefined && !seen.has(name);) {
    seen.add(name);
    const kind = registry.kinds.get(name);
    const control = kind?.control;
    if (control !== undefined) return typeof control === 'string' ? control : control(decl);
    name = kind?.base;
  }
  return 'input';
}

/** The element a render node names, as an element object; placement shorthands stay as they are. */
function asElement(node: RenderNode): RenderElement | { field: string } | { group: string } {
  return typeof node === 'string' ? { type: node } : node;
}

function roleOf(ctx: Ctx, type: string): ElementDef['role'] | undefined {
  return ctx.registry.elements.get(type)?.role;
}

function takesChildren(ctx: Ctx, type: string): boolean {
  const def = ctx.registry.elements.get(type);
  return def ? def.children === true : true;
}

function scopeOf(fields: Fields, groups: Groups, ctx: Ctx): ScopeInfo {
  const rank = (decl: FieldDecl) => {
    const order = deref(ctx.lookup, decl).order;
    return typeof order === 'number' && Number.isFinite(order) ? order : 0;
  };
  // Sorting is stable, so equal ranks keep declaration order.
  const ordered = Object.entries(fields)
    .map(([key, decl]) => [key, decl, rank(decl)] as const)
    .sort((a, b) => a[2] - b[2])
    .map(([key, decl]) => [key, decl] as const);
  return { fields, ordered, groups, ctx, drawing: new Set(), chains: new Map() };
}

function layoutScope(scope: ScopeInfo, fragment: RenderNode | undefined, key: string): LayoutNode {
  if (fragment === undefined) {
    return stack(
      key,
      autoNodes(
        scope,
        scope.ordered.map(([k]) => k),
        key,
      ),
    );
  }
  const placed: Placed = { fields: new Set(), groups: new Set() };
  const resolved = resolveNode(scope, fragment, `${key}.f`, placed);
  return fillRest(resolved, scope, unplaced(scope, placed, undefined), key);
}

function stack(key: string, children: LayoutNode[]): LayoutNode {
  return { type: 'stack', key, props: {}, children };
}

const groupOf = (scope: ScopeInfo, decl: FieldDecl) => deref(scope.ctx.lookup, decl).group;

/** Fields not placed, directly or through their group. Limited to `members` when given. */
function unplaced(scope: ScopeInfo, placed: Placed, members: Set<string> | undefined): string[] {
  return scope.ordered
    .filter(([key, decl]) => {
      if (placed.fields.has(key)) return false;
      if (members && !members.has(key)) return false;
      for (const id of chainOf(scope, groupOf(scope, decl))) if (placed.groups.has(id)) return false;
      return true;
    })
    .map(([key]) => key);
}

/** A group and its parents, innermost first. */
function chainOf(scope: ScopeInfo, start: string | undefined): readonly string[] {
  let chain = scope.chains.get(start);
  if (chain) return chain;
  const seen = new Set<string>();
  for (let id = start; id !== undefined && scope.groups?.[id] && !seen.has(id); id = scope.groups[id]!.group) seen.add(id);
  chain = [...seen];
  scope.chains.set(start, chain);
  return chain;
}

/** Replace `rest` with the unplaced, or put them after the fragment. */
function fillRest(node: LayoutNode, scope: ScopeInfo, keys: string[], key: string, within?: string): LayoutNode {
  let filled = false;
  const replace = (n: LayoutNode): LayoutNode => {
    if (n.type === REST) {
      filled = true;
      return stack(n.key, autoNodes(scope, keys, n.key, within));
    }
    if (!n.children.some((c) => c.type === REST || c.children.length > 0)) return n;
    // A rest standing alone in a container gives its nodes to the container directly.
    if (n.children.length === 1 && n.children[0]!.type === REST) {
      filled = true;
      return { ...n, children: autoNodes(scope, keys, n.children[0]!.key, within) };
    }
    return { ...n, children: n.children.map(replace) };
  };
  const out = replace(node);
  if (filled || keys.length === 0) return out;
  return stack(key, [out, ...autoNodes(scope, keys, `${key}.r`, within)]);
}

/**
 * Nodes for these fields in drawing order. A grouped field brings the outermost group below
 * `within` that holds it, once.
 */
function autoNodes(scope: ScopeInfo, keys: readonly string[], key: string, within?: string): LayoutNode[] {
  const out: LayoutNode[] = [];
  const wanted = new Set(keys);
  const emitted = new Set<string>();
  for (const [name, decl] of scope.ordered) {
    if (!wanted.has(name)) continue;
    const chain = chainOf(scope, groupOf(scope, decl));
    const stop = within === undefined ? chain.length : chain.indexOf(within);
    const outer = stop > 0 ? chain[stop - 1] : undefined;
    if (outer === undefined) {
      out.push(fieldNode(scope.ctx, decl, name, `${key}.${name}`));
    } else if (!emitted.has(outer)) {
      emitted.add(outer);
      out.push(groupNode(scope, outer, `${key}.g.${outer}`, keys));
    }
  }
  return out;
}

/** A group, drawn on its own: its `render` as container, titled by its label. `limit` restricts it to fields still to be drawn. */
function groupNode(scope: ScopeInfo, id: string, key: string, limit?: readonly string[]): LayoutNode {
  // Placed in its own render, or reached again through groups nested in a cycle (both reported by the checker).
  if (scope.drawing.has(id)) return insideItself(id, key);
  scope.drawing.add(id);
  try {
    return drawGroup(scope, id, key, limit);
  } finally {
    scope.drawing.delete(id);
  }
}

const insideItself = (id: string, key: string): LayoutNode => ({
  type: 'text',
  key,
  props: { text: `Group "${id}" is placed inside itself`, tone: 'warning' },
  children: [],
});

function drawGroup(scope: ScopeInfo, id: string, key: string, limit?: readonly string[]): LayoutNode {
  const group = scope.groups![id]!;
  const members = new Set(
    Object.entries(scope.fields)
      .filter(([name, decl]) => chainOf(scope, groupOf(scope, decl)).includes(id) && (!limit || limit.includes(name)))
      .map(([name]) => name),
  );
  const el = asElement(group.render ?? 'stack');
  const container: RenderElement = 'type' in el ? el : { type: 'stack', children: [el] };
  const def = scope.ctx.registry.elements.get(container.type);
  const props: Record<string, Expr> = { ...container.props };
  if (def?.props?.title && props.title === undefined && group.label !== undefined) props.title = group.label as Expr;
  if (def?.props?.description && props.description === undefined && group.description !== undefined)
    props.description = group.description as Expr;
  const placed: Placed = { fields: new Set(), groups: new Set() };
  const resolved = resolveNode(scope, { ...container, props }, `${key}.f`, placed);
  const left = unplaced(scope, placed, members);
  return {
    ...fillRest(resolved, scope, left, `${key}.s`, id),
    key,
    group: id,
    ...(group.visible !== undefined && { visible: group.visible }),
  };
}

/**
 * A `field` node: the field's whole presentation, with its inside for containers. Insides are
 * built when first read, so a definition that contains itself makes a tree only as deep as a
 * renderer walks it, which is as deep as the values go.
 */
function fieldNode(ctx: Ctx, raw: FieldDecl, ref: string, key: string, visible?: Condition): LayoutNode {
  const decl = deref(ctx.lookup, raw);
  const render = decl.render === undefined ? undefined : asElement(decl.render);
  const chosen = render && 'type' in render && roleOf(ctx, render.type) === 'control' ? render : undefined;
  const arranged = render && 'type' in render && !chosen ? render : undefined;
  const node: Record<string, unknown> = {
    type: 'field',
    key,
    props: {},
    children: [],
    field: ref,
    decl,
    control: chosen
      ? { type: chosen.type, props: chosen.props ?? {}, explicit: true }
      : { type: defaultControl(ctx.registry, decl), props: {} },
    ...(visible !== undefined && { visible }),
    ...(usedName(raw) !== undefined && { use: usedName(raw) }),
  };
  const lazy = (prop: string, build: () => unknown) => {
    let built: unknown;
    Object.defineProperty(node, prop, { enumerable: true, get: () => (built ??= build()) });
  };
  switch (decl.type) {
    case 'object': {
      const o = decl as ObjectField;
      lazy('inner', () => layoutScope(scopeOf(o.fields, o.groups, ctx), arranged, `${key}.o`));
      return node as unknown as LayoutNode;
    }
    case 'variant': {
      const v = decl as VariantField;
      lazy('variants', () => {
        const variants: Record<string, LayoutNode> = {};
        for (const [name, variant] of Object.entries(v.variants))
          variants[name] = layoutScope(scopeOf(variant.fields, variant.groups, ctx), undefined, `${key}.v.${name}`);

        return variants;
      });
      break;
    }
    case 'array':
    case 'set':
      lazy('item', () => fieldNode(ctx, (decl as ArrayField).items, '', `${key}.i`));
      break;
    case 'record':
    case 'map':
      lazy('item', () => fieldNode(ctx, (decl as RecordField | MapField).values, '', `${key}.i`));
      break;
  }
  if (arranged) node.fragment = resolvePart(ctx, arranged, `${key}.p`, ref);
  return node as unknown as LayoutNode;
}

/** A field's own layout: its parts and controls refer to the field itself. */
function resolvePart(ctx: Ctx, node: RenderNode, key: string, self: string): LayoutNode {
  const el = asElement(node);
  if (!('type' in el)) return { type: 'control', key, props: {}, children: [], field: self };
  const role = roleOf(ctx, el.type);
  const bound = role === 'part' || role === 'control';
  const children =
    el.children?.map((c, i) => resolvePart(ctx, c, `${key}.${i}`, self)) ??
    (bound || !takesChildren(ctx, el.type)
      ? []
      : ['label', 'control', 'help', 'errors'].map((t, i) => resolvePart(ctx, t, `${key}.${i}`, self)));
  return {
    type: el.type,
    key,
    props: el.props ?? {},
    ...(el.visible !== undefined && { visible: el.visible }),
    children,
    ...(bound && { field: self }),
  };
}

function declOf(ctx: Ctx, fields: Fields, ref: string): FieldDecl | undefined {
  let decl: FieldDecl | undefined;
  let scope: Fields | undefined = fields;
  for (const segment of ref.split('/')) {
    decl = scope?.[segment];
    if (!decl) return undefined;
    const real = deref(ctx.lookup, decl);
    scope = real.type === 'object' ? (real as ObjectField).fields : undefined;
  }
  return decl;
}

function resolveNode(scope: ScopeInfo, node: RenderNode, key: string, placed: Placed): LayoutNode {
  const el = asElement(node);
  if ('field' in el && !('type' in el)) return placeField(scope, el.field, key, placed);
  if ('group' in el && !('type' in el)) return placeGroup(scope, el.group, key, placed);
  const { type } = el as RenderElement;
  const props = (el as RenderElement).props ?? {};
  const visible = (el as RenderElement).visible;
  switch (type) {
    case 'field':
      return placeField(scope, typeof props.field === 'string' ? props.field : '', key, placed, visible);
    case 'group':
      return placeGroup(scope, typeof props.group === 'string' ? props.group : '', key, placed);
    case 'rest':
      return { type: REST, key, props: {}, children: [] };
  }
  const role = roleOf(scope.ctx, type);
  if (role === 'part' || role === 'control' || PARTS.has(type)) {
    return {
      type,
      key,
      props,
      ...(visible !== undefined && { visible }),
      children: [],
      ...(typeof props.field === 'string' && { field: props.field }),
      ...(Array.isArray(props.fields) && { fields: props.fields as string[] }),
    };
  }
  const given = (el as RenderElement).children;
  const children =
    given?.map((c, i) => resolveNode(scope, c, `${key}.${i}`, placed)) ??
    (takesChildren(scope.ctx, type) ? [{ type: REST, key: `${key}.rest`, props: {}, children: [] }] : []);
  return { type, key, props, ...(visible !== undefined && { visible }), children };
}

function placeField(scope: ScopeInfo, ref: string, key: string, placed: Placed, visible?: Condition): LayoutNode {
  const decl = declOf(scope.ctx, scope.fields, ref);
  if (!decl) return { type: 'text', key, props: { text: `Unknown field "${ref}"`, tone: 'warning' }, children: [] };
  placed.fields.add(ref);
  return fieldNode(scope.ctx, decl, ref, key, visible);
}

function placeGroup(scope: ScopeInfo, id: string, key: string, placed: Placed): LayoutNode {
  if (!scope.groups?.[id]) return { type: 'text', key, props: { text: `Unknown group "${id}"`, tone: 'warning' }, children: [] };
  // Refused, it is not placed: its fields still follow.
  if (scope.drawing.has(id)) return insideItself(id, key);
  placed.groups.add(id);
  return groupNode(scope, id, key);
}

/**
 * Every node in a tree, depth first, including containers' insides. A definition's inside is
 * entered once per branch, so a recursive one ends.
 */
export function* walk(node: LayoutNode, within: ReadonlySet<string> = new Set()): Generator<LayoutNode> {
  yield node;
  for (const child of node.children) yield* walk(child, within);
  if (node.use !== undefined && within.has(node.use)) return;
  const inside = node.use === undefined ? within : new Set([...within, node.use]);
  if (node.inner) yield* walk(node.inner, inside);
  if (node.item) yield* walk(node.item, inside);
  if (node.fragment) yield* walk(node.fragment, inside);
  for (const v of Object.values(node.variants ?? {})) yield* walk(v, inside);
}
