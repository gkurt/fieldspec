/**
 * json-render interop. Fragments are written nested here and flat there (`{ root, elements }`
 * with children by key); both directions are lossless. `toJsonRender` turns a whole form into
 * a json-render spec bound to state, drawn with the components of `@json-render/shadcn`'s
 * catalog (rename them with `components`). Lists, sets, records and maps repeat over state with
 * add and remove buttons; a definition that contains itself is unrolled `depth` levels deep.
 * Conditions and expressions share json-render's grammar and pass through with their pointers
 * rewritten for json-render's state. An expression with code in it (`$cel`, `$js`, `$computed`)
 * becomes a call to one function, which `jsonRenderFunctions` gives, and which runs it as
 * fieldspec does; a condition with code in it cannot run there, and holds.
 *
 * json-render's state holds the values as JSON, except where its components need otherwise:
 * records and maps are lists of `{ key, value }` entries, an enum's value (and a variant's key)
 * is its label as text, or its value where the labels are not plain and distinct, a set of enum
 * values is one comma-separated string, and a `json` field is JSON text.
 * `toJsonRenderState` and `fromJsonRenderState` convert.
 */
import { deref, type Lookup } from './defs.ts';
import { evaluate, LANGUAGE_KEYS, textOf, type Env, type Functions } from './expr.ts';
import { createForm, humanize } from './form.ts';
import { defaultControl, type LayoutNode } from './layout.ts';
import { getAt, parsePointer, resolvePointer } from './pointer.ts';
import { functionsOf, registryOf, type Registry } from './registry.ts';
import type {
  ArrayField,
  Condition,
  EnumField,
  EnumOption,
  Expr,
  FieldDecl,
  Json,
  MapField,
  ObjectField,
  OptionValue,
  RecordField,
  RenderElement,
  RenderNode,
  Resolved,
  Spec,
  VariantField,
} from './types.ts';
import { ctxOf, decode, decodeField, encodeField, initialValue } from './values.ts';

export interface FlatElement {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: string[];
  readonly visible?: unknown;
  readonly repeat?: { readonly statePath: string | { readonly $item: string } };
  readonly on?: Record<string, unknown>;
}

export interface FlatSpec {
  readonly root: string;
  readonly elements: Record<string, FlatElement>;
  readonly state?: Record<string, unknown>;
}

/** A nested fragment as json-render's flat element map. */
export function toFlat(node: RenderNode, prefix = 'el'): FlatSpec {
  const elements: Record<string, FlatElement> = {};
  let n = 0;
  const add = (node: RenderNode): string => {
    const key = `${prefix}-${n++}`;
    if (typeof node === 'string') {
      elements[key] = { type: node, props: {}, children: [] };
    } else if ('field' in node && !('type' in node)) {
      elements[key] = { type: 'field', props: { field: node.field }, children: [] };
    } else if ('group' in node && !('type' in node)) {
      elements[key] = { type: 'group', props: { group: node.group }, children: [] };
    } else {
      const el = node as RenderElement;
      const entry: { -readonly [K in keyof FlatElement]: FlatElement[K] } = { type: el.type, props: { ...el.props }, children: [] };
      if (el.visible !== undefined) entry.visible = el.visible;
      elements[key] = entry;
      entry.children = (el.children ?? []).map(add);
    }
    return key;
  };
  return { root: add(node), elements };
}

/** json-render's flat element map as a nested fragment. */
export function fromFlat(flat: FlatSpec): RenderNode {
  const seen = new Set<string>();
  const build = (key: string): RenderNode => {
    if (seen.has(key)) throw new Error(`element "${key}" is reached twice`);
    seen.add(key);
    const el = flat.elements[key];
    if (!el) throw new Error(`no element "${key}"`);
    const props = Object.keys(el.props).length > 0 ? (el.props as Record<string, Expr>) : undefined;
    return {
      type: el.type,
      ...(props && { props }),
      ...(el.children.length > 0 && { children: el.children.map(build) }),
      ...(el.visible !== undefined && { visible: el.visible as Condition }),
    };
  };
  return build(flat.root);
}

export interface ToJsonRenderOptions {
  readonly view?: string;
  /** Where the values live in json-render's state. Default `/form`. */
  readonly statePath?: string;
  /** Where the output keeps its own state, such as the open tab. Default `/ui`. */
  readonly uiStatePath?: string;
  readonly values?: unknown;
  readonly registry?: Registry;
  /** The catalog component each element becomes, where yours differ from `@json-render/shadcn`'s. */
  readonly components?: Partial<Record<string, string>>;
  /** How many levels deep a definition that contains itself is drawn. Default 3. */
  readonly depth?: number;
  /**
   * The most elements to draw; past it, fields are left out with a note. Definitions that use
   * one another several times over double the drawing at each level, and json-render has no
   * way to draw one part twice. Default 20 000.
   */
  readonly maxElements?: number;
}

