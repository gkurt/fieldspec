/**
 * React rendering. The form is headless; `FormView` walks its layout tree and asks your
 * renderers to draw each node: a table keyed by element name (layout like `stack` and `row`,
 * parts like `label` and `errors`, controls like `input` and `slider`), or a function that picks
 * one per element. fieldspec ships no look of its own: the repository's `examples/renderers`
 * are sets to copy. A control with no renderer falls back to its kind's default control, then to
 * `input`. What container and choice controls do (lists, entries, variants) comes as helpers.
 */
import { createContext, createElement, Fragment, use, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ElementRole } from '#src/elements.ts';
import { textOf, type Scope } from '#src/expr.ts';
import { createForm, type FieldState, type Form, type FormOptions } from '#src/form.ts';
import type { Format } from '#src/format.ts';
import type { Infer } from '#src/infer.ts';
import { defaultControl, type LayoutNode } from '#src/layout.ts';
import { resolvePointer } from '#src/pointer.ts';
import type { Expr } from '#src/types.ts';

// ── Hooks ────────────────────────────────────────────────────────────────────────────────

/** A form for this spec, created once. */
export function useForm<S extends Parameters<typeof createForm>[0]>(spec: S, options?: FormOptions): Form<Infer<S>> {
  const [form] = useState(() => createForm(spec, options));
  return form;
}

/** Re-render when the form changes. Returns its version. */
export function useFormVersion(form: Form): number {
  return useSyncExternalStore(
    form.subscribe,
    () => form.version,
    () => form.version,
  );
}

/** A field's live state, or undefined if the path is not a field. */
export function useField(form: Form, path: string): FieldState | undefined {
  useFormVersion(form);
  return form.field(path);
}

// ── The renderer table ───────────────────────────────────────────────────────────────────

interface BaseProps {
  readonly node: LayoutNode;
  /** The element's props, evaluated. */
  readonly props: Readonly<Record<string, unknown>>;
  readonly form: Form;
}

/** A layout element (`stack`, `row`, `tabs`, …): its children, drawn. */
export interface LayoutProps extends BaseProps {
  readonly children: ReactNode;
}

/** A part (`label`, `help`, `errors`): the field it is about, if it is about one. */
export interface PartProps extends BaseProps {
  readonly field?: FieldState;
  /** For `errors` over several fields. */
  readonly fields?: readonly FieldState[];
  /** The id the field's control carries, for a label to point at. */
  readonly id?: string;
}

/** `field`: a whole field, around its control. */
export interface FieldProps extends BaseProps {
  readonly field: FieldState;
  /** The id the field's control carries, for a label to point at. */
  readonly id: string;
  /** Draw the field's control. */
  readonly control: () => ReactNode;
}

/** A control (`input`, `slider`, `list`, …): edits one field. */
export interface ControlProps extends BaseProps {
  readonly field: FieldState;
  /** The id to put on the element a label points at. */
  readonly id: string;
  /** Editing is off: the field is disabled or read-only. */
  readonly disabled: boolean;
  /** Write the field's value. */
  readonly set: (value: unknown) => void;
  /** Mark the field touched. */
  readonly touch: () => void;
  /** For container controls (`list`, `entries`, `variant`, `fields`): the field's layout node, with its insides. */
  readonly fieldNode?: LayoutNode;
  /** For container controls: draw a node anchored at a pointer. */
  readonly render: (node: LayoutNode, anchor: string, scope?: Partial<Scope>) => ReactNode;
}

export type ElementProps = LayoutProps | PartProps | FieldProps | ControlProps;

/**
 * A renderer for elements of one role. Bivariant in its props, as React's own event handlers
 * are, so a renderer written for `ControlProps` goes in the same table as one for `LayoutProps`.
 */
export type ElementRenderer<P extends ElementProps = ElementProps> = { bivarianceHack(props: P): ReactNode }['bivarianceHack'];
export type Renderers = { readonly [element: string]: ElementRenderer };

type LayoutElement = 'stack' | 'row' | 'columns' | 'collapsible' | 'scroll' | 'tabs' | 'text' | 'divider';
type PartElement = 'label' | 'help' | 'errors';
type ControlElement =
  | 'input'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'segmented'
  | 'checkbox'
  | 'switch'
  | 'slider'
  | 'date'
  | 'color'
  | 'file'
  | 'checks'
  | 'list'
  | 'entries'
  | 'variant'
  | 'fields';

