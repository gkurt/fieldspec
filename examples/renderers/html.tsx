import { deref, type FieldDecl, type FieldState } from 'fieldspec';
import {
  checksOf,
  choicesOf,
  defineRenderers,
  entriesOf,
  listOf,
  objectOf,
  parserFor,
  useParsedText,
  variantOf,
  type ControlProps,
  type FieldProps,
  type LayoutProps,
  type Parse,
  type Renderers,
} from 'fieldspec/react';
/**
 * fieldspec's forms in plain HTML: inputs, selects, fieldsets, a list whose items reorder by
 * dragging or the keyboard, a record whose keys are renamed in place. An example renderer set to
 * copy and restyle; `htmlStyles` is its look, all `fs-*` classes.
 *
 * `<FormView form={form} renderers={htmlRenderers} />`, with `<style>{htmlStyles}</style>` once.
 */
import { createContext, use, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** A value as text: JSON for objects and lists, which have no text of their own. */
const textOf = (v: unknown): string => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
const ok = (value: unknown) => ({ ok: true as const, value });
const fail = (error: string) => ({ ok: false as const, error });

// ── Layout and parts ─────────────────────────────────────────────────────────────────────

const gaps = { none: 0, sm: 8, md: 12, lg: 20 } as const;
const text = (v: unknown) => (v === undefined || v === null ? undefined : textOf(v));
/** A length for CSS: a number is pixels. */
const cssLength = (v: unknown) => (typeof v === 'number' ? `${v}px` : textOf(v));
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

const layoutRenderers = defineRenderers({
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
});

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

function Choices(p: ControlProps & { segmented: boolean }) {
  const { field, id, disabled, touch, segmented } = p;
  const { options, index, choose } = choicesOf(p);
  return (
    <div
      role="radiogroup"
      id={id}
      className={segmented ? 'fs-segmented' : 'fs-radio'}
      style={{ display: 'flex', gap: segmented ? 0 : 12, flexWrap: 'wrap' }}
      data-mixed={field.mixed ? '' : undefined}
    >
      {options.map((o, i) => (
        <label key={i} title={o.description} data-checked={i === index ? '' : undefined}>
          <input type="radio" name={id} checked={i === index} disabled={disabled} onChange={() => choose(i)} onBlur={touch} /> {o.label}
        </label>
      ))}
    </div>
  );
}

function Select(p: ControlProps) {
  const { field, id, disabled, touch } = p;
  const { options, index, choose } = choicesOf(p);
  return (
    <select id={id} className="fs-select" value={index} disabled={disabled} onChange={(e) => choose(Number(e.target.value))} onBlur={touch}>
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
  const { field } = p;
  const list = listOf(p);
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
  if (field.decl.type === 'set') return <SetLines {...p} />;
  // Items reorder by dragging their handle, or with the arrow keys while it has the focus.
  return (
    <div ref={box} className="fs-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.items.map(({ index: i, render }) => {
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
              if (drag) list.move(drag.from, i);
              setDrag(undefined);
            }}
          >
            {/* A span, not a button: Firefox does not drag buttons. */}
            <span
              className="fs-handle"
              role="button"
              tabIndex={p.disabled ? -1 : 0}
              aria-disabled={p.disabled || undefined}
              aria-label={`Move item ${i + 1} of ${list.items.length}`}
              aria-keyshortcuts="ArrowUp ArrowDown"
              draggable={!p.disabled}
              title="Drag, or use the arrow keys, to reorder"
              onKeyDown={(e) => {
                const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
                if (p.disabled || to < 0 || to >= list.items.length) return;
                e.preventDefault();
                refocus.current = to;
                list.move(i, to);
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
            <div style={{ flex: 1, minWidth: 0 }}>{render()}</div>
            <button type="button" aria-label="Remove" disabled={p.disabled} onClick={() => list.remove(i)}>
              ✕
            </button>
          </div>
        );
      })}
      <div>
        <button type="button" disabled={!list.canAdd} onClick={() => list.add()}>
          {text(p.props.addLabel) ?? 'Add'}
        </button>
      </div>
    </div>
  );
}

/** A set's items have no stable position to point at, so they are edited as lines. */
function SetLines(p: ControlProps) {
  const { field } = p;
  const items = field.value instanceof Set ? [...field.value] : [];
  const kind = deref({ defs: p.form.spec.defs, presets: p.form.format.presets }, (field.decl as { items: FieldDecl }).items).type;
  const numeric = kind === 'int' || kind === 'number';
  return (
    <textarea
      id={p.id}
      className="fs-textarea"
      disabled={p.disabled}
      defaultValue={items.map(textOf).join('\n')}
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

function Checks(p: ControlProps) {
  const checks = checksOf(p);
  if (!checks) return <List {...p} />;
  return (
    <div className="fs-checks" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {checks.options.map((o, i) => (
        <label key={i}>
          <input
            type="checkbox"
            disabled={p.disabled}
            checked={o.checked}
            onChange={(e) => checks.toggle(i, e.target.checked)}
            onBlur={p.touch}
          />{' '}
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Entries(p: ControlProps) {
  const entries = entriesOf(p);
  const [key, setKey] = useState('');
  const add = () => {
    if (entries.add(key) === undefined) setKey('');
  };
  return (
    <div className="fs-entries" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.entries.map((entry, i) => (
        // By position, so a row keeps its focus and drafts while its key changes.
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
          <KeyInput value={entry.label} disabled={p.disabled} rename={(typed) => entries.rename(entry.key, typed)} />
          <div style={{ flex: 1, minWidth: 0 }}>{entry.render()}</div>
          <button type="button" aria-label="Remove" disabled={p.disabled} onClick={() => entries.remove(entry.key)}>
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="fs-input"
          placeholder="New key"
          value={key}
          disabled={p.disabled}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            add();
          }}
        />
        <button type="button" disabled={p.disabled || key === ''} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

/** An object's fields; an absent one is offered with an Add button rather than drawn. */
function Fields(p: ControlProps) {
  const object = objectOf(p);
  if (!object.present) {
    return (
      <div>
        <button type="button" disabled={p.disabled} onClick={object.add}>
          Add
        </button>
      </div>
    );
  }
  return (
    <>
      {object.render()}
      {object.optional && (
        <div>
          <button type="button" disabled={p.disabled} onClick={object.remove}>
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
  const variant = variantOf(p);
  return (
    <div style={column}>
      <select
        id={p.id}
        className="fs-select"
        value={variant.current ?? ''}
        disabled={p.disabled}
        onChange={(e) => variant.choose(e.target.value)}
        onBlur={p.touch}
      >
        {variant.current === undefined && <option value="">{p.field.mixed ? MIXED : 'Choose…'}</option>}
        {variant.options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.label}
          </option>
        ))}
      </select>
      {variant.render()}
    </div>
  );
}

const controlRenderers = defineRenderers({
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
});

/** Every built-in element, in plain HTML. */
export const htmlRenderers: Renderers = { ...layoutRenderers, ...controlRenderers };

/** The look of `htmlRenderers`. Everything is classed `fs-*`; style it your own way instead if you like. */
export const htmlStyles = `
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