export interface JsonRenderStateOptions {
  /** Where the values live in json-render's state. Default `/form`. */
  readonly statePath?: string;
  readonly registry?: Registry;
}

/** The component each element becomes. Their props follow `@json-render/shadcn`'s catalog. */
const COMPONENTS: Record<string, string> = {
  stack: 'Stack',
  row: 'Stack',
  columns: 'Grid',
  collapsible: 'Collapsible',
  scroll: 'Stack',
  tabs: 'Tabs',
  card: 'Card',
  text: 'Text',
  divider: 'Separator',
  button: 'Button',
  input: 'Input',
  textarea: 'Textarea',
  select: 'Select',
  radio: 'Radio',
  segmented: 'ToggleGroup',
  checks: 'ToggleGroup',
  checkbox: 'Checkbox',
  switch: 'Switch',
  slider: 'Slider',
  date: 'Input',
  color: 'Input',
  file: 'Input',
};

/**
 * The actions `toJsonRender`'s output uses beyond json-render's built-in ones, to declare in
 * your catalog: removing an item of a list that is itself inside a list item, where
 * `removeState` cannot name the list.
 */
export const JSON_RENDER_ACTIONS = {
  removeItem: { description: 'Remove the list item at a state path, given as `path`.' },
} as const;

/** Handlers for {@link JSON_RENDER_ACTIONS}, over json-render's state store. Pass them to `ActionProvider`. */
export function jsonRenderActions(store: { get(path: string): unknown; set(path: string, value: unknown): void }) {
  return {
    removeItem(params: Record<string, unknown> | undefined) {
      const path = params?.path;
      if (typeof path !== 'string') return;
      const at = path.lastIndexOf('/');
      const list = store.get(path.slice(0, at));
      const index = Number(path.slice(at + 1));
      if (Array.isArray(list)) {
        store.set(
          path.slice(0, at),
          list.filter((_, i) => i !== index),
        );
      }
    },
  };
}

type Props = Record<string, unknown>;
/** Where a value is, from where an element sits: in state, or relative to the current repeat item. */
type Ref = { readonly state: string } | { readonly item: string };

interface Cx {
  /** The state paths (relative to the values) of the repeat items we are inside, innermost last. `*` stands for the index. */
  readonly repeats: readonly string[];
  /** How many times each definition is being drawn inside itself. */
  readonly uses: ReadonlyMap<string, number>;
  /** In a field's own layout: that field. */
  readonly self?: { readonly decl: Resolved; readonly path: string; readonly label: unknown };
}

