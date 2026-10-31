/**
 * React rendering. The form is headless; this draws its layout tree with one table of
 * renderers, keyed by element name: layout (`stack`, `row`, …), parts (`label`, `errors`, …)
 * and controls (`input`, `slider`, …) alike. Every entry can be replaced, and your own
 * elements (capitalized) are added the same way. A control with no renderer falls back to its
 * kind's default control, then to `input`. Renderers can also be a function that picks one for
 * each element from the field it draws, over a table beneath.
 */
import {
  createContext,
  createElement,
  useEffect,
  use,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { deref } from '#src/defs.ts';
import type { ElementRole } from '#src/elements.ts';
import { textOf, type Scope } from '#src/expr.ts';
import { createForm, type FieldState, type Form, type FormOptions } from '#src/form.ts';
import type { Format } from '#src/format.ts';
import type { Infer } from '#src/infer.ts';
import { optionsOf } from '#src/kinds.ts';
import { defaultControl, type LayoutNode } from '#src/layout.ts';
import { joinPointer, resolvePointer } from '#src/pointer.ts';
import type { EnumField, Expr, FieldDecl, VariantField } from '#src/types.ts';
import { initialValue } from '#src/values.ts';

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
 * The default renderers with yours laid over, each typed by its element's role. Your own
 * element names are capitalized.
 */
export function defineRenderers<E extends string>(overrides: { readonly [K in E]: ElementRenderer<PropsOf<K>> }): Renderers {
  return { ...defaultRenderers, ...(overrides as Renderers) };
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

/** The renderer a table holds for a request, with the fallbacks a table has. */
function fromTable(table: Renderers, { element, role, field, form }: RenderRequest): ElementRenderer {
  if (role === 'control') {
    const fallback = field ? defaultControl(form.format, field.decl) : 'input';
    return table[element] ?? table[fallback] ?? table.input ?? defaultRenderers.input!;
  }
  if (role === 'part') return table[element] ?? defaultRenderers[element] ?? (() => null);
  return table[element] ?? (element === 'field' ? defaultRenderers.field! : (table.stack ?? defaultRenderers.stack!));
}

/** One way to pick a renderer, whatever form the renderers take. */
function pickerOf(renderers: Renderers | ResolveRenderer): (request: RenderRequest) => ElementRenderer {
  if (typeof renderers !== 'function') return (request) => fromTable(renderers, request);
  return (request) => {
    const next = () => fromTable(defaultRenderers, request);
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
  /** A table keyed by element name, or a function that picks per element. Default the built-in table. */
  readonly renderers?: Renderers | ResolveRenderer;
  readonly className?: string;
}

/** Draws a whole form. */
export function FormView({ form, view, renderers = defaultRenderers, className }: FormViewProps) {
  useFormVersion(form);
  const idPrefix = useId();
  const pick = useMemo(() => pickerOf(renderers), [renderers]);
  return (
    <Ctx.Provider value={{ form, pick, idPrefix }}>
      <div className={cx('fs-form', className)} data-fieldspec="">
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

// ── Layout and parts ─────────────────────────────────────────────────────────────────────

const gaps = { none: 0, sm: 8, md: 12, lg: 20 } as const;
const text = (v: unknown) => (v === undefined || v === null ? undefined : textOf(v));
/** A length for CSS: a number is pixels. */
const cssLength = (v: unknown) => (typeof v === 'number' ? `${v}px` : String(v));
/** What a control shows for a field whose values differ. */
const MIXED = 'Mixed';
const indeterminate = (field: FieldState) => (el: HTMLInputElement | null) => {
  if (el) el.indeterminate = field.mixed;
};
const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');
const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };

/** Set by `tabs` for its panes, whose titles are already on their tabs. */
const InTab = createContext(false);

/**
 * A container's body, framed when it has a title. The title sits on the frame's border, as a
 * container field's label does.
 */
function Frame({ props, className, children }: { props: Readonly<Record<string, unknown>>; className: string; children: ReactNode }) {
  const inTab = use(InTab);
  if (props.title === undefined || inTab) {
    return (
      <div className={className}>
        <InTab.Provider value={false}>{children}</InTab.Provider>
      </div>
    );
  }
  return (
    <fieldset className={cx('fs-section', className)}>
      <legend className="fs-title">{text(props.title)}</legend>
      {props.description !== undefined && <p className="fs-help">{text(props.description)}</p>}
      {children}
    </fieldset>
  );
}

/** A frame whose title opens and closes it. */
function Collapsible({ children, props }: LayoutProps) {
  const [open, setOpen] = useState(!props.collapsed);
  const id = useId();
  return (
    <fieldset className="fs-collapsible" data-open={open ? '' : undefined}>
      <legend className="fs-title">
        <button type="button" className="fs-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {text(props.title) ?? 'Details'}
        </button>
      </legend>
      {/* An inline display would show it through `hidden`. */}
      <div id={id} hidden={!open} style={open ? column : undefined}>
        {props.description !== undefined && <p className="fs-help">{text(props.description)}</p>}
        {children}
      </div>
    </fieldset>
  );
}

const CONTAINER_KINDS = new Set(['object', 'variant', 'array', 'set', 'record', 'map']);

function FieldFrame({ field, control, id, node }: FieldProps) {
  const f = field;
  const inline = node.control?.type === 'checkbox' || node.control?.type === 'switch';
  // An item of a list or record is named by its key or position beside it; its own label is
  // kept for screen readers only, so its control lines up with the key's.
  const item = node.field === '';
  if (CONTAINER_KINDS.has(f.decl.type)) {
    return (
      <fieldset className="fs-field fs-group" data-kind={f.decl.type} data-mixed={f.mixed ? '' : undefined}>
        <legend className="fs-label">{f.label}</legend>
        <Help field={f} />
        {control()}
        <Errors fields={[f]} />
      </fieldset>
    );
  }
  return (
    <div
      className={cx('fs-field', inline && 'fs-inline')}
      data-kind={f.decl.type}
      data-invalid={f.showIssues && f.issues.length > 0 ? '' : undefined}
      data-mixed={f.mixed ? '' : undefined}
    >
      {inline ? (
        <label className="fs-label" htmlFor={id}>
          {control()} <span className={cx(item && 'fs-sr-only')}>{f.label}</span>
        </label>
      ) : (
        <>
          <label className={cx('fs-label', item && 'fs-sr-only')} htmlFor={id}>
            {f.label}
            {f.required && <span aria-hidden="true"> *</span>}
          </label>
          {control()}
        </>
      )}
      <Help field={f} />
      <Errors fields={[f]} />
    </div>
  );
}

function Help({ field }: { field: FieldState }) {
  const lines = [field.description, field.hint].filter(Boolean);
  if (lines.length === 0) return null;
  return <div className="fs-help">{lines.join(' ')}</div>;
}

function Errors({ fields }: { fields: readonly FieldState[] }) {
  const shown = fields.flatMap((f) => (f.showIssues ? f.issues.map((i) => ({ ...i, label: f.label })) : []));
  if (shown.length === 0) return null;
  return (
    <ul className="fs-errors" role="alert">
      {shown.map((i) => (
        <li key={`${i.path}:${i.code}`}>{fields.length > 1 ? `${i.label} ${i.message}` : i.message}</li>
      ))}
    </ul>
  );
}

function Tabs({ node, children, props }: LayoutProps) {
  const [active, setActive] = useState(0);
  const panes = Array.isArray(children) ? children : [children];
  const titles = node.children.map((c, i) => text(c.props.title) ?? `Tab ${i + 1}`);
  return (
    <Frame props={props} className="fs-tabs">
      <div role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {titles.map((t, i) => (
          <button key={t + i} type="button" role="tab" aria-selected={i === active} onClick={() => setActive(i)}>
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <InTab.Provider value>{panes[active]}</InTab.Provider>
      </div>
    </Frame>
  );
}

const layoutRenderers: { readonly [E in LayoutElement | PartElement | 'field']: ElementRenderer<PropsOf<E>> } = {
  stack: ({ children, props }) => (
    <Frame props={props} className="fs-stack">
      <div style={column}>{children}</div>
    </Frame>
  ),
  row: ({ children, props }) => (
    <Frame props={props} className="fs-row">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: gaps[(props.gap as keyof typeof gaps) ?? 'md'] ?? 12 }}>
        {Array.isArray(children)
          ? children.map((c, i) =>
              c ? (
                <div key={i} style={{ flex: '1 1 10rem', minWidth: 0 }}>
                  {c}
                </div>
              ) : null,
            )
          : children}
      </div>
    </Frame>
  ),
  columns: ({ children, props }) => (
    <Frame props={props} className="fs-columns">
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${Number(props.count ?? 2)}, minmax(0, 1fr))` }}>{children}</div>
    </Frame>
  ),
  collapsible: Collapsible,
  scroll: ({ children, props }) => (
    <Frame props={props} className="fs-scroll">
      {/* Focusable, so the keyboard can scroll it too. */}
      <div
        className="fs-scroll-body"
        tabIndex={0}
        style={{ ...column, maxHeight: cssLength(props.maxHeight ?? '20rem'), overflowY: 'auto' }}
      >
        {children}
      </div>
    </Frame>
  ),
  tabs: Tabs,
  text: ({ props }) => <p className={cx('fs-text', typeof props.tone === 'string' ? `fs-${props.tone}` : undefined)}>{text(props.text)}</p>,
  divider: () => <hr className="fs-divider" />,
  field: FieldFrame,
  label: ({ field, props, id }) => (
    <label className="fs-label" htmlFor={id}>
      {text(props.text) ?? field?.label}
    </label>
  ),
  help: ({ field }) => (field ? <Help field={field} /> : null),
  errors: ({ field, fields }) => <Errors fields={fields ?? (field ? [field] : [])} />,
};

// ── Controls ─────────────────────────────────────────────────────────────────────────────

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
  const placeholder = field.mixed ? MIXED : (text(p.props.placeholder) ?? field.placeholder);
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

/** A text box that parses: what is typed stays as typed until it parses. */
function ParsedText({
  p,
  parse,
  multiline,
  type,
  extra,
  unit,
}: {
  p: ControlProps;
  parse: Parse;
  multiline?: boolean;
  type?: string;
  extra?: Record<string, unknown>;
  unit?: string;
}) {
  const field = p.field;
  const { draft, error, placeholder, change } = useParsedText(p, parse);
  const common = {
    id: p.id,
    value: draft,
    disabled: p.disabled,
    placeholder,
    'aria-invalid': error !== undefined || (field.showIssues && field.issues.length > 0),
    onChange: (e: { target: { value: string } }) => change(e.target.value),
    onBlur: p.touch,
    ...extra,
  };
  const input = multiline ? (
    <textarea {...common} className="fs-textarea" rows={Number(p.props.rows ?? 4)} />
  ) : (
    <input {...common} className="fs-input" type={type ?? 'text'} />
  );
  return (
    <>
      {unit ? (
        <div className="fs-with-unit">
          {input}
          <span className="fs-unit">{unit}</span>
        </div>
      ) : (
        input
      )}
      {error && <div className="fs-errors">{error}</div>}
    </>
  );
}

function Input(p: ControlProps) {
  const decl = p.field.decl;
  const parse = parserFor(p.form.format, decl.type);
  const format = (decl as { format?: string }).format;
  const numeric = decl.type === 'number' || decl.type === 'int';
  const type = p.props.secret
    ? 'password'
    : numeric
      ? 'number'
      : format === 'email'
        ? 'email'
        : format === 'uri' || decl.type === 'url'
          ? 'url'
          : 'text';
  const d = decl as { min?: number; max?: number; step?: number; unit?: string };
  return (
    <ParsedText
      p={p}
      parse={parse}
      type={type}
      unit={numeric ? d.unit : undefined}
      extra={numeric ? { min: d.min, max: d.max, step: d.step ?? (decl.type === 'int' ? 1 : 'any') } : undefined}
    />
  );
}

function Slider({ field, id, disabled, set, touch, props }: ControlProps) {
  const d = field.decl as { min?: number; max?: number; step?: number; unit?: string };
  const value = typeof field.value === 'number' ? field.value : (d.min ?? 0);
  const shown = props.format === 'percent' ? `${Math.round(value * 100)}%` : `${value}${d.unit ?? ''}`;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        id={id}
        className="fs-slider"
        type="range"
        min={d.min ?? 0}
        max={d.max ?? 100}
        step={d.step ?? (field.decl.type === 'int' ? 1 : 'any')}
        value={value}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
        onPointerUp={touch}
        style={{ flex: 1 }}
      />
      <output htmlFor={id} className={field.mixed ? 'fs-mixed' : undefined} style={{ minWidth: '4ch', textAlign: 'right' }}>
        {field.mixed ? MIXED : shown}
      </output>
    </div>
  );
}

function Choices({ field, id, disabled, set, touch, segmented }: ControlProps & { segmented: boolean }) {
  const options = field.options ?? [];
  const index = field.mixed ? -1 : options.findIndex((o) => Object.is(o.value, field.value));
  return (
    <div
      role="radiogroup"
      id={id}
      className={segmented ? 'fs-segmented' : 'fs-radio'}
      style={{ display: 'flex', gap: segmented ? 0 : 12, flexWrap: 'wrap' }}
    >
      {options.map((o, i) => (
        <label key={i} title={o.description} data-checked={i === index ? '' : undefined}>
          <input type="radio" name={id} checked={i === index} disabled={disabled} onChange={() => set(o.value)} onBlur={touch} /> {o.label}
        </label>
      ))}
    </div>
  );
}

function Select({ field, id, disabled, set, touch }: ControlProps) {
  const options = field.options ?? [];
  const index = field.mixed ? -1 : options.findIndex((o) => Object.is(o.value, field.value));
  return (
    <select
      id={id}
      className="fs-select"
      value={index}
      disabled={disabled}
      onChange={(e) => set(options[Number(e.target.value)]?.value)}
      onBlur={touch}
    >
      {index === -1 && <option value={-1}>{field.mixed ? MIXED : field.decl.optional ? '—' : 'Choose…'}</option>}
      {options.map((o, i) => (
        <option key={i} value={i} title={o.description}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function dateText(value: unknown, time: boolean): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  if (!time) return value.toISOString().slice(0, 10);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function List(p: ControlProps) {
  const field = p.field;
  const isSet = field.decl.type === 'set';
  const list = Array.isArray(field.value) ? field.value : field.value instanceof Set ? [...field.value] : [];
  const d = field.decl as { maxItems?: number };
  const item = p.fieldNode?.item;
  const [drag, setDrag] = useState<{ from: number; over: number } | undefined>();
  // Rows are keyed by position, so after a move from the keyboard the focus is sent after the item.
  const box = useRef<HTMLDivElement>(null);
  const refocus = useRef<number | undefined>(undefined);
  // Moves the focus in the DOM after a reorder has rendered.
  useEffect(() => {
    if (refocus.current === undefined) return;
    box.current?.querySelectorAll<HTMLElement>(':scope > .fs-item > .fs-handle')[refocus.current]?.focus();
    refocus.current = undefined;
  });
  if (isSet) {
    // A set's items have no stable position to point at, so they are edited as lines.
    const items = deref({ defs: p.form.spec.defs, presets: p.form.format.presets }, (field.decl as { items: FieldDecl }).items);
    const numeric = items.type === 'int' || items.type === 'number';
    return (
      <textarea
        id={p.id}
        className="fs-textarea"
        disabled={p.disabled}
        defaultValue={list.join('\n')}
        placeholder="One per line"
        onBlur={(e) => {
          const lines = e.target.value
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          p.set(new Set<unknown>(numeric ? lines.map(Number) : lines));
          p.touch();
        }}
      />
    );
  }
  // Items reorder by dragging their handle, or with the arrow keys while it has the focus.
  const move = (from: number, to: number) => from !== to && p.form.moveItem(field.path, from, to);
  return (
    <div ref={box} className="fs-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map((_, i) => {
        const at = joinPointer(field.path, i);
        const dropping = drag !== undefined && drag.over === i && drag.from !== i ? (drag.from < i ? 'after' : 'before') : undefined;
        return (
          <div
            key={i}
            className="fs-item"
            style={{ display: 'flex', gap: 8, alignItems: 'start' }}
            data-dragging={drag?.from === i ? '' : undefined}
            data-drop={dropping}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (drag.over !== i) setDrag({ ...drag, over: i });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag) move(drag.from, i);
              setDrag(undefined);
            }}
          >
            {/* A span, not a button: Firefox does not drag buttons. */}
            <span
              className="fs-handle"
              role="button"
              tabIndex={p.disabled ? -1 : 0}
              aria-disabled={p.disabled || undefined}
              aria-label={`Move item ${i + 1} of ${list.length}`}
              aria-keyshortcuts="ArrowUp ArrowDown"
              draggable={!p.disabled}
              title="Drag, or use the arrow keys, to reorder"
              onKeyDown={(e) => {
                const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
                if (p.disabled || to < 0 || to >= list.length) return;
                e.preventDefault();
                refocus.current = to;
                move(i, to);
              }}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(i));
                const row = e.currentTarget.parentElement;
                if (row) e.dataTransfer.setDragImage(row, 12, 12);
                setDrag({ from: i, over: i });
              }}
              onDragEnd={() => setDrag(undefined)}
            >
              ⠿
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>{item && p.render(item, at, { item: at, index: i })}</div>
            <button type="button" aria-label="Remove" disabled={p.disabled} onClick={() => p.form.removeItem(at)}>
              ✕
            </button>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          disabled={p.disabled || (d.maxItems !== undefined && list.length >= d.maxItems)}
          onClick={() => p.form.addItem(field.path)}
        >
          {text(p.props.addLabel) ?? 'Add'}
        </button>
      </div>
    </div>
  );
}

function Checks(p: ControlProps) {
  const field = p.field;
  const items = deref({ defs: p.form.spec.defs, presets: p.form.format.presets }, (field.decl as { items: FieldDecl }).items);
  const set = field.value instanceof Set ? field.value : new Set();
  if (items.type !== 'enum') return <List {...p} />;
  const options = optionsOf(items as EnumField, { values: p.form.values }, field.scope);
  return (
    <div className="fs-checks" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {/* By position: options may repeat a value, or differ only in type (1 and "1"). */}
      {options.map((o, i) => (
        <label key={i}>
          <input
            type="checkbox"
            disabled={p.disabled}
            checked={set.has(o.value)}
            onChange={(e) => {
              const next = new Set(set);
              if (e.target.checked) next.add(o.value);
              else next.delete(o.value);
              p.set(next);
            }}
          />{' '}
          {p.form.text(o.label, field.scope) ?? String(o.value)}
        </label>
      ))}
    </div>
  );
}

function Entries(p: ControlProps) {
  const field = p.field;
  const isMap = field.decl.type === 'map';
  const entries: [unknown, unknown][] = isMap
    ? field.value instanceof Map
      ? [...field.value]
      : []
    : field.value && typeof field.value === 'object'
      ? Object.entries(field.value)
      : [];
  const [key, setKey] = useState('');
  const keyDecl = isMap
    ? deref({ defs: p.form.spec.defs, presets: p.form.format.presets }, (field.decl as { keys: FieldDecl }).keys)
    : undefined;
  const numeric = keyDecl?.type === 'int' || keyDecl?.type === 'number';
  /** A typed key as the key it stands for, or what is wrong with it. */
  const readKey = (typed: string): { key: unknown } | { error: string } => {
    if (typed === '') return { error: 'Enter a key' };
    const k = numeric ? Number(typed) : typed;
    if (numeric && (Number.isNaN(k) || (keyDecl?.type === 'int' && !Number.isInteger(k))))
      return { error: keyDecl?.type === 'int' ? 'Enter a whole number' : 'Enter a number' };
    if (entries.some(([existing]) => String(existing) === String(k))) return { error: `"${typed}" is already a key` };
    return { key: k };
  };
  const add = () => {
    const read = readKey(key);
    if ('error' in read) return;
    const values = (field.decl as { values: FieldDecl }).values;
    const at = joinPointer(field.path, String(read.key));
    const initial = initialValue(p.form.spec, values, p.form.values, at, { format: p.form.format });
    if (isMap) {
      const next = new Map(field.value instanceof Map ? field.value : []);
      next.set(read.key, initial);
      p.set(next);
    } else {
      p.form.set(at, initial ?? '');
    }
    setKey('');
  };
  /** Renames an entry in place, keeping its value and its position. */
  const rename = (from: unknown, typed: string): string | undefined => {
    if (typed === String(from)) return undefined;
    const read = readKey(typed);
    if ('error' in read) return read.error;
    const renamed = entries.map(([k, v]): [unknown, unknown] => [Object.is(k, from) ? read.key : k, v]);
    p.set(isMap ? new Map(renamed) : Object.fromEntries(renamed));
    return undefined;
  };
  const item = p.fieldNode?.item;
  return (
    <div className="fs-entries" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map(([k], i) => {
        const at = joinPointer(field.path, String(k));
        return (
          // By position, so a row keeps its focus and drafts while its key changes.
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
            <KeyInput value={String(k)} disabled={!!p.disabled} rename={(typed) => rename(k, typed)} />
            <div style={{ flex: 1, minWidth: 0 }}>{item && p.render(item, at, { item: at })}</div>
            <button type="button" aria-label="Remove" disabled={p.disabled} onClick={() => p.form.removeItem(at)}>
              ✕
            </button>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="fs-input"
          placeholder="New key"
          value={key}
          disabled={p.disabled}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <button type="button" disabled={p.disabled || key === ''} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * An object's fields. An absent object (an optional one, say) is offered rather than drawn: its
 * fields would have nothing to show, and a definition that may contain itself would draw
 * itself without end.
 */
function Fields(p: ControlProps) {
  const field = p.field;
  const value = field.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const add = () =>
      p.set(initialValue(p.form.spec, { ...field.decl, optional: false }, p.form.values, field.path, { format: p.form.format }) ?? {});
    return (
      <div>
        <button type="button" disabled={p.disabled} onClick={add}>
          Add
        </button>
      </div>
    );
  }
  return (
    <>
      {p.fieldNode?.inner && p.render(p.fieldNode.inner, field.path)}
      {field.decl.optional && (
        <div>
          <button type="button" disabled={p.disabled} onClick={() => p.set(undefined)}>
            Remove
          </button>
        </div>
      )}
    </>
  );
}

/** An entry's key, edited in place: it takes effect on Enter or leaving the box, and Escape puts it back. */
function KeyInput({ value, disabled, rename }: { value: string; disabled: boolean; rename: (typed: string) => string | undefined }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | undefined>();
  // A rename from outside replaces what is being typed.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => setError(rename(draft));
  return (
    <div className="fs-key" style={{ width: '10rem', flex: 'none' }}>
      <input
        className="fs-input"
        aria-label="Key"
        value={draft}
        disabled={disabled}
        aria-invalid={error !== undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(value);
            setError(undefined);
          }
        }}
      />
      {error && <div className="fs-errors">{error}</div>}
    </div>
  );
}

function Variant(p: ControlProps) {
  const field = p.field;
  const v = field.decl as VariantField;
  // Mixed, the values are of different variants: choosing one sets it, fresh, everywhere.
  const current = field.mixed ? undefined : (field.value as Record<string, unknown> | undefined)?.[v.key];
  const inner = typeof current === 'string' ? p.fieldNode?.variants?.[current] : undefined;
  return (
    <div style={column}>
      <select
        id={p.id}
        className="fs-select"
        value={typeof current === 'string' ? current : ''}
        disabled={p.disabled}
        onChange={(e) => p.set({ [v.key]: e.target.value })}
      >
        {current === undefined && <option value="">{field.mixed ? MIXED : 'Choose…'}</option>}
        {Object.keys(v.variants).map((name) => (
          <option key={name} value={name}>
            {p.form.text(v.variants[name]!.label, field.scope) ?? name}
          </option>
        ))}
      </select>
      {inner && p.render(inner, field.path)}
    </div>
  );
}

const controlRenderers: { readonly [E in ControlElement]: ElementRenderer<ControlProps> } = {
  input: Input,
  textarea: (p) => <ParsedText p={p} parse={parserFor(p.form.format, p.field.decl.type)} multiline />,
  select: Select,
  radio: (p) => <Choices {...p} segmented={false} />,
  segmented: (p) => <Choices {...p} segmented />,
  checkbox: ({ field, id, disabled, set, touch }) => (
    <input
      id={id}
      type="checkbox"
      ref={indeterminate(field)}
      checked={!field.mixed && field.value === true}
      disabled={disabled}
      onChange={(e) => set(e.target.checked)}
      onBlur={touch}
    />
  ),
  switch: ({ field, id, disabled, set, touch }) => (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className="fs-switch"
      ref={indeterminate(field)}
      checked={!field.mixed && field.value === true}
      disabled={disabled}
      onChange={(e) => set(e.target.checked)}
      onBlur={touch}
    />
  ),
  slider: Slider,
  date: (p) => {
    const time = (p.field.decl as { time?: boolean }).time === true;
    return (
      <ParsedText
        p={p}
        type={time ? 'datetime-local' : 'date'}
        parse={{
          show: (v) => dateText(v, time),
          read: (t) => {
            const d = time ? new Date(t) : new Date(`${t}T00:00:00Z`);
            return Number.isNaN(d.getTime()) ? fail('Enter a date') : ok(d);
          },
        }}
      />
    );
  },
  color: ({ field, id, disabled, set, touch, props }) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        id={id}
        type="color"
        value={typeof field.value === 'string' && field.value ? field.value : '#000000'}
        disabled={disabled}
        onChange={(e) => set(e.target.value)}
        onBlur={touch}
      />
      <code className={field.mixed ? 'fs-mixed' : undefined}>{field.mixed ? MIXED : textOf(field.value)}</code>
      {Array.isArray(props.swatches) &&
        props.swatches.map((c) => (
          <button
            key={String(c)}
            type="button"
            className="fs-swatch"
            aria-label={`Use ${String(c)}`}
            aria-pressed={!field.mixed && field.value === c}
            disabled={disabled}
            onClick={() => set(c)}
            style={{ background: String(c), width: 22, height: 22, padding: 0, borderRadius: 999 }}
          />
        ))}
    </div>
  ),
  file: ({ field, id, disabled, set, touch }) => {
    const size = field.value instanceof Uint8Array ? field.value.length : 0;
    const accept = (field.decl as { accept?: readonly string[] }).accept;
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          id={id}
          type="file"
          disabled={disabled}
          {...(accept && { accept: accept.join(',') })}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return touch();
            void file.arrayBuffer().then((bytes) => {
              set(new Uint8Array(bytes));
              touch();
            });
          }}
        />
        <span className="fs-help">{size > 0 ? `${size.toLocaleString()} bytes` : 'Empty'}</span>
      </div>
    );
  },
  checks: Checks,
  list: List,
  entries: Entries,
  variant: Variant,
  fields: Fields,
};

export const defaultRenderers: Renderers = { ...layoutRenderers, ...controlRenderers };

/** Optional default look. Everything is classed `fs-*`; style it your own way instead if you like. */
export const defaultStyles = `
[data-fieldspec] { font: inherit; color: inherit; }
[data-fieldspec] .fs-field { display: flex; flex-direction: column; gap: 4px; }
[data-fieldspec] .fs-label { font-weight: 600; font-size: 0.875rem; }
[data-fieldspec] .fs-inline .fs-label { font-weight: 500; display: flex; gap: 8px; align-items: center; }
[data-fieldspec] .fs-input, [data-fieldspec] .fs-select, [data-fieldspec] .fs-textarea {
  font: inherit; padding: 6px 8px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 6px; background: transparent; color: inherit; width: 100%; box-sizing: border-box;
}
[data-fieldspec] .fs-textarea { min-height: 5rem; }
[data-fieldspec] .fs-with-unit { display: flex; align-items: center; gap: 8px; }
[data-fieldspec] .fs-unit { font-size: 0.875rem; opacity: 0.7; white-space: nowrap; }
[data-fieldspec] [aria-invalid="true"] { border-color: #d14343; }
[data-fieldspec] .fs-help { font-size: 0.8125rem; opacity: 0.7; margin: 0; }
[data-fieldspec] .fs-errors { color: #d14343; font-size: 0.8125rem; margin: 0; padding: 0; list-style: none; }
[data-fieldspec] .fs-title { font-weight: 600; font-size: 0.875rem; }
[data-fieldspec] .fs-section, [data-fieldspec] .fs-collapsible, [data-fieldspec] .fs-group {
  border: 1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius: 10px; padding: 12px 14px; margin: 0;
  display: flex; flex-direction: column; gap: 12px;
}
[data-fieldspec] .fs-group { gap: 4px; }
[data-fieldspec] .fs-section > legend, [data-fieldspec] .fs-collapsible > legend, [data-fieldspec] .fs-group > legend { padding: 0 4px; }
[data-fieldspec] fieldset { min-width: 0; } /* browsers keep fieldsets as wide as their content; let nested ones shrink */
[data-fieldspec] .fs-collapsible:not([data-open]) { padding-bottom: 0; }
[data-fieldspec] .fs-toggle { border: 0; padding: 0; background: none; font-weight: 600; display: inline-flex; gap: 6px; align-items: center; }
[data-fieldspec] .fs-toggle::before { content: "▸"; font-size: 0.75em; transition: transform 0.15s; }
[data-fieldspec] .fs-toggle[aria-expanded="true"]::before { transform: rotate(90deg); }
[data-fieldspec] .fs-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
[data-fieldspec] .fs-segmented { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 6px; overflow: hidden; width: fit-content; }
[data-fieldspec] .fs-segmented label { padding: 4px 12px; cursor: pointer; }
[data-fieldspec] .fs-segmented label + label { border-left: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
[data-fieldspec] .fs-segmented input { position: absolute; opacity: 0; pointer-events: none; }
[data-fieldspec] .fs-segmented [data-checked] { background: color-mix(in srgb, currentColor 14%, transparent); font-weight: 600; }
[data-fieldspec] .fs-switch { appearance: none; width: 2.1em; height: 1.2em; border-radius: 999px; background: color-mix(in srgb, currentColor 22%, transparent); position: relative; cursor: pointer; margin: 0; transition: background 0.15s; }
[data-fieldspec] .fs-switch::after { content: ""; position: absolute; top: 0.15em; left: 0.15em; width: 0.9em; height: 0.9em; border-radius: 50%; background: white; transition: transform 0.15s; }
[data-fieldspec] .fs-switch:checked { background: #3b82f6; }
[data-fieldspec] .fs-switch:checked::after { transform: translateX(0.9em); }
[data-fieldspec] .fs-switch:indeterminate::after { transform: translateX(0.45em); }
[data-fieldspec] .fs-mixed { opacity: 0.6; font-style: italic; }
[data-fieldspec] .fs-handle { cursor: grab; user-select: none; padding: 4px 2px; opacity: 0.5; line-height: 1.6; }
[data-fieldspec] .fs-handle:hover, [data-fieldspec] .fs-handle:focus-visible { opacity: 1; }
[data-fieldspec] .fs-item[data-dragging] { opacity: 0.4; }
[data-fieldspec] .fs-item[data-drop="before"] { box-shadow: 0 -2px 0 #3b82f6; }
[data-fieldspec] .fs-item[data-drop="after"] { box-shadow: 0 2px 0 #3b82f6; }
[data-fieldspec] .fs-key .fs-input { width: 100%; box-sizing: border-box; }
[data-fieldspec] .fs-warning { color: #b7791f; }
[data-fieldspec] .fs-muted { opacity: 0.7; }
:where([data-fieldspec] button) { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; color: inherit; cursor: pointer; }
:where([data-fieldspec] button:disabled) { opacity: 0.4; cursor: default; }
[data-fieldspec] [role="tab"][aria-selected="true"] { background: color-mix(in srgb, currentColor 12%, transparent); }
[data-fieldspec] .fs-divider { border: 0; border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent); width: 100%; }
`;

export { type FieldState, type Form };
