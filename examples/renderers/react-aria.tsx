/**
 * An example renderer set: React Aria Components drawing fieldspec forms. fieldspec keeps the form (values, conditions,
 * validation, lists, layouts); React Aria draws its controls: text and number fields, sliders,
 * switches, checkboxes, selects, radio and toggle-button groups, date pickers and colour
 * fields, each with its own label, help and errors, and their accessibility. Controls React
 * Aria has none for here (lists, records, variants, files) keep the HTML set's (./html.tsx).
 * Needs `react-aria-components` and `@internationalized/date`.
 *
 * Use `reactAriaRenderers` with `FormView`. React Aria is unstyled: `reactAriaStyles` is a
 * starting look, over the HTML set's `htmlStyles`.
 */
import type { CalendarDate, CalendarDateTime } from '@internationalized/date';
import { parseDate, parseDateTime } from '@internationalized/date';
import { defaultControl, deref, optionsOf, type EnumField, type FieldDecl, type LayoutNode } from 'fieldspec';
import {
  defineRenderers,
  parserFor,
  useParsedText,
  useRenderer,
  type ControlProps,
  type ElementRenderer,
  type FieldProps,
  type FieldState,
  type Renderers,
} from 'fieldspec/react';
import type { ReactNode } from 'react';
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  Checkbox,
  CheckboxGroup,
  ColorField,
  ColorSwatch,
  ColorSwatchPicker,
  ColorSwatchPickerItem,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  FieldError,
  Group,
  Heading,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  NumberField,
  parseColor,
  Popover,
  Radio,
  RadioGroup,
  Select,
  SelectValue,
  Slider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  Switch,
  Text,
  TextArea,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from 'react-aria-components';
import { htmlRenderers } from './html.tsx';

const CONTAINER_KINDS = new Set(['object', 'variant', 'array', 'set', 'record', 'map']);

// ── What every control carries ───────────────────────────────────────────────────────────

const invalid = (f: FieldState) => f.showIssues && f.issues.length > 0;

/** The props React Aria's fields share: state, and errors shown only by fieldspec's rules. */
function common(p: ControlProps) {
  const f = p.field;
  return { isDisabled: p.disabled, isRequired: f.required, isInvalid: invalid(f), validationBehavior: 'aria' as const };
}

/** A field's label: an item's is for screen readers only, its key or position names it. */
function FieldLabel({ field, node, as: As = Label }: { field: FieldState; node: LayoutNode; as?: typeof Label }) {
  return (
    <As className={node.field === '' ? 'fs-label fs-sr-only' : 'fs-label'}>
      {field.label}
      {field.required && <span aria-hidden="true"> *</span>}
    </As>
  );
}