/** A whole form as a json-render spec, with its values in `state`. */
export function toJsonRender(spec: Spec, options: ToJsonRenderOptions = {}): FlatSpec {
  const registry = options.registry ?? registryOf(spec);
  const lookup: Lookup = { defs: spec.defs, presets: registry.presets };
  const form = createForm(spec, { values: options.values, registry });
  const base = options.statePath ?? '/form';
  const ui = options.uiStatePath ?? '/ui';
  const depth = options.depth ?? 3;
  const maxElements = options.maxElements ?? 20_000;
  const components = { ...COMPONENTS, ...options.components } as Record<string, string>;
  const elements: Record<string, FlatElement> = {};
  const uiState: Record<string, unknown> = {};
  let n = 0;

  const add = (el: FlatElement): string => {
    const key = `fs-${n++}`;
    elements[key] = el;
    return key;
  };
  const component = (element: string) => components[element] ?? element;
  const el = (element: string, props: Props, children: string[] = [], extra: Partial<FlatElement> = {}) =>
    add({ type: component(element), props, children, ...extra });
  const note = (text: string) => el('text', { text, variant: 'muted' });

  const refOf = (path: string, cx: Cx): Ref | undefined => {
    const inner = cx.repeats.at(-1);
    if (inner !== undefined && (path === inner || path.startsWith(`${inner}/`))) return { item: path.slice(inner.length + 1) };
    if (path.includes('/*')) return undefined; // An outer repeat's item: json-render reads only the innermost.
    return { state: base + path };
  };
  const bind = (path: string, cx: Cx) => {
    const ref = refOf(path, cx);
    return ref && 'item' in ref ? { $bindItem: ref.item } : { $bindState: ref?.state ?? base + path };
  };
  /** A condition or expression without code, with its pointers made to read json-render's state. */
  const rebase = (value: unknown, anchor: string, cx: Cx): unknown => {
    if (Array.isArray(value)) return value.map((v) => rebase(v, anchor, cx));
    if (!value || typeof value !== 'object') return value;
    // A comparison with an enum compares what json-render's state holds for it.
    const read = value as Props;
    const inner = cx.repeats.at(-1);
    const compared =
      typeof read.$state === 'string'
        ? resolvePointer(read.$state, anchor)
        : typeof read.$item === 'string' && inner !== undefined
          ? resolvePointer(read.$item, inner)
          : undefined;
    const choices = compared === undefined ? undefined : choicesOf(declOf(spec, lookup, compared));
    const out: Props = {};
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'eq' || k === 'neq') && choices && !isObject(v)) {
        out[k] = choices.find((c) => c.value === v)?.state ?? v;
      } else if (k === '$state' && typeof v === 'string') {
        const ref = refOf(resolvePointer(v, anchor), cx);
        if (ref && 'item' in ref) out.$item = ref.item;
        else out.$state = ref?.state ?? base + resolvePointer(v, anchor);
      } else if (k === '$template' && typeof v === 'string') {
        out[k] = v.replace(/\$\{([^}]*)\}/g, (_, p: string) => {
          const ref = refOf(resolvePointer(p.trim(), anchor), cx);
          return `\${${ref && 'item' in ref ? ref.item : (ref?.state ?? '')}}`;
        });
      } else if (k === 'in' && Array.isArray(v)) {
        // json-render has no `in`: a list of literals becomes alternatives.
        const { in: _in, not, ...leaf } = value as Props;
        const either = { $or: v.map((option) => rebase({ ...leaf, eq: option }, anchor, cx)) };
        return not ? negate(either) : either;
      } else {
        out[k] = rebase(v, anchor, cx);
      }
    }
    return out;
  };
  /** An expression. One with code, or one wanted as text, becomes a call that runs it with the values it reads. */
  const expr = (value: unknown, anchor: string, cx: Cx, asText = false): unknown => {
    if (!asText && !hasCode(value)) return rebase(value, anchor, cx);
    const item = cx.repeats.at(-1);
    const reads = [...readsOf(value, anchor, item)];
    const call: Call = { expr: value as Expr, base: anchor, ...(item !== undefined && { item }), reads, ...(asText && { asText }) };
    const args: Props = { [CALL]: JSON.stringify(call) };
    reads.forEach((path, i) => (args[`r${i}`] = rebase({ $state: path }, '', cx)));
    if (item !== undefined) args[INDEX] = { $index: true };
    return { $computed: BRIDGE, args };
  };
  const visibleOf = (conditions: readonly (Condition | undefined)[], anchor: string, cx: Cx) => {
    const all = conditions.filter((c) => c !== undefined).map((c) => rebase(withoutCode(c), anchor, cx));
    return all.length === 0 ? {} : { visible: all.length === 1 ? all[0] : all };
  };
  const text = (value: unknown, anchor: string, cx: Cx) => (value === undefined ? undefined : expr(value, anchor, cx));

  /** A control element bound to the field at `path`. */
  const control = (decl: Resolved, element: string, own: Props, path: string, anchor: string, label: unknown, cx: Cx): string => {
    const name = path.slice(1) || 'value';
    const value = bind(path, cx);
    const placeholder = typeof decl.placeholder === 'string' ? { placeholder: decl.placeholder } : {};
    const caption = (inner: string) =>
      label === undefined
        ? inner
        : el('stack', { direction: 'vertical', gap: 'sm' }, [el('text', { text: label, variant: 'caption' }), inner]);
    // `checks` edits a set: its options are its items'.
    const options = () => choicesOf(element === 'checks' ? deref(lookup, (decl as ArrayField).items) : decl);
    let key: string;
    switch (element) {
      case 'input':
      case 'autocomplete':
      case 'date':
      case 'color':
      case 'file': {
        const numeric = decl.type === 'number' || decl.type === 'int';
        const kind =
          own.secret === true ? 'password' : numeric ? 'number' : (decl as { format?: string }).format === 'email' ? 'email' : 'text';
        // json-render's inputs have no suggestions: an autocomplete is a plain text box there.
        key = el(element === 'autocomplete' ? 'input' : element, { label: label ?? '', name, type: kind, ...placeholder, value });
        break;
      }
      case 'textarea':
        key = el(element, { label: label ?? '', name, ...placeholder, ...(typeof own.rows === 'number' && { rows: own.rows }), value });
        break;
      case 'select':
      case 'radio': {
        const list = options();
        if (!list) return note(`${textOf(label ?? name)}: options from an expression are not supported in json-render output`);
        key = el(element, { label: label ?? '', name, options: list.map((o) => o.state), ...(element === 'select' && placeholder), value });
        break;
      }
      case 'segmented':
      case 'checks': {
        const items = options();
        if (!items) return note(`${textOf(label ?? name)}: options from an expression are not supported in json-render output`);
        key = caption(
          el(element, {
            items: items.map((o) => ({ label: expr(o.label, anchor, cx), value: o.state })),
            type: element === 'checks' ? 'multiple' : 'single',
            value,
          }),
        );
        break;
      }
      case 'checkbox':
      case 'switch':
        key = el(element, { label: label ?? '', name, checked: value });
        break;
      case 'slider': {
        const d = decl as { min?: number; max?: number; step?: number };
        key = el(element, {
          label: label ?? null,
          min: d.min ?? 0,
          max: d.max ?? 100,
          step: d.step ?? (decl.type === 'int' ? 1 : null),
          value,
        });
        break;
      }
      default: {
        if (registry.elements.has(element) && !components[element])
          return note(`${textOf(label ?? name)}: no json-render component draws "${element}"`);
        // An application's own control: its props pass through, with the value bound.
        const props: Props = { ...(label !== undefined && { label }), value };
        for (const [k, v] of Object.entries(own)) props[k] = expr(v, anchor, cx);
        key = el(element, props);
      }
    }
    const help = decl.description ?? decl.hint;
    return help === undefined
      ? key
      : el('stack', { direction: 'vertical', gap: 'sm' }, [key, el('text', { text: text(help, anchor, cx), variant: 'muted' })]);
  };

  /** A list, set, record or map: its items repeated over state, each with a remove button, and an add button. */
  const collection = (node: LayoutNode, decl: Resolved, path: string, anchor: string, label: unknown, cx: Cx): string => {
    const element = node.control?.type ?? defaultControl(registry, decl);
    if (element === 'checks') return control(decl, element, node.control?.props ?? {}, path, anchor, label, cx);
    const list = refOf(path, cx);
    if (!list) return note(`${textOf(label ?? path)}: a list inside an outer list's item is out of json-render's reach here`);
    const entries = decl.type === 'record' || decl.type === 'map';
    const item = `${path}/*`;
    const inner: Cx = { ...cx, repeats: [...cx.repeats, item] };
    const content: string[] = [];
    if (entries) {
      const keyDecl = decl.type === 'map' ? deref(lookup, (decl as MapField).keys) : ({ type: 'string' } as Resolved);
      content.push(control(keyDecl, defaultControl(registry, keyDecl), {}, `${item}/key`, item, 'Key', inner));
    }
    if (node.item) content.push(field(node.item, entries ? `${item}/value` : item, inner, entries ? 'Value' : undefined));
    const remove =
      'state' in list
        ? { action: 'removeState', params: { statePath: list.state, index: { $index: true } } }
        : { action: 'removeItem', params: { path: { $item: '' } } };
    const row = el('stack', { direction: 'horizontal', gap: 'sm', align: 'start' }, [
      el('stack', { direction: 'vertical', gap: 'sm' }, content),
      el('button', { label: 'Remove', variant: 'secondary' }, [], { on: { press: remove } }),
    ]);
    const statePath = 'state' in list ? list.state : { $item: list.item };
    const repeated = el('stack', { direction: 'vertical', gap: 'md' }, [row], { repeat: { statePath } });
    const itemDecl = entries ? (decl as RecordField | MapField).values : (decl as ArrayField).items;
    const fresh = stateOf(registry, lookup, deref(lookup, itemDecl), initialJson(itemDecl));
    const push = {
      action: 'pushState',
      params: {
        statePath,
        value: entries
          ? {
              key:
                decl.type === 'map'
                  ? stateOf(registry, lookup, deref(lookup, (decl as MapField).keys), initialJson((decl as MapField).keys))
                  : '',
              value: fresh,
            }
          : fresh,
      },
    };
    const children = [
      ...(label !== undefined ? [el('text', { text: label, variant: 'caption' })] : []),
      repeated,
      el('button', { label: 'Add', variant: 'secondary' }, [], { on: { press: push } }),
    ];
    return el('stack', { direction: 'vertical', gap: 'sm' }, children);
  };
  const valueCx = ctxOf(spec, { registry });
  /** A new item's value, as JSON. */
  const initialJson = (decl: FieldDecl): Json => {
    const value = initialValue(spec, decl, form.values, '', { registry });
    return value === undefined ? null : (encodeField(valueCx, decl, value) as Json);
  };

  /** A field: its control, or for containers their insides. `label` stands in for items, which have none of their own. */
  const field = (node: LayoutNode, anchor: string, cx: Cx, itemLabel?: string): string => {
    const decl = node.decl!;
    const path = resolvePointer(node.field ?? '', anchor);
    const isItem = node.field === '';
    const label =
      decl.label !== undefined ? text(decl.label, anchor, cx) : isItem ? itemLabel : humanize(path.slice(path.lastIndexOf('/') + 1));
    const visible = visibleOf([node.visible, decl.visible], anchor, cx);
    if (n >= maxElements) return note(`${textOf(label ?? path)}: not drawn; the output reached ${maxElements} elements`);
    if (node.use !== undefined) {
      const seen = cx.uses.get(node.use) ?? 0;
      if (seen >= depth) return note(`${textOf(label ?? path)}: drawn ${depth} levels deep; deeper levels are not shown`);
      cx = { ...cx, uses: new Map(cx.uses).set(node.use, seen + 1) };
    }
    const withVisible = (key: string) => (visible.visible === undefined ? key : ((elements[key] = { ...elements[key]!, ...visible }), key));
    if (node.inner) {
      const inner = emit(node.inner, path, { ...cx, self: undefined });
      return withVisible(label === undefined ? inner : el('card', { title: label }, [inner]));
    }
    if (node.variants) {
      const v = decl as VariantField;
      const keyPath = `${path}/${v.key}`;
      const names = keyOf(v);
      const picker = control(names, 'segmented', {}, keyPath, path, label, cx);
      const key = refOf(keyPath, cx);
      const branches = Object.entries(node.variants).map(([name, inner]) => {
        const branch = emit(inner, path, { ...cx, self: undefined });
        const held = choicesOf(names)?.find((c) => c.value === name)?.state ?? name;
        const on = key && 'item' in key ? { $item: key.item, eq: held } : { $state: key?.state ?? base + keyPath, eq: held };
        elements[branch] = { ...elements[branch]!, visible: on };
        return branch;
      });
      return withVisible(el('stack', { direction: 'vertical', gap: 'md' }, [picker, ...branches]));
    }
    if (node.item || ['array', 'set', 'record', 'map'].includes(decl.type))
      return withVisible(collection(node, decl, path, anchor, label, cx));
    // A derived value follows the others as they change: shown, not edited.
    if (decl.value !== undefined && decl.type !== 'object') {
      const shown = el('text', { text: expr(decl.value, anchor, cx, true), variant: 'body' });
      const captioned = label === undefined ? [shown] : [el('text', { text: label, variant: 'caption' }), shown];
      return withVisible(el('stack', { direction: 'vertical', gap: 'sm' }, captioned));
    }
    if (node.fragment) return withVisible(emit(node.fragment, anchor, { ...cx, self: { decl, path, label } }));
    return withVisible(control(decl, node.control?.type ?? 'input', node.control?.props ?? {}, path, anchor, label, cx));
  };

  const emit = (node: LayoutNode, anchor: string, cx: Cx): string => {
    if (node.type === 'field' && node.decl) return field(node, anchor, cx);
    const props = node.props as Props;
    const visible = visibleOf([node.visible], anchor, cx);
    const self = cx.self;
    const kids = () => node.children.map((c) => emit(c, anchor, cx));
    const titled = (inner: string) =>
      props.title === undefined
        ? inner
        : el(
            'card',
            {
              title: text(props.title, anchor, cx),
              ...(props.description !== undefined && { description: text(props.description, anchor, cx) }),
            },
            [inner],
          );
    let key: string;
    switch (node.type) {
      case 'stack':
      case 'row':
        key = titled(el(node.type, { direction: node.type === 'row' ? 'horizontal' : 'vertical', gap: 'md' }, kids()));
        break;
      case 'columns':
        key = titled(el('columns', { columns: typeof props.count === 'number' ? props.count : 2, gap: 'md' }, kids()));
        break;
      case 'scroll': {
        // shadcn's Stack takes Tailwind classes; the arbitrary height needs Tailwind to see this class.
        const height =
          typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : typeof props.maxHeight === 'string' ? props.maxHeight : '20rem';
        key = titled(el('scroll', { direction: 'vertical', gap: 'md', className: `overflow-y-auto max-h-[${height}]` }, kids()));
        break;
      }
      case 'collapsible':
        key = el('collapsible', { title: text(props.title, anchor, cx) ?? '', defaultOpen: props.collapsed !== true }, kids());
        break;
      case 'tabs': {
        const at = `${ui}/tabs${n}`;
        const tabs = node.children.map((c, i) => ({
          label: typeof c.props.title === 'string' ? c.props.title : `Tab ${i + 1}`,
          value: `tab-${i}`,
        }));
        const panes = node.children.map((c, i) => {
          const pane = emit(c, anchor, cx);
          elements[pane] = { ...elements[pane]!, visible: { $state: at, eq: `tab-${i}` } };
          return pane;
        });
        setState(uiState, at.slice(ui.length), 'tab-0');
        key = el('tabs', { tabs, value: { $bindState: at } }, panes);
        break;
      }
      case 'text':
        key = el('text', { text: text(props.text, anchor, cx) ?? '', variant: props.tone === 'muted' ? 'muted' : 'body' });
        break;
      case 'divider':
        key = el('divider', { orientation: 'horizontal' });
        break;
      case 'label':
        key = el('text', { text: text(props.text, anchor, cx) ?? self?.label ?? '', variant: 'caption' });
        break;
      case 'help': {
        const help = self?.decl.description ?? self?.decl.hint;
        key = el('text', { text: text(help, anchor, cx) ?? '', variant: 'muted' });
        break;
      }
      case 'errors':
        // json-render's components show their own validation.
        key = el('stack', { direction: 'vertical', gap: 'none' });
        break;
      case 'control':
        if (!self) return note("a control part outside a field's own layout");
        key = control(self.decl, defaultControl(registry, self.decl), props, self.path, anchor, undefined, cx);
        break;
      default: {
        const role = registry.elements.get(node.type)?.role;
        if (role === 'control' && self) {
          key = control(self.decl, node.type, props, self.path, anchor, undefined, cx);
          break;
        }
        const out: Props = {};
        for (const [k, v] of Object.entries(props)) out[k] = expr(v, anchor, cx);
        key = el(node.type, out, kids());
      }
    }
    if (visible.visible !== undefined) elements[key] = { ...elements[key]!, ...visible };
    return key;
  };

  const root = emit(form.layout(options.view), '', { repeats: [], uses: new Map() });
  const state: Record<string, unknown> = {};
  setState(state, base, stateOfSpec(spec, form.json(), registry));
  if (Object.keys(uiState).length > 0) setState(state, ui, uiState);
  return { root, elements, state };
}

