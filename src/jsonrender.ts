/**
 * json-render interop. Fragments are written nested here and flat there (`{ root, elements }`
 * with children by key); both directions are lossless. `toJsonRender` turns a whole form into
 * a json-render spec bound to state, drawn with the components of `@json-render/shadcn`'s
 * catalog (rename them with `components`). Lists, sets, records and maps repeat over state with
 * add and remove buttons; a definition that contains itself is unrolled `depth` levels deep.
 * Conditions and expressions share json-render's grammar and pass through with their pointers
 * rewritten for json-render's state.
 *
 * json-render's state holds the values as JSON, except where its components need otherwise:
 * records and maps are lists of `{ key, value }` entries, enum values are strings, a set of
 * enum values is one comma-separated string, and a `json` field is JSON text.
 * `toJsonRenderState` and `fromJsonRenderState` convert.
 */
import { deref, type Lookup } from './defs.ts';
import { textOf } from './expr.ts';
import { createForm, humanize } from './form.ts';
import { formatOf, type Format } from './format.ts';
import { defaultControl, type LayoutNode } from './layout.ts';
import { getAt, resolvePointer } from './pointer.ts';
import type {
  ArrayField,
  Condition,
  EnumField,
  Expr,
  FieldDecl,
  Json,
  MapField,
  ObjectField,
  RecordField,
  RenderElement,
  RenderNode,
  Resolved,
  Spec,
  VariantField,
} from './types.ts';
import { ctxOf, decode, encodeField, initialValue } from './values.ts';

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
  readonly format?: Format;
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
  readonly format?: Format;
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
  const format = options.format ?? formatOf(spec);
  const lookup: Lookup = { defs: spec.defs, presets: format.presets };
  const form = createForm(spec, { values: options.values, format });
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
  /** A condition or expression, with its pointers made to read json-render's state. */
  const rebase = (value: unknown, anchor: string, cx: Cx): unknown => {
    if (Array.isArray(value)) return value.map((v) => rebase(v, anchor, cx));
    if (!value || typeof value !== 'object') return value;
    const out: Props = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '$state' && typeof v === 'string') {
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
  const visibleOf = (conditions: readonly (Condition | undefined)[], anchor: string, cx: Cx) => {
    const all = conditions.filter((c) => c !== undefined).map((c) => rebase(c, anchor, cx));
    return all.length === 0 ? {} : { visible: all.length === 1 ? all[0] : all };
  };
  const text = (value: unknown, anchor: string, cx: Cx) => (value === undefined ? undefined : rebase(value, anchor, cx));

  /** A control element bound to the field at `path`. */
  const control = (decl: Resolved, element: string, own: Props, path: string, anchor: string, label: unknown, cx: Cx): string => {
    const name = path.slice(1) || 'value';
    const value = bind(path, cx);
    const placeholder = typeof decl.placeholder === 'string' ? { placeholder: decl.placeholder } : {};
    const caption = (inner: string) =>
      label === undefined
        ? inner
        : el('stack', { direction: 'vertical', gap: 'sm' }, [el('text', { text: label, variant: 'caption' }), inner]);
    const options = () => {
      // `checks` edits a set: its options are its items'.
      const choices = element === 'checks' ? deref(lookup, (decl as ArrayField).items) : decl;
      const list = (choices as EnumField).options;
      return Array.isArray(list)
        ? list.map((o) =>
            typeof o === 'object' && o !== null
              ? { value: String(o.value), label: o.label ?? String(o.value) }
              : { value: String(o), label: String(o) },
          )
        : undefined;
    };
    let key: string;
    switch (element) {
      case 'input':
      case 'date':
      case 'color':
      case 'file': {
        const numeric = decl.type === 'number' || decl.type === 'int';
        const kind =
          own.secret === true ? 'password' : numeric ? 'number' : (decl as { format?: string }).format === 'email' ? 'email' : 'text';
        key = el(element, { label: label ?? '', name, type: kind, ...placeholder, value });
        break;
      }
      case 'textarea':
        key = el(element, { label: label ?? '', name, ...placeholder, ...(typeof own.rows === 'number' && { rows: own.rows }), value });
        break;
      case 'select':
      case 'radio': {
        const list = options();
        if (!list) return note(`${textOf(label ?? name)}: options from an expression are not supported in json-render output`);
        key = el(element, { label: label ?? '', name, options: list.map((o) => o.value), ...(element === 'select' && placeholder), value });
        break;
      }
      case 'segmented':
      case 'checks': {
        const items = options();
        if (!items) return note(`${textOf(label ?? name)}: options from an expression are not supported in json-render output`);
        key = caption(
          el(element, {
            items: items.map((o) => ({ label: rebase(o.label, anchor, cx), value: o.value })),
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
        if (format.elements.has(element) && !components[element])
          return note(`${textOf(label ?? name)}: no json-render component draws "${element}"`);
        // An application's own control: its props pass through, with the value bound.
        const props: Props = { ...(label !== undefined && { label }), value };
        for (const [k, v] of Object.entries(own)) props[k] = rebase(v, anchor, cx);
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
    const element = node.control?.type ?? defaultControl(format, decl);
    if (element === 'checks') return control(decl, element, node.control?.props ?? {}, path, anchor, label, cx);
    const list = refOf(path, cx);
    if (!list) return note(`${textOf(label ?? path)}: a list inside an outer list's item is out of json-render's reach here`);
    const entries = decl.type === 'record' || decl.type === 'map';
    const item = `${path}/*`;
    const inner: Cx = { ...cx, repeats: [...cx.repeats, item] };
    const content: string[] = [];
    if (entries) {
      const keyDecl = decl.type === 'map' ? deref(lookup, (decl as MapField).keys) : ({ type: 'string' } as Resolved);
      content.push(control(keyDecl, defaultControl(format, keyDecl), {}, `${item}/key`, item, 'Key', inner));
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
    const fresh = stateOf(format, lookup, deref(lookup, itemDecl), initialJson(itemDecl));
    const push = {
      action: 'pushState',
      params: {
        statePath,
        value: entries
          ? {
              key:
                decl.type === 'map'
                  ? stateOf(format, lookup, deref(lookup, (decl as MapField).keys), initialJson((decl as MapField).keys))
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
  const valueCx = ctxOf(spec, { format });
  /** A new item's value, as JSON. */
  const initialJson = (decl: FieldDecl): Json => {
    const value = initialValue(spec, decl, form.values, '', { format });
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
      const picker = control(
        {
          type: 'enum',
          options: Object.entries(v.variants).map(([value, variant]) => ({ value, label: variant.label ?? humanize(value) })),
        },
        'segmented',
        {},
        keyPath,
        path,
        label,
        cx,
      );
      const key = refOf(keyPath, cx);
      const branches = Object.entries(node.variants).map(([name, inner]) => {
        const branch = emit(inner, path, { ...cx, self: undefined });
        const on = key && 'item' in key ? { $item: key.item, eq: name } : { $state: key?.state ?? base + keyPath, eq: name };
        elements[branch] = { ...elements[branch]!, visible: on };
        return branch;
      });
      return withVisible(el('stack', { direction: 'vertical', gap: 'md' }, [picker, ...branches]));
    }
    if (node.item || ['array', 'set', 'record', 'map'].includes(decl.type))
      return withVisible(collection(node, decl, path, anchor, label, cx));
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
        key = control(self.decl, defaultControl(format, self.decl), props, self.path, anchor, undefined, cx);
        break;
      default: {
        const role = format.elements.get(node.type)?.role;
        if (role === 'control' && self) {
          key = control(self.decl, node.type, props, self.path, anchor, undefined, cx);
          break;
        }
        const out: Props = {};
        for (const [k, v] of Object.entries(props)) out[k] = rebase(v, anchor, cx);
        key = el(node.type, out, kids());
      }
    }
    if (visible.visible !== undefined) elements[key] = { ...elements[key]!, ...visible };
    return key;
  };

  const root = emit(form.layout(options.view), '', { repeats: [], uses: new Map() });
  const state: Record<string, unknown> = {};
  setState(state, base, stateOfSpec(spec, form.json(), format));
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
function asChecks(format: Format, decl: Resolved): boolean {
  const render =
    typeof decl.render === 'string'
      ? decl.render
      : isObject(decl.render) && typeof decl.render.type === 'string'
        ? decl.render.type
        : undefined;
  const chosen = render && format.elements.get(render)?.role === 'control' ? render : defaultControl(format, decl);
  return decl.type === 'set' && chosen === 'checks';
}

function stateOf(format: Format, lookup: Lookup, decl: Resolved, json: unknown): unknown {
  const at = (d: FieldDecl, v: unknown) => stateOf(format, lookup, deref(lookup, d), v);
  switch (decl.type) {
    case 'enum':
      return json === undefined || json === null || typeof json === 'string' ? json : textOf(json);
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
      const out: Props = { ...json };
      for (const [k, d] of Object.entries(variant.fields)) if (k in json) out[k] = at(d, json[k]);
      return out;
    }
    // json-render repeats over collections, and anything but a list there stops its renderer: a
    // value of the wrong shape, which fails validation anyway, shows as empty.
    case 'array':
    case 'set':
      if (asChecks(format, decl)) return Array.isArray(json) ? json.map(String).join(',') : json === undefined ? json : '';
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

function jsonOf(format: Format, lookup: Lookup, decl: Resolved, state: unknown): unknown {
  const at = (d: FieldDecl, v: unknown) => jsonOf(format, lookup, deref(lookup, d), v);
  switch (decl.type) {
    case 'enum': {
      const options = (decl as EnumField).options;
      if (typeof state !== 'string' || !Array.isArray(options)) return state;
      const match = options.map((o) => (isObject(o) ? o.value : o)).find((v) => String(v) === state);
      return match ?? state;
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
      const variant = v.variants[String(state[v.key])];
      if (!variant) return state;
      // Only the chosen variant's fields: those of one chosen before are left behind.
      const out: Props = { [v.key]: state[v.key] };
      for (const [k, d] of Object.entries(variant.fields)) if (k in state) out[k] = at(d, state[k]);
      return out;
    }
    case 'array':
    case 'set': {
      const items = (decl as ArrayField).items;
      if (typeof state === 'string' && asChecks(format, decl)) {
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

function stateOfSpec(spec: Spec, json: unknown, format: Format): unknown {
  return stateOf(format, { defs: spec.defs, presets: format.presets }, rootDecl(spec), json);
}

/** Values as json-render's state holds them (see the module's notes), to put at `statePath`. */
export function toJsonRenderState(spec: Spec, values: unknown, options: Omit<JsonRenderStateOptions, 'statePath'> = {}): unknown {
  const format = options.format ?? formatOf(spec);
  return stateOfSpec(spec, createForm(spec, { values, format }).json(), format);
}

/** The values in json-render's state, decoded: what to `parse`, or give a form. */
export function fromJsonRenderState(spec: Spec, state: unknown, options: JsonRenderStateOptions = {}): unknown {
  const format = options.format ?? formatOf(spec);
  const at = options.statePath ?? '/form';
  const json = jsonOf(format, { defs: spec.defs, presets: format.presets }, rootDecl(spec), getAt(state, at));
  return decode(spec, json, { format });
}

export { formatOf };