/** The props a built-in element's renderer gets. Your own elements get any of them: say which. */
export type PropsOf<E extends string> = E extends 'field'
  ? FieldProps
  : E extends LayoutElement
    ? LayoutProps
    : E extends PartElement
      ? PartProps
      : E extends ControlElement
        ? ControlProps
        : ElementProps;

/**
 * A renderer table, each built-in element's renderer typed by its role. Lay one over another
 * by spreading: `{ ...base, ...defineRenderers({ input: MyInput }) }`. Your own element names
 * are capitalized; type their renderers yourself.
 */
export function defineRenderers<E extends string>(renderers: { readonly [K in E]: ElementRenderer<PropsOf<K>> }): Renderers {
  return renderers;
}

/** An element about to be drawn, for a {@link ResolveRenderer} to pick its renderer by. */
export interface RenderRequest {
  /** The element: the layout's, or for a control the one the spec names, else the kind's default. */
  readonly element: string;
  readonly role: ElementRole;
  /** For controls: the spec (or the field's preset) names this control, rather than its kind. */
  readonly explicit: boolean;
  readonly node: LayoutNode;
  /** For `field`, parts and controls: the field. */
  readonly field?: FieldState;
  readonly form: Form;
}

/**
 * Renderers as a function: the renderer for an element about to be drawn, or `next()` (or
 * nothing) for the one the renderers beneath would use. Return renderers made once, not inside
 * the function: React takes a new one for a new component, and remounts the control, losing
 * its focus and what is being typed.
 */
export type ResolveRenderer = (request: RenderRequest, next: () => ElementRenderer) => ElementRenderer | undefined;

/** A function laid over other renderers, a table or another function: its `next()` is theirs. */
export function extendRenderers(base: Renderers | ResolveRenderer, resolve: ResolveRenderer): ResolveRenderer {
  return (request, next) => {
    const below = () => (typeof base === 'function' ? (base(request, next) ?? next()) : fromTable(base, request));
    return resolve(request, below) ?? below();
  };
}

/** Draws nothing: an element no renderer is given for. */
const Nothing = () => null;
/** A layout element no renderer is given for: its children, unframed. */
const Children = ({ children }: LayoutProps) => <>{children}</>;
/** A field with no `field` renderer: its control alone. */
const ControlOnly = ({ control }: FieldProps) => control();

/**
 * The renderer a table holds for a request. A control falls back to its kind's default control,
 * then `input`; a layout element to `stack`, then its bare children; a field to its bare control.
 */
function fromTable(table: Renderers, { element, role, field, form }: RenderRequest): ElementRenderer {
  if (role === 'control') {
    const fallback = field ? defaultControl(form.format, field.decl) : 'input';
    return table[element] ?? table[fallback] ?? table.input ?? Nothing;
  }
  if (role === 'part') return table[element] ?? Nothing;
  if (element === 'field') return table.field ?? ControlOnly;
  return table[element] ?? table.stack ?? Children;
}

const EMPTY: Renderers = {};

/** One way to pick a renderer, whatever form the renderers take. */
function pickerOf(renderers: Renderers | ResolveRenderer): (request: RenderRequest) => ElementRenderer {
  if (typeof renderers !== 'function') return (request) => fromTable(renderers, request);
  return (request) => {
    const next = () => fromTable(EMPTY, request);
    return renderers(request, next) ?? next();
  };
}

// ── Drawing ──────────────────────────────────────────────────────────────────────────────

interface DrawContext {
  readonly form: Form;
  readonly pick: (request: RenderRequest) => ElementRenderer;
  readonly idPrefix: string;
}

const Ctx = createContext<DrawContext | null>(null);
/** The field node whose own render is being drawn, so its parts can reach its insides. */
const OwnField = createContext<LayoutNode | undefined>(undefined);

export interface FormViewProps {
  readonly form: Form;
  /** A named layout from the spec. */
  readonly view?: string;
  /** A table keyed by element name, or a function that picks per element. */
  readonly renderers: Renderers | ResolveRenderer;
  readonly className?: string;
}