function negate(condition: unknown): unknown {
  // `not` on an `in` leaf: none of the alternatives holds.
  const alternatives = (condition as { $or: Props[] }).$or;
  return { $and: alternatives.map((leaf) => ({ ...leaf, not: true })) };
}

function setState(state: Record<string, unknown>, pointer: string, value: unknown) {
  const segments = pointer.split('/').filter(Boolean);
  let node = state;
  segments.forEach((s, i) => {
    if (i === segments.length - 1) node[s] = value;
    else node = (node[s] ??= {}) as Record<string, unknown>;
  });
  if (segments.length === 0) Object.assign(state, value);
}

// ── State ─────────────────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Props => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether a set of enum values is edited with `checks`, which keeps it as one comma-separated string. */
function asChecks(registry: Registry, decl: Resolved): boolean {
  const render =
    typeof decl.render === 'string'
      ? decl.render
      : isObject(decl.render) && typeof decl.render.type === 'string'
        ? decl.render.type
        : undefined;
  const chosen = render && registry.elements.get(render)?.role === 'control' ? render : defaultControl(registry, decl);
  return decl.type === 'set' && chosen === 'checks';
}

function stateOf(registry: Registry, lookup: Lookup, decl: Resolved, json: unknown): unknown {
  const at = (d: FieldDecl, v: unknown) => stateOf(registry, lookup, deref(lookup, d), v);
  switch (decl.type) {
    case 'enum': {
      const choice = choicesOf(decl)?.find((c) => c.value === json);
      if (choice) return choice.state;
      return json === undefined || json === null || typeof json === 'string' ? json : textOf(json);
    }
    case 'json':
      return json === undefined ? json : JSON.stringify(json, null, 2);
    case 'object': {
      if (!isObject(json)) return json;
      const out: Props = { ...json };
      for (const [k, d] of Object.entries((decl as ObjectField).fields)) if (k in json) out[k] = at(d, json[k]);
      return out;
    }
    case 'variant': {
      const v = decl as VariantField;
      if (!isObject(json)) return json;
      const variant = v.variants[String(json[v.key])];
      if (!variant) return json;
      const out: Props = { ...json, [v.key]: stateOf(registry, lookup, keyOf(v), json[v.key]) };
      for (const [k, d] of Object.entries(variant.fields)) if (k in json) out[k] = at(d, json[k]);
      return out;
    }
    // json-render repeats over collections, and anything but a list there stops its renderer: a
    // value of the wrong shape, which fails validation anyway, shows as empty.
    case 'array':
    case 'set':
      if (asChecks(registry, decl)) {
        if (!Array.isArray(json)) return json === undefined ? json : '';
        return json.map((item) => String(at((decl as ArrayField).items, item))).join(',');
      }
      if (!Array.isArray(json)) return json === undefined ? json : [];
      return json.map((item) => at((decl as ArrayField).items, item));
    case 'record':
      if (!isObject(json)) return json === undefined ? json : [];
      return Object.entries(json).map(([key, value]) => ({ key, value: at((decl as RecordField).values, value) }));
    case 'map':
      if (!Array.isArray(json)) return json === undefined ? json : [];
      return json.map((pair) =>
        Array.isArray(pair) ? { key: at((decl as MapField).keys, pair[0]), value: at((decl as MapField).values, pair[1]) } : pair,
      );
    default:
      return json;
  }
}