/** Help and errors, in React Aria's slots so its controls describe themselves by them. */
function Notes({ field, extra }: { field: FieldState; extra?: string | undefined }) {
  const help = [field.description, field.hint].filter(Boolean).join(' ');
  return (
    <>
      {help && (
        <Text slot="description" className="fs-help">
          {help}
        </Text>
      )}
      <FieldError className="fs-errors">{[extra, ...field.issues.map((i) => i.message)].filter(Boolean).join(' ')}</FieldError>
    </>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────────────────────

/** Text, and any kind typed as text: what is typed stays until it parses. */
function AriaText(p: ControlProps & { multiline?: boolean }) {
  const f = p.field;
  const { draft, error, placeholder, change } = useParsedText(p, parserFor(p.form.format, f.decl.type));
  const format = (f.decl as { format?: string }).format;
  const type = p.props.secret ? 'password' : format === 'email' ? 'email' : format === 'uri' || f.decl.type === 'url' ? 'url' : 'text';
  return (
    <TextField
      className="fs-aria-text"
      value={draft}
      onChange={change}
      onBlur={p.touch}
      {...common(p)}
      isInvalid={invalid(f) || !!error}
      type={type}
    >
      <FieldLabel field={f} node={p.node} />
      {p.multiline ? (
        <TextArea className="fs-textarea" placeholder={placeholder} />
      ) : (
        <Input className="fs-input" placeholder={placeholder} />
      )}
      <Notes field={f} extra={error} />
    </TextField>
  );
}

/** A number, with steppers; an empty field is no value. */
function AriaNumber(p: ControlProps) {
  const f = p.field;
  const d = f.decl as { min?: number; max?: number; step?: number; unit?: string };
  return (
    <NumberField
      className="fs-aria-number"
      value={typeof f.value === 'number' && !f.mixed ? f.value : Number.NaN}
      onChange={(v) => p.set(Number.isNaN(v) ? undefined : v)}
      onBlur={p.touch}
      {...(d.min !== undefined && { minValue: d.min })}
      {...(d.max !== undefined && { maxValue: d.max })}
      step={d.step ?? (f.decl.type === 'int' ? 1 : undefined)}
      {...common(p)}
    >
      <FieldLabel field={f} node={p.node} />
      <Group className="fs-aria-group">
        <Button slot="decrement">−</Button>
        <Input className="fs-input" placeholder={f.mixed ? 'Mixed' : f.placeholder} />
        <Button slot="increment">+</Button>
        {d.unit && <span className="fs-aria-unit">{d.unit}</span>}
      </Group>
      <Notes field={f} />
    </NumberField>
  );
}

function AriaInput(p: ControlProps) {
  const type = p.field.decl.type;
  return (type === 'number' || type === 'int') && !p.props.secret ? <AriaNumber {...p} /> : <AriaText {...p} />;
}

function AriaSlider(p: ControlProps) {
  const f = p.field;
  const d = f.decl as { min?: number; max?: number; step?: number; unit?: string };
  const percent = p.props.format === 'percent';
  const min = d.min ?? 0;
  return (
    <Slider
      className="fs-aria-slider"
      value={typeof f.value === 'number' ? f.value : min}
      onChange={(v) => p.set(v)}
      onChangeEnd={p.touch}
      minValue={min}
      maxValue={d.max ?? 100}
      step={d.step ?? (f.decl.type === 'int' ? 1 : percent ? 0.01 : 1)}
      isDisabled={p.disabled}
      {...(percent && { formatOptions: { style: 'percent' } })}
    >
      <div className="fs-aria-row">
        <FieldLabel field={f} node={p.node} />
        <SliderOutput className="fs-aria-output">
          {({ state }) => (f.mixed ? 'Mixed' : `${state.getThumbValueLabel(0)}${!percent && d.unit ? d.unit : ''}`)}
        </SliderOutput>
      </div>
      <SliderTrack className="fs-aria-track">
        <SliderThumb className="fs-aria-thumb" />
      </SliderTrack>
      <SliderNotes field={f} />
    </Slider>
  );
}

/** A slider has no error slot; its help and errors sit under it. */
function SliderNotes({ field }: { field: FieldState }) {
  const help = [field.description, field.hint].filter(Boolean).join(' ');
  return (
    <>
      {help && <div className="fs-help">{help}</div>}
      {invalid(field) && (
        <div className="fs-errors" role="alert">
          {field.issues.map((i) => i.message).join(' ')}
        </div>
      )}
    </>
  );
}

function AriaCheckbox(p: ControlProps) {
  const f = p.field;
  return (
    <Checkbox
      className="fs-aria-checkbox"
      isSelected={!f.mixed && f.value === true}
      isIndeterminate={f.mixed}
      onChange={(v) => {
        p.set(v);
        p.touch();
      }}
      {...common(p)}
    >
      <span className="fs-aria-box" aria-hidden="true" />
      <FieldLabel field={f} node={p.node} as={Plain} />
    </Checkbox>
  );
}

function AriaSwitch(p: ControlProps) {
  const f = p.field;
  return (
    <Switch
      className="fs-aria-switch"
      isSelected={!f.mixed && f.value === true}
      onChange={(v) => {
        p.set(v);
        p.touch();
      }}
      isDisabled={p.disabled}
    >
      <span className="fs-aria-knob" aria-hidden="true" />
      <FieldLabel field={f} node={p.node} as={Plain} />
    </Switch>
  );
}

/** Inside a checkbox or switch, which is its own label. */
const Plain = (({ className, children }: { className?: string; children?: ReactNode }) => (
  <span className={className}>{children}</span>
)) as unknown as typeof Label;

/** Options by position: they may repeat a value, or differ only in type (1 and "1"). */
function indexOf(f: FieldState) {
  const options = f.options ?? [];
  const i = f.mixed ? -1 : options.findIndex((o) => Object.is(o.value, f.value));
  return { options, key: i < 0 ? null : String(i) };
}

function AriaSelect(p: ControlProps) {
  const f = p.field;
  const { options, key } = indexOf(f);
  return (
    <Select
      className="fs-aria-select"
      value={key}
      onChange={(k) => {
        if (k !== null) p.set(options[Number(k)]?.value);
        p.touch();
      }}
      placeholder={f.mixed ? 'Mixed' : (f.placeholder ?? 'Choose…')}
      {...common(p)}
    >
      <FieldLabel field={f} node={p.node} />
      <Button className="fs-aria-button">
        <SelectValue />
        <span aria-hidden="true">▾</span>
      </Button>
      <Notes field={f} />
      <Popover className="fs-aria-popover">
        <ListBox className="fs-aria-listbox">
          {options.map((o, i) => (
            <ListBoxItem key={i} id={String(i)} className="fs-aria-option">
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}

function AriaRadio(p: ControlProps) {
  const f = p.field;
  const { options, key } = indexOf(f);
  return (
    <RadioGroup
      className="fs-aria-radios"
      value={key}
      onChange={(k) => {
        p.set(options[Number(k)]?.value);
        p.touch();
      }}
      orientation="horizontal"
      {...common(p)}
    >
      <FieldLabel field={f} node={p.node} />
      <div className="fs-aria-choices">
        {options.map((o, i) => (
          <Radio key={i} value={String(i)} className="fs-aria-radio">
            <span className="fs-aria-dot" aria-hidden="true" />
            {o.label}
          </Radio>
        ))}
      </div>
      <Notes field={f} />
    </RadioGroup>
  );
}

/** One of a few, as a row of toggle buttons. The group has no label of its own: it is named by one. */
function AriaSegmented(p: ControlProps) {
  const f = p.field;
  const { options, key } = indexOf(f);
  const labelId = `${p.id}-label`;
  return (
    <div className="fs-aria-segmented">
      <span id={labelId} className={p.node.field === '' ? 'fs-label fs-sr-only' : 'fs-label'}>
        {f.label}
        {f.required && <span aria-hidden="true"> *</span>}
      </span>
      <ToggleButtonGroup
        aria-labelledby={labelId}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={key === null ? [] : [key]}
        onSelectionChange={(keys) => {
          const k = [...keys][0];
          if (k !== undefined) p.set(options[Number(k)]?.value);
          p.touch();
        }}
        isDisabled={p.disabled}
        className="fs-aria-toggles"
      >
        {options.map((o, i) => (
          <ToggleButton key={i} id={String(i)} className="fs-aria-toggle">
            {o.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <SliderNotes field={f} />
    </div>
  );
}

const itemsOf = (p: Pick<ControlProps, 'form' | 'field'>) =>
  deref({ defs: p.form.spec.defs, presets: p.form.format.presets }, (p.field.decl as { items: FieldDecl }).items);

/** A set of options, as checkboxes; other sets are lists. */
function AriaChecks(p: ControlProps) {
  const f = p.field;
  const items = itemsOf(p);
  if (items.type !== 'enum') return htmlRenderers.list!(p);
  const options = optionsOf(items as EnumField, { values: p.form.values }, f.scope);
  const set = f.value instanceof Set ? f.value : new Set();
  return (
    <CheckboxGroup
      className="fs-aria-checks"
      value={options.flatMap((o, i) => (set.has(o.value) ? [String(i)] : []))}
      onChange={(keys) => {
        p.set(new Set(keys.map((k) => options[Number(k)]!.value)));
        p.touch();
      }}
      {...common(p)}
    >
      <FieldLabel field={f} node={p.node} />
      <div className="fs-aria-choices">
        {options.map((o, i) => (
          <Checkbox key={i} value={String(i)} className="fs-aria-checkbox">
            <span className="fs-aria-box" aria-hidden="true" />
            {p.form.text(o.label, f.scope) ?? String(o.value)}
          </Checkbox>
        ))}
      </div>
      <Notes field={f} />
    </CheckboxGroup>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A date is a day in UTC, as fieldspec's own date control reads it; with a time, a local moment. */
function toCalendar(value: unknown, time: boolean): CalendarDate | CalendarDateTime | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  if (!time) return parseDate(value.toISOString().slice(0, 10));
  const v = value;
  return parseDateTime(`${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}T${pad(v.getHours())}:${pad(v.getMinutes())}`);
}

function fromCalendar(value: CalendarDate | CalendarDateTime | null, time: boolean): Date | undefined {
  if (value === null) return undefined;
  return time ? new Date(value.toString()) : new Date(`${value.toString().slice(0, 10)}T00:00:00Z`);
}

function AriaDate(p: ControlProps) {
  const f = p.field;
  const time = (f.decl as { time?: boolean }).time === true;
  return (
    <DatePicker
      className="fs-aria-date"
      value={f.mixed ? null : toCalendar(f.value, time)}
      onChange={(v) => p.set(fromCalendar(v, time))}
      onBlur={p.touch}
      granularity={time ? 'minute' : 'day'}
      {...common(p)}
    >
      <FieldLabel field={f} node={p.node} />
      <Group className="fs-aria-group">
        <DateInput className="fs-aria-dateinput">{(segment) => <DateSegment segment={segment} className="fs-aria-segment" />}</DateInput>
        <Button className="fs-aria-button" aria-label="Open the calendar">
          ▾
        </Button>
      </Group>
      <Notes field={f} />
      <Popover className="fs-aria-popover">
        <Dialog className="fs-aria-dialog">
          <Calendar className="fs-aria-calendar">
            <header>
              <Button slot="previous">‹</Button>
              <Heading />
              <Button slot="next">›</Button>
            </header>
            <CalendarGrid>{(date) => <CalendarCell date={date} className="fs-aria-day" />}</CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </DatePicker>
  );
}

const colorOf = (v: unknown) => {
  try {
    return typeof v === 'string' && v ? parseColor(v) : null;
  } catch {
    return null;
  }
};

/** A colour typed as hex, with a swatch, and the field's swatches to pick from. */
function AriaColor(p: ControlProps) {
  const f = p.field;
  const value = f.mixed ? null : colorOf(f.value);
  const swatches = Array.isArray(p.props.swatches) ? p.props.swatches.map(String).filter((c) => colorOf(c)) : [];
  return (
    <div className="fs-aria-color">
      <ColorField
        className="fs-aria-colorfield"
        value={value}
        onChange={(c) => {
          if (c) p.set(c.toString('hex'));
        }}
        onBlur={p.touch}
        {...common(p)}
      >
        <FieldLabel field={f} node={p.node} />
        <Group className="fs-aria-group">
          <ColorSwatch className="fs-aria-swatch" color={value ?? '#0000'} />
          <Input className="fs-input" placeholder={f.mixed ? 'Mixed' : '#rrggbb'} />
        </Group>
        <Notes field={f} />
      </ColorField>
      {swatches.length > 0 && (
        <ColorSwatchPicker
          aria-label={`${f.label} swatches`}
          className="fs-aria-swatches"
          {...(value && { value })}
          onChange={(c) => {
            p.set(c.toString('hex'));
            p.touch();
          }}
        >
          {swatches.map((c) => (
            <ColorSwatchPickerItem key={c} color={c} className="fs-aria-swatchitem" isDisabled={p.disabled}>
              <ColorSwatch className="fs-aria-swatch" />
            </ColorSwatchPickerItem>
          ))}
        </ColorSwatchPicker>
      )}
    </div>
  );
}

// ── The table ────────────────────────────────────────────────────────────────────────────

const ARIA_RENDERERS = new Set<ElementRenderer>([
  AriaInput,
  AriaTextarea,
  AriaSlider,
  AriaCheckbox,
  AriaSwitch,
  AriaSelect,
  AriaRadio,
  AriaSegmented,
  AriaChecks,
  AriaDate,
  AriaColor,
]);

function AriaTextarea(p: ControlProps) {
  return <AriaText {...p} multiline />;
}

/**
 * A field: React Aria's controls carry their own label, help and errors, so the field is only
 * their frame. Containers, and any control that is not React Aria's, keep fieldspec's frame.
 */
function AriaField(p: FieldProps) {
  const field = p.field;
  const control = p.node.control?.type ?? defaultControl(p.form.format, field.decl);
  const drawer = useRenderer({
    element: control,
    role: 'control',
    explicit: p.node.control?.explicit === true,
    node: p.node,
    field,
    form: p.form,
  });
  const checks = drawer === AriaChecks && itemsOf(p).type === 'enum';
  if ((CONTAINER_KINDS.has(field.decl.type) && !checks) || !ARIA_RENDERERS.has(drawer)) return htmlRenderers.field!(p);
  return (
    <div
      className="fs-field fs-aria-field"
      data-kind={field.decl.type}
      data-invalid={invalid(field) ? '' : undefined}
      data-mixed={field.mixed ? '' : undefined}
    >
      {p.control()}
    </div>
  );
}

/** The default renderers, with React Aria's controls laid over. */
export const reactAriaRenderers: Renderers = {
  ...htmlRenderers,
  ...defineRenderers({
    field: AriaField,
    input: AriaInput,
    textarea: AriaTextarea,
    slider: AriaSlider,
    checkbox: AriaCheckbox,
    switch: AriaSwitch,
    select: AriaSelect,
    radio: AriaRadio,
    segmented: AriaSegmented,
    checks: AriaChecks,
    date: AriaDate,
    color: AriaColor,
  }),
};

/**
 * A starting look for React Aria's controls, using its state attributes. Use with `defaultStyles`.
 * Colours follow the text's; set `--fs-accent`, `--fs-bg`, `--fs-border`, `--fs-muted` and
 * `--fs-danger` to match yours.
 */
export const reactAriaStyles = `
[data-fieldspec] .fs-aria-text, [data-fieldspec] .fs-aria-number, [data-fieldspec] .fs-aria-select, [data-fieldspec] .fs-aria-date,
[data-fieldspec] .fs-aria-colorfield, [data-fieldspec] .fs-aria-radios, [data-fieldspec] .fs-aria-checks, [data-fieldspec] .fs-aria-segmented { display: flex; flex-direction: column; gap: 4px; }
[data-fieldspec] .fs-aria-group { display: flex; align-items: center; gap: 6px; }
[data-fieldspec] .fs-aria-group .fs-input { flex: 1; min-width: 0; }
[data-fieldspec] .fs-aria-unit { color: var(--fs-muted, color-mix(in srgb, currentColor 60%, transparent)); font-size: 0.9em; }
[data-fieldspec] [data-invalid] > .fs-input, [data-fieldspec] [data-invalid] .fs-aria-group { border-color: var(--fs-danger, #c2362f); }
[data-fieldspec] .fs-aria-button { display: inline-flex; justify-content: space-between; align-items: center; gap: 8px; }
[data-fieldspec] .fs-aria-select .fs-aria-button { min-width: 10rem; width: fit-content; }
[data-fieldspec] .fs-aria-row { display: flex; justify-content: space-between; align-items: baseline; }
[data-fieldspec] .fs-aria-output { font-variant-numeric: tabular-nums; }
[data-fieldspec] .fs-aria-track { position: relative; height: 24px; width: 100%; }
[data-fieldspec] .fs-aria-track::before { content: ""; position: absolute; inset: 10px 0; border-radius: 2px; background: var(--fs-border, color-mix(in srgb, currentColor 25%, transparent)); }
[data-fieldspec] .fs-aria-thumb { top: 50%; width: 18px; height: 18px; border-radius: 50%; background: var(--fs-accent, #2456e6); border: 2px solid var(--fs-bg, Canvas); box-shadow: 0 0 0 1px var(--fs-accent, #2456e6); }
[data-fieldspec] .fs-aria-thumb[data-focus-visible] { outline: 2px solid var(--fs-accent, #2456e6); outline-offset: 2px; }
[data-fieldspec] .fs-aria-checkbox, [data-fieldspec] .fs-aria-switch, [data-fieldspec] .fs-aria-radio { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
[data-fieldspec] .fs-aria-box { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid var(--fs-border-strong, color-mix(in srgb, currentColor 50%, transparent)); display: grid; place-items: center; }
[data-fieldspec] .fs-aria-checkbox[data-selected] .fs-aria-box { background: var(--fs-accent, #2456e6); border-color: var(--fs-accent, #2456e6); }
[data-fieldspec] .fs-aria-checkbox[data-selected] .fs-aria-box::after { content: "✓"; color: #fff; font-size: 12px; line-height: 1; }
[data-fieldspec] .fs-aria-checkbox[data-indeterminate] .fs-aria-box::after { content: "–"; }
[data-fieldspec] .fs-aria-knob { width: 32px; height: 18px; border-radius: 9px; background: var(--fs-border, color-mix(in srgb, currentColor 25%, transparent)); position: relative; transition: background 0.15s; }
[data-fieldspec] .fs-aria-knob::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
[data-fieldspec] .fs-aria-switch[data-selected] .fs-aria-knob { background: var(--fs-accent, #2456e6); }
[data-fieldspec] .fs-aria-switch[data-selected] .fs-aria-knob::after { transform: translateX(14px); }
[data-fieldspec] .fs-aria-choices { display: flex; flex-wrap: wrap; gap: 12px; }
[data-fieldspec] .fs-aria-dot { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--fs-border-strong, color-mix(in srgb, currentColor 50%, transparent)); }
[data-fieldspec] .fs-aria-radio[data-selected] .fs-aria-dot { border: 4.5px solid var(--fs-accent, #2456e6); }
[data-fieldspec] :is(.fs-aria-checkbox, .fs-aria-switch, .fs-aria-radio)[data-focus-visible] :is(.fs-aria-box, .fs-aria-knob, .fs-aria-dot) { outline: 2px solid var(--fs-accent, #2456e6); outline-offset: 2px; }
[data-fieldspec] :is(.fs-aria-checkbox, .fs-aria-switch, .fs-aria-radio, .fs-aria-toggle)[data-disabled] { opacity: 0.5; cursor: default; }
[data-fieldspec] .fs-aria-toggles { display: inline-flex; width: fit-content; }
[data-fieldspec] .fs-aria-toggle { border-radius: 0; }
[data-fieldspec] .fs-aria-toggle:first-child { border-radius: 6px 0 0 6px; }
[data-fieldspec] .fs-aria-toggle:last-child { border-radius: 0 6px 6px 0; }
[data-fieldspec] .fs-aria-toggle[data-selected] { background: var(--fs-accent, #2456e6); color: #fff; border-color: var(--fs-accent, #2456e6); }
[data-fieldspec] .fs-aria-dateinput { display: flex; flex: 1; padding: 6px 8px; border: 1px solid var(--fs-border, color-mix(in srgb, currentColor 25%, transparent)); border-radius: 6px; }
[data-fieldspec] .fs-aria-segment { padding: 0 1px; border-radius: 3px; font-variant-numeric: tabular-nums; }
[data-fieldspec] .fs-aria-segment[data-placeholder] { color: var(--fs-muted, color-mix(in srgb, currentColor 60%, transparent)); }
[data-fieldspec] .fs-aria-segment[data-focused] { background: var(--fs-accent, #2456e6); color: #fff; outline: none; }
[data-fieldspec] .fs-aria-swatch { width: 24px; height: 24px; border-radius: 6px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15); }
[data-fieldspec] .fs-aria-swatches { display: flex; gap: 6px; margin-top: 6px; }
[data-fieldspec] .fs-aria-swatchitem { border-radius: 8px; padding: 2px; cursor: pointer; }
[data-fieldspec] .fs-aria-swatchitem[data-selected] { box-shadow: 0 0 0 2px var(--fs-accent, #2456e6); }
.fs-aria-popover { background: var(--fs-bg, Canvas); color: inherit; border: 1px solid var(--fs-border, color-mix(in srgb, currentColor 25%, transparent)); border-radius: 8px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.15); padding: 4px; min-width: var(--trigger-width); }
.fs-aria-listbox { outline: none; }
.fs-aria-option { padding: 6px 10px; border-radius: 6px; cursor: default; outline: none; }
.fs-aria-option[data-focused] { background: var(--fs-hover, rgb(36 86 230 / 0.1)); }
.fs-aria-option[data-selected] { font-weight: 600; }
.fs-aria-dialog { outline: none; padding: 6px; }
.fs-aria-calendar header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.fs-aria-calendar h2 { font-size: 1em; margin: 0; }
.fs-aria-day { width: 2rem; line-height: 2rem; text-align: center; border-radius: 6px; cursor: default; outline: none; }
.fs-aria-day[data-outside-month] { display: none; }
.fs-aria-day[data-focused] { box-shadow: inset 0 0 0 2px var(--fs-accent, #2456e6); }
.fs-aria-day[data-selected] { background: var(--fs-accent, #2456e6); color: #fff; }
`;