/** Draws a whole form. */
export function FormView({ form, view, renderers, className }: FormViewProps) {
  useFormVersion(form);
  const idPrefix = useId();
  const pick = useMemo(() => pickerOf(renderers), [renderers]);
  return (
    <Ctx.Provider value={{ form, pick, idPrefix }}>
      <div className={className === undefined ? 'fs-form' : `fs-form ${className}`} data-fieldspec="">
        <Node node={form.layout(view)} scope={{ base: '' }} />
      </div>
    </Ctx.Provider>
  );
}

function useDraw(): DrawContext {
  const ctx = use(Ctx);
  if (!ctx) throw new Error('fieldspec: draw inside <FormView>');
  return ctx;
}

/** The renderer the form's renderers pick for a request: a field's frame can ask who draws its control. */
export function useRenderer(request: RenderRequest): ElementRenderer {
  return useDraw().pick(request);
}

const idFor = (prefix: string, path: string) => `${prefix}${path.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/** One layout node, at a scope whose `base` is the anchor its field pointers start from. */
function Node({ node, scope }: { node: LayoutNode; scope: Scope }): ReactNode {
  const { form, pick, idPrefix } = useDraw();
  const own = use(OwnField);
  if (node.visible !== undefined && !form.test(node.visible, scope)) return null;
  const anchor = scope.base;
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.props)) props[k] = form.evaluate(v, scope);
  const role = form.format.elements.get(node.type)?.role;

  if (node.type === 'field') {
    const field = form.field(resolvePointer(node.field ?? '', anchor));
    if (!field || !field.visible) return null;
    if (node.fragment) {
      return (
        <OwnField.Provider value={node}>
          <Node node={node.fragment} scope={scope} />
        </OwnField.Provider>
      );
    }
    const id = idFor(idPrefix, field.path);
    const control = () => (
      <Control
        element={node.control?.type}
        elementProps={node.control?.props}
        field={field}
        fieldNode={node}
        explicit={node.control?.explicit === true}
      />
    );
    const renderer = pick({ element: 'field', role: 'layout', explicit: true, node, field, form });
    return createElement(renderer, { node, props, form, field, control, id });
  }

  if (role === 'part' || role === 'control') {
    const many = node.fields?.map((f) => form.field(resolvePointer(f, anchor))).filter((f): f is FieldState => !!f && f.visible);
    const field = node.field !== undefined ? form.field(resolvePointer(node.field, anchor)) : undefined;
    if (node.field !== undefined && (!field || !field.visible)) return null;
    const fieldNode = field && own && resolvePointer(own.field ?? '', anchor) === field.path ? own : undefined;
    if (field && (role === 'control' || node.type === 'control')) {
      // `control` is the field's own control; a control element names the one to use.
      const element = node.type === 'control' ? (fieldNode?.control?.type ?? undefined) : node.type;
      const elementProps = node.type === 'control' ? { ...fieldNode?.control?.props, ...node.props } : node.props;
      // A control element in a field's own layout is named there; `control` is as the field has it.
      const explicit = node.type === 'control' ? fieldNode?.control?.explicit === true : true;
      return <Control element={element} elementProps={elementProps} field={field} fieldNode={fieldNode} explicit={explicit} />;
    }
    const id = field ? idFor(idPrefix, field.path) : undefined;
    const renderer = pick({ element: node.type, role: 'part', explicit: true, node, ...(field && { field }), form });
    return createElement(renderer, { node, props, form, ...(field && { field }), ...(many && { fields: many }), ...(id && { id }) });
  }

  const children = node.children.map((child) => <Node key={child.key} node={child} scope={scope} />);
  return createElement(pick({ element: node.type, role: 'layout', explicit: true, node, form }), { node, props, children, form });
}

/** A field's control: the element named, else the kind's default, else `input`. */
function Control(p: {
  element: string | undefined;
  elementProps?: { readonly [k: string]: Expr };
  field: FieldState;
  fieldNode: LayoutNode | undefined;
  explicit: boolean;
}) {
  const { elementProps, field, fieldNode } = p;
  const { form, pick, idPrefix } = useDraw();
  const name = p.element ?? defaultControl(form.format, field.decl);
  const node = fieldNode ?? { type: name, key: field.path, props: {}, children: [] };
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(elementProps ?? {})) props[k] = form.evaluate(v, field.scope);
  return createElement(pick({ element: name, role: 'control', explicit: p.explicit && p.element !== undefined, node, field, form }), {
    node,
    props,
    form,
    field,
    id: idFor(idPrefix, field.path),
    disabled: !field.enabled || field.readOnly,
    set: (value: unknown) => form.set(field.path, value),
    touch: () => form.touch(field.path),
    ...(fieldNode && { fieldNode }),
    render: (n: LayoutNode, at: string, extra?: Partial<Scope>) => <Node key={`${n.key}@${at}`} node={n} scope={{ base: at, ...extra }} />,
  });
}

// ── Text controls ────────────────────────────────────────────────────────────────────────

/** What a control shows for a field whose values differ. */
const MIXED = 'Mixed';
const ok = (value: unknown) => ({ ok: true as const, value });
const fail = (error: string) => ({ ok: false as const, error });

/** How a text box shows a kind's values and reads them back. */
export type Parse = { show(value: unknown): string; read(text: string): { ok: true; value: unknown } | { ok: false; error: string } };

/** How a text box reads and shows each kind's values. */
const PARSERS: Record<string, Parse> = {
  string: { show: (v) => (typeof v === 'string' ? v : ''), read: ok },
  number: {
    show: String,
    read: (t) => (t.trim() !== '' && Number.isFinite(Number(t)) ? ok(Number(t)) : fail('Enter a number')),
  },
  int: {
    show: String,
    read: (t) => (t.trim() !== '' && Number.isInteger(Number(t)) ? ok(Number(t)) : fail('Enter a whole number')),
  },
  bigint: { show: String, read: (t) => (/^-?\d+$/.test(t.trim()) ? ok(BigInt(t.trim())) : fail('Enter a whole number')) },
  url: {
    show: (v) => (v instanceof URL ? v.href : ''),
    read: (t) => (URL.canParse(t) ? ok(new URL(t)) : fail('Enter a full URL, like https://example.com')),
  },
  regexp: {
    show: String,
    read: (t) => {
      const m = /^\/(.*)\/([dgimsuvy]*)$/s.exec(t);
      try {
        return ok(m ? new RegExp(m[1]!, m[2]) : new RegExp(t));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
  json: {
    show: (v) => JSON.stringify(v, null, 2),
    read: (t) => {
      try {
        return ok(JSON.parse(t));
      } catch {
        return fail('Enter valid JSON');
      }
    },
  },
};

/** The parser for a field, following its kind's base chain. */
export function parserFor(format: Format, type: string): Parse {
  for (let name: string | undefined = type, i = 0; name !== undefined && i < 8; name = format.kinds.get(name)?.base, i++)
    if (PARSERS[name]) return PARSERS[name]!;

  return PARSERS.string!;
}

/**
 * A control's text that parses: what is typed stays as typed until it parses, and a value set
 * from elsewhere replaces it. For a text control of your own; `input` and `textarea` use it.
 */
export function useParsedText(
  p: ControlProps,
  parse: Parse,
): { draft: string; error?: string; placeholder?: string; change: (text: string) => void } {
  const field = p.field;
  // A mixed field shows no value until it is edited.
  const shown = field.value === undefined || field.mixed ? '' : parse.show(field.value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | undefined>();
  // When the value changes from outside, the draft follows, unless it already reads as that value.
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    const parsed = parse.read(draft);
    if (!(parsed.ok && parse.show(parsed.value) === shown)) setDraft(shown);
  }
  const placeholder = field.mixed ? MIXED : p.props.placeholder !== undefined ? textOf(p.props.placeholder) : field.placeholder;
  return {
    draft,
    ...(error !== undefined && { error }),
    ...(placeholder !== undefined && { placeholder }),
    change(t) {
      setDraft(t);
      if (t === '' && field.decl.optional) {
        setError(undefined);
        return p.set(undefined);
      }
      const parsed = parse.read(t);
      if (parsed.ok) {
        setError(undefined);
        p.set(parsed.value);
      } else {
        setError(parsed.error);
      }
    },
  };
}

export * from './controls.tsx';
export { type FieldState, type Form };