function jsonOf(registry: Registry, lookup: Lookup, decl: Resolved, state: unknown): unknown {
  const at = (d: FieldDecl, v: unknown) => jsonOf(registry, lookup, deref(lookup, d), v);
  switch (decl.type) {
    case 'enum': {
      const choices = choicesOf(decl);
      if (typeof state !== 'string' || !choices) return state;
      return (choices.find((c) => c.state === state) ?? choices.find((c) => String(c.value) === state))?.value ?? state;
    }
    case 'int':
    case 'number':
      if (typeof state !== 'string') return state;
      return state.trim() === '' ? undefined : Number(state);
    case 'json':
      if (typeof state !== 'string') return state;
      try {
        return JSON.parse(state);
      } catch {
        return state;
      }
    case 'object': {
      if (!isObject(state)) return state;
      const out: Props = { ...state };
      for (const [k, d] of Object.entries((decl as ObjectField).fields)) if (k in state) out[k] = at(d, state[k]);
      return out;
    }
    case 'variant': {
      const v = decl as VariantField;
      if (!isObject(state)) return state;
      const name = jsonOf(registry, lookup, keyOf(v), state[v.key]);
      const variant = v.variants[String(name)];
      if (!variant) return state;
      // Only the chosen variant's fields: those of one chosen before are left behind.
      const out: Props = { [v.key]: name };
      for (const [k, d] of Object.entries(variant.fields)) if (k in state) out[k] = at(d, state[k]);
      return out;
    }
    case 'array':
    case 'set': {
      const items = (decl as ArrayField).items;
      if (typeof state === 'string' && asChecks(registry, decl)) {
        return state
          .split(',')
          .filter(Boolean)
          .map((s) => at(items, s));
      }
      return Array.isArray(state) ? state.map((item) => at(items, item)) : state;
    }
    case 'record':
      return Array.isArray(state)
        ? Object.fromEntries(state.filter(isObject).map((e) => [textOf(e.key), at((decl as RecordField).values, e.value)]))
        : state;
    case 'map':
      return Array.isArray(state)
        ? state.filter(isObject).map((e) => [at((decl as MapField).keys, e.key), at((decl as MapField).values, e.value)])
        : state;
    default:
      return state;
  }
}

function rootDecl(spec: Spec): Resolved {
  return { type: 'object', fields: spec.fields };
}

/** An option as json-render's state holds it. */
interface Choice {
  readonly value: OptionValue;
  readonly state: string;
  readonly label: unknown;
}

/**
 * An enum's options as json-render's state holds them: by label, which shadcn's selects (plain
 * strings) then show, when each label is plain text, none repeats and none has a comma (a set
 * edited with `checks` joins them with commas); else by value, as text.
 */
function choicesOf(decl: Resolved | undefined): readonly Choice[] | undefined {
  const options = decl?.type === 'enum' ? (decl as EnumField).options : undefined;
  if (!Array.isArray(options)) return undefined;
  const all = options.map((o): EnumOption => (isObject(o) ? (o as unknown as EnumOption) : { value: o as OptionValue }));
  const labels = all.map((o) => (typeof o.label === 'string' ? o.label : String(o.value)));
  const byLabel = new Set(labels).size === labels.length && labels.every((l) => !l.includes(','));
  return all.map((o, i) => ({ value: o.value, state: byLabel ? labels[i]! : String(o.value), label: o.label ?? String(o.value) }));
}

/** A variant's names, as the enum its key is. */
function keyOf(v: VariantField): Resolved {
  return {
    type: 'enum',
    options: Object.entries(v.variants ?? {}).map(([value, variant]) => ({ value, label: variant.label ?? humanize(value) })),
  };
}

/**
 * The declaration at a path into the values, from the spec alone: any segment in a list (`*`
 * included) is its item. A variant's key is the enum of its names.
 */
function declOf(spec: Spec, lookup: Lookup, path: string): Resolved | undefined {
  let decl = rootDecl(spec);
  for (const segment of parsePointer(path)) {
    let next: FieldDecl | undefined;
    switch (decl.type) {
      case 'object':
        next = (decl as ObjectField).fields?.[segment];
        break;
      case 'variant': {
        const v = decl as VariantField;
        if (segment === v.key) return keyOf(v);
        next = Object.values(v.variants ?? {})
          .map((variant) => variant.fields?.[segment])
          .find((f) => f !== undefined);
        break;
      }
      case 'array':
      case 'set':
        next = (decl as ArrayField).items;
        break;
      case 'record':
        next = (decl as RecordField).values;
        break;
      case 'map':
        next = (decl as MapField).values;
        break;
      default:
        return undefined;
    }
    if (!isObject(next)) return undefined;
    decl = deref(lookup, next);
  }
  return decl;
}

// ── Code ─────────────────────────────────────────────────────────────────────────────────

/** The function `toJsonRender`'s output calls for an expression with code. */
const BRIDGE = 'fieldspec';
/** The arg that says what to run, and the one that holds the repeat index. */
const CALL = '~call';
const INDEX = '~index';

/** What to run: an expression, where it sits, and the values it reads, passed as args `r0`, `r1`, …. */
interface Call {
  readonly expr: Expr;
  readonly base: string;
  readonly item?: string;
  readonly reads: readonly string[];
  /** Give the result as text. */
  readonly asText?: boolean;
}

const CODE_KEYS: readonly string[] = ['$computed', ...LANGUAGE_KEYS];

function hasCode(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCode);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([k, v]) => (CODE_KEYS.includes(k) && typeof v === 'string') || hasCode(v));
}

/** A condition without the leaves json-render cannot run: they hold. */
function withoutCode(condition: unknown): unknown {
  if (Array.isArray(condition)) return condition.map(withoutCode);
  if (!isObject(condition)) return condition;
  if (Array.isArray(condition.$and)) return { $and: condition.$and.map(withoutCode) };
  if (Array.isArray(condition.$or)) return { $or: condition.$or.map(withoutCode) };
  return hasCode(condition) ? true : condition;
}

/** Every pointer an expression reads, absolute. */
function readsOf(value: unknown, base: string, item: string | undefined, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) readsOf(v, base, item, out);
    return out;
  }
  if (!isObject(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (k === '$state' && typeof v === 'string') {
      out.add(resolvePointer(v, base));
    } else if (k === '$item' && typeof v === 'string') {
      if (item !== undefined) out.add(resolvePointer(v, item));
    } else if (k === '$template' && typeof v === 'string') {
      for (const match of v.matchAll(/\$\{([^}]*)\}/g)) out.add(resolvePointer(match[1]!.trim(), base));
    } else {
      readsOf(v, base, item, out);
    }
  }
  return out;
}

export interface JsonRenderFunctionsOptions {
  readonly registry?: Registry;
  /** The `$computed` functions, where not the ones the spec was defined with. */
  readonly fns?: Functions;
}

/**
 * The function `toJsonRender`'s output calls for an expression with code in it (`$cel`, `$js`,
 * `$computed`), which json-render cannot run itself: it reads the values from json-render's
 * state as fieldspec does and runs the expression with the registry's languages and the spec's
 * functions. Pass it to json-render's `JSONUIProvider` as `functions`.
 */
export function jsonRenderFunctions(
  spec: Spec,
  options: JsonRenderFunctionsOptions = {},
): Record<string, (args: Record<string, unknown>) => unknown> {
  const registry = options.registry ?? registryOf(spec);
  const fns = options.fns ?? functionsOf(spec);
  const lookup: Lookup = { defs: spec.defs, presets: registry.presets };
  const ctx = ctxOf(spec, { registry });
  return {
    [BRIDGE](args) {
      if (typeof args[CALL] !== 'string') return undefined;
      const call = JSON.parse(args[CALL]) as Call;
      const values = new Map(
        call.reads.map((path, i) => {
          const decl = declOf(spec, lookup, path);
          const state = args[`r${i}`];
          return [path, decl ? decodeField(ctx, decl, jsonOf(registry, lookup, decl, state)) : state];
        }),
      );
      const env: Env = {
        values: undefined,
        fns,
        languages: registry.languages,
        get: (pointer) => values.get(pointer),
        declAt: (pointer) => declOf(spec, lookup, pointer),
      };
      const index = args[INDEX];
      try {
        const result = evaluate(call.expr, env, {
          base: call.base,
          ...(call.item !== undefined && { item: call.item }),
          ...(typeof index === 'number' && { index }),
        });
        return call.asText === true || !isPlain(result) ? textOf(result) : result;
      } catch {
        return undefined;
      }
    },
  };
}

/** Whether json-render can take a value as it is: JSON, not a Date, URL or the like. */
const isPlain = (value: unknown): boolean =>
  value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value) || Array.isArray(value) || isObject(value);

function stateOfSpec(spec: Spec, json: unknown, registry: Registry): unknown {
  return stateOf(registry, { defs: spec.defs, presets: registry.presets }, rootDecl(spec), json);
}

/** Values as json-render's state holds them (see the module's notes), to put at `statePath`. */
export function toJsonRenderState(spec: Spec, values: unknown, options: Omit<JsonRenderStateOptions, 'statePath'> = {}): unknown {
  const registry = options.registry ?? registryOf(spec);
  return stateOfSpec(spec, createForm(spec, { values, registry }).json(), registry);
}

/** The values in json-render's state, decoded: what to `parse`, or give a form. */
export function fromJsonRenderState(spec: Spec, state: unknown, options: JsonRenderStateOptions = {}): unknown {
  const registry = options.registry ?? registryOf(spec);
  const at = options.statePath ?? '/form';
  const json = jsonOf(registry, { defs: spec.defs, presets: registry.presets }, rootDecl(spec), getAt(state, at));
  return decode(spec, json, { registry });
}

export { registryOf };
