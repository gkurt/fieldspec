import { Command as CommandPrimitive } from 'cmdk';
/**
 * An example renderer set: shadcn/ui drawing fieldspec forms. fieldspec keeps the form (values,
 * conditions, validation, lists, layouts); shadcn's components draw every element: `Field` for
 * labels, help and errors, inputs and input groups, selects, radio and toggle groups, checkboxes,
 * switches, sliders, a calendar in a popover for dates, a command list for suggestions, tabs,
 * collapsibles and accordions, and buttons for adding, removing and reordering items.
 *
 * `./shadcn/ui` holds shadcn's components (new-york) as `npx shadcn add` writes them, adapted to
 * this repository's lint rules (`cn` is in `./shadcn/ui/utils.ts`); in your app, import yours
 * from `@/components/ui/*`. Two are edited, as
 * shadcn means its components to be: the checkbox shows a dash for mixed values, and the slider
 * passes its label on to its thumb. Styled by Tailwind CSS 4 and your shadcn theme: there is no
 * stylesheet of its own. Needs `radix-ui`, `lucide-react`, `react-day-picker` and `cmdk`.
 *
 * `<FormView form={form} renderers={shadcnRenderers} />`
 */
import { defaultControl, deref, type FieldDecl, type FieldState } from 'fieldspec';
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
  type Renderers,
} from 'fieldspec/react';
import { CalendarIcon, ChevronRightIcon, GripVerticalIcon, PlusIcon, XIcon } from 'lucide-react';
import { createContext, use, useState, type CSSProperties, type ReactNode } from 'react';
import { useReorder } from './html.tsx';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './shadcn/ui/accordion.tsx';
import { Button } from './shadcn/ui/button.tsx';
import { Calendar } from './shadcn/ui/calendar.tsx';
import { Checkbox } from './shadcn/ui/checkbox.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './shadcn/ui/collapsible.tsx';
import { Command, CommandItem, CommandList } from './shadcn/ui/command.tsx';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from './shadcn/ui/field.tsx';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from './shadcn/ui/input-group.tsx';
import { Input } from './shadcn/ui/input.tsx';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './shadcn/ui/popover.tsx';
import { RadioGroup, RadioGroupItem } from './shadcn/ui/radio-group.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './shadcn/ui/select.tsx';
import { Separator } from './shadcn/ui/separator.tsx';
import { Slider } from './shadcn/ui/slider.tsx';
import { Switch } from './shadcn/ui/switch.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './shadcn/ui/tabs.tsx';
import { Textarea } from './shadcn/ui/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from './shadcn/ui/toggle-group.tsx';
import { cn } from './shadcn/ui/utils.ts';

/** What a control shows for a field whose values differ. */
const MIXED = 'Mixed';
const CONTAINER_KINDS = new Set(['object', 'variant', 'array', 'set', 'record', 'map']);
/** Controls that are a group of choices: their field is a fieldset, named by its legend. */
const GROUP_CONTROLS = new Set(['radio', 'segmented']);

const textOf = (v: unknown): string => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
const text = (v: unknown) => (v === undefined || v === null ? undefined : textOf(v));
const invalid = (f: FieldState) => f.showIssues && f.issues.length > 0;
/** The id of a field's label, for controls a `<label for>` cannot name (a slider's thumb, a radio group). */
const labelId = (id: string) => `${id}-label`;

// ── Layout and parts ─────────────────────────────────────────────────────────────────────

/** Set by `tabs` for its panes, whose titles are already on their tabs. */
const InTab = createContext(false);

/** A container's body, as a fieldset with a legend when it has a title. */
function Frame({
  props,
  className,
  style,
  children,
}: {
  props: Readonly<Record<string, unknown>>;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const inTab = use(InTab);
  if (props.title === undefined || inTab) {
    return (
      <div className={className} style={style}>
        <InTab.Provider value={false}>{children}</InTab.Provider>
      </div>
    );
  }
  return (
    <FieldSet className="gap-4">
      <FieldLegend className="mb-0">{text(props.title)}</FieldLegend>
      {props.description !== undefined && <FieldDescription>{text(props.description)}</FieldDescription>}
      <div className={className} style={style}>
        {children}
      </div>
    </FieldSet>
  );
}

const gaps = { none: 'gap-0', sm: 'gap-2', md: 'gap-4', lg: 'gap-6' } as const;

function Row({ children, props }: LayoutProps) {
  return (
    <Frame props={props} className={cn('flex flex-wrap', gaps[props.gap as keyof typeof gaps] ?? gaps.md)}>
      {Array.isArray(children)
        ? children.map((c, i) =>
            c ? (
              <div key={i} className="min-w-0 flex-[1_1_10rem]">
                {c}
              </div>
            ) : null,
          )
        : children}
    </Frame>
  );
}

function CollapsibleSection({ children, props }: LayoutProps) {
  const [open, setOpen] = useState(!props.collapsed);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-4 rounded-lg border px-4 py-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-mx-2 w-fit [&[data-state=open]>svg]:rotate-90">
          <ChevronRightIcon className="transition-transform" />
          {text(props.title) ?? 'Details'}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-6 pb-2">
        {props.description !== undefined && <FieldDescription>{text(props.description)}</FieldDescription>}
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function TabsSection({ node, children, props }: LayoutProps) {
  const panes = Array.isArray(children) ? children : [children];
  const titles = node.children.map((c, i) => text(c.props.title) ?? `Tab ${i + 1}`);
  return (
    <Frame props={props}>
      <Tabs defaultValue="0">
        <TabsList>
          {titles.map((t, i) => (
            <TabsTrigger key={t + i} value={String(i)}>
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        {panes.map((pane, i) => (
          <TabsContent key={i} value={String(i)} className="pt-2">
            <InTab.Provider value>{pane}</InTab.Provider>
          </TabsContent>
        ))}
      </Tabs>
    </Frame>
  );
}

function Help({ field }: { field: FieldState }) {
  const lines = [field.description, field.hint].filter(Boolean);
  if (lines.length === 0) return null;
  return <FieldDescription>{lines.join(' ')}</FieldDescription>;
}

function Errors({ fields }: { fields: readonly FieldState[] }) {
  const errors = fields.flatMap((f) =>
    f.showIssues ? f.issues.map((i) => ({ message: fields.length > 1 ? `${f.label} ${i.message}` : i.message })) : [],
  );
  return <FieldError errors={errors} />;
}

/** A field's label. An item of a list or record is named by its key or position beside it; its own label is for screen readers. */
function Label({ p }: { p: FieldProps }) {
  return (
    <FieldLabel id={labelId(p.id)} htmlFor={p.id} className={cn(p.node.field === '' && 'sr-only')}>
      {p.field.label}
      {p.field.required && (
        <span aria-hidden="true" className="-ml-1.5">
          *
        </span>
      )}
    </FieldLabel>
  );
}

/** A field: a fieldset for containers and groups of choices, a `Field` around any other control. */
function FieldFrame(p: FieldProps) {
  const f = p.field;
  const control = p.node.control?.type ?? defaultControl(p.form.registry, f.decl);
  const item = p.node.field === '';
  if (CONTAINER_KINDS.has(f.decl.type) || GROUP_CONTROLS.has(control)) {
    return (
      <FieldSet className="gap-3" data-kind={f.decl.type} data-invalid={invalid(f) || undefined} data-disabled={!f.enabled || undefined}>
        <FieldLegend id={labelId(p.id)} variant="label" className={cn('mb-0', item && 'sr-only')}>
          {f.label}
          {f.required && <span aria-hidden="true"> *</span>}
        </FieldLegend>
        <Help field={f} />
        {p.control()}
        <Errors fields={[f]} />
      </FieldSet>
    );
  }
  if (control === 'checkbox' || control === 'switch') {
    return (
      <Field orientation="horizontal" data-kind={f.decl.type} data-invalid={invalid(f)} data-disabled={!f.enabled}>
        {p.control()}
        <FieldContent>
          <Label p={p} />
          <Help field={f} />
          <Errors fields={[f]} />
        </FieldContent>
      </Field>
    );
  }
  return (
    <Field data-kind={f.decl.type} data-invalid={invalid(f)} data-disabled={!f.enabled}>
      <Label p={p} />
      {p.control()}
      <Help field={f} />
      <Errors fields={[f]} />
    </Field>
  );
}

const layoutRenderers = defineRenderers({
  stack: ({ children, props }) => (
    <Frame props={props}>
      <FieldGroup className="gap-6">{children}</FieldGroup>
    </Frame>
  ),
  row: Row,
  columns: ({ children, props }) => (
    <Frame props={props} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Number(props.count ?? 2)}, minmax(0, 1fr))` }}>
      {children}
    </Frame>
  ),
  collapsible: CollapsibleSection,
  scroll: ({ children, props }) => (
    <Frame props={props}>
      {/* Focusable, so the keyboard can scroll it too. */}
      <div
        tabIndex={0}
        className="flex flex-col gap-6 overflow-y-auto rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        style={{ maxHeight: typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : (text(props.maxHeight) ?? '20rem') }}
      >
        {children}
      </div>
    </Frame>
  ),
  tabs: TabsSection,
  text: ({ props }) => (
    <p
      className={cn(
        'text-sm',
        props.tone === 'muted' && 'text-muted-foreground',
        props.tone === 'warning' && 'text-amber-600 dark:text-amber-500',
      )}
    >
      {text(props.text)}
    </p>
  ),
  divider: () => <Separator />,
  field: FieldFrame,
  label: ({ field, props, id }) => <FieldLabel htmlFor={id}>{text(props.text) ?? field?.label}</FieldLabel>,
  help: ({ field }) => (field ? <Help field={field} /> : null),
  errors: ({ field, fields }) => <Errors fields={fields ?? (field ? [field] : [])} />,
});

// ── Controls ─────────────────────────────────────────────────────────────────────────────

function TextInput(p: ControlProps) {
  const f = p.field;
  const decl = f.decl as { format?: string; min?: number; max?: number; step?: number; unit?: string };
  const { draft, error, placeholder, change } = useParsedText(p, parserFor(p.form.registry, f.decl.type));
  const numeric = f.decl.type === 'number' || f.decl.type === 'int';
  const type = p.props.secret
    ? 'password'
    : numeric
      ? 'number'
      : decl.format === 'email'
        ? 'email'
        : decl.format === 'uri' || f.decl.type === 'url'
          ? 'url'
          : 'text';
  const props = {
    id: p.id,
    type,
    value: draft,
    placeholder,
    disabled: p.disabled,
    'aria-invalid': invalid(f) || error !== undefined,
    onChange: (e: { target: { value: string } }) => change(e.target.value),
    onBlur: p.touch,
    ...(numeric && { min: decl.min, max: decl.max, step: decl.step ?? (f.decl.type === 'int' ? 1 : 'any') }),
  };
  return (
    <>
      {numeric && decl.unit ? (
        <InputGroup data-disabled={p.disabled}>
          <InputGroupInput {...props} />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{decl.unit}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <Input {...props} />
      )}
      {error && <FieldError>{error}</FieldError>}
    </>
  );
}

function TextArea(p: ControlProps) {
  const f = p.field;
  const { draft, error, placeholder, change } = useParsedText(p, parserFor(p.form.registry, f.decl.type));
  return (
    <>
      <Textarea
        id={p.id}
        value={draft}
        placeholder={placeholder}
        rows={Number(p.props.rows ?? 4)}
        disabled={p.disabled}
        aria-invalid={invalid(f) || error !== undefined}
        onChange={(e) => change(e.target.value)}
        onBlur={p.touch}
        className={cn(f.decl.type === 'json' && 'font-mono')}
      />
      {error && <FieldError>{error}</FieldError>}
    </>
  );
}

/** A text box offering the field's suggestions in a command list as it is typed; any other value is allowed. */
function Autocomplete(p: ControlProps) {
  const f = p.field;
  const { draft, error, placeholder, change } = useParsedText(p, parserFor(p.form.registry, f.decl.type));
  const [open, setOpen] = useState(false);
  const typed = draft.trim().toLowerCase();
  const matches = (f.suggestions ?? []).filter((s) => s !== draft && s.toLowerCase().includes(typed));
  return (
    <>
      <Popover open={open && matches.length > 0} onOpenChange={setOpen}>
        <Command shouldFilter={false} className="overflow-visible bg-transparent">
          <PopoverAnchor asChild>
            <CommandPrimitive.Input asChild value={draft} onValueChange={change}>
              {/*
               * The field's id and label, in place of cmdk's own. Without its `cmdk-input` mark cmdk
               * does not refocus the box by its own id, which would send the focus to the list.
               */}
              <Input
                id={p.id}
                cmdk-input={undefined}
                aria-labelledby={labelId(p.id)}
                placeholder={placeholder}
                disabled={p.disabled}
                aria-invalid={invalid(f) || error !== undefined}
                onFocus={() => setOpen(true)}
                onInput={() => setOpen(true)}
                onBlur={() => {
                  setOpen(false);
                  p.touch();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                }}
              />
            </CommandPrimitive.Input>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              if (e.target instanceof Node && document.getElementById(p.id)?.contains(e.target)) e.preventDefault();
            }}
          >
            {/* Pressing an option keeps the focus in the text box. */}
            <CommandList onMouseDown={(e) => e.preventDefault()}>
              {matches.map((s) => (
                <CommandItem
                  key={s}
                  value={s}
                  onSelect={() => {
                    change(s);
                    setOpen(false);
                  }}
                >
                  {s}
                </CommandItem>
              ))}
            </CommandList>
          </PopoverContent>
        </Command>
      </Popover>
      {error && <FieldError>{error}</FieldError>}
    </>
  );
}

function SelectControl(p: ControlProps) {
  const { field, id, disabled, touch } = p;
  const { options, index, choose } = choicesOf(p);
  return (
    <Select
      value={index < 0 ? '' : String(index)}
      onValueChange={(v) => choose(Number(v))}
      onOpenChange={(open) => {
        if (!open) touch();
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-invalid={invalid(field)}>
        <SelectValue placeholder={field.mixed ? MIXED : (field.placeholder ?? 'Choose…')} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o, i) => (
          <SelectItem key={i} value={String(i)} title={o.description}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Radios(p: ControlProps) {
  const { field, id, disabled, touch } = p;
  const { options, index, choose } = choicesOf(p);
  return (
    <RadioGroup
      id={id}
      aria-labelledby={labelId(id)}
      value={index < 0 ? '' : String(index)}
      onValueChange={(v) => {
        choose(Number(v));
        touch();
      }}
      disabled={disabled}
      orientation="horizontal"
      aria-invalid={invalid(field)}
      className="flex flex-wrap gap-x-6 gap-y-3"
    >
      {options.map((o, i) => (
        <Field key={i} orientation="horizontal" className="w-fit" title={o.description}>
          <RadioGroupItem id={`${id}-${i}`} value={String(i)} aria-invalid={invalid(field)} />
          <FieldLabel htmlFor={`${id}-${i}`} className="font-normal">
            {o.label}
          </FieldLabel>
        </Field>
      ))}
    </RadioGroup>
  );
}

/** One of a few, as a row of toggles. */
function Segmented(p: ControlProps) {
  const { id, disabled, touch } = p;
  const { options, index, choose } = choicesOf(p);
  return (
    <ToggleGroup
      id={id}
      aria-labelledby={labelId(id)}
      type="single"
      variant="outline"
      value={index < 0 ? '' : String(index)}
      onValueChange={(v) => {
        if (v === '') return;
        choose(Number(v));
        touch();
      }}
      disabled={disabled}
    >
      {options.map((o, i) => (
        <ToggleGroupItem key={i} value={String(i)} title={o.description}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function CheckboxControl({ field, id, disabled, set, touch }: ControlProps) {
  return (
    <Checkbox
      id={id}
      checked={field.mixed ? 'indeterminate' : field.value === true}
      disabled={disabled}
      aria-invalid={invalid(field)}
      onCheckedChange={(v) => {
        set(v === true);
        touch();
      }}
    />
  );
}

function SwitchControl({ field, id, disabled, set, touch }: ControlProps) {
  return (
    <Switch
      id={id}
      checked={!field.mixed && field.value === true}
      disabled={disabled}
      aria-invalid={invalid(field)}
      onCheckedChange={(v) => {
        set(v);
        touch();
      }}
    />
  );
}

function SliderControl({ field, id, disabled, set, touch, props }: ControlProps) {
  const d = field.decl as { min?: number; max?: number; step?: number; unit?: string };
  const percent = props.format === 'percent';
  const min = d.min ?? 0;
  const value = typeof field.value === 'number' ? field.value : min;
  const shown = percent ? `${Math.round(value * 100)}%` : `${value}${d.unit ?? ''}`;
  return (
    <div className="flex items-center gap-4">
      <Slider
        id={id}
        aria-labelledby={labelId(id)}
        value={[value]}
        min={min}
        max={d.max ?? 100}
        step={d.step ?? (percent ? 0.01 : 1)}
        disabled={disabled}
        onValueChange={([v]) => {
          if (v !== undefined) set(v);
        }}
        onValueCommit={touch}
      />
      <output htmlFor={id} className={cn('min-w-12 text-right text-sm text-muted-foreground tabular-nums', field.mixed && 'italic')}>
        {field.mixed ? MIXED : shown}
      </output>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A day picked from a calendar, with a time beside it when the date has one. A date is a day in
 * UTC, as fieldspec's own date control reads it; with a time, a local moment. The calendar works
 * in local days.
 */
function DatePicker(p: ControlProps) {
  const { field, id, disabled, set, touch } = p;
  const time = (field.decl as { time?: boolean }).time === true;
  const [open, setOpen] = useState(false);
  const value = !field.mixed && field.value instanceof Date && !Number.isNaN(field.value.getTime()) ? field.value : undefined;
  const day =
    value &&
    (time
      ? new Date(value.getFullYear(), value.getMonth(), value.getDate())
      : new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const pick = (d: Date) => {
    if (!time) return set(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
    set(new Date(d.getFullYear(), d.getMonth(), d.getDate(), value?.getHours() ?? 0, value?.getMinutes() ?? 0));
  };
  return (
    <div className="flex gap-2">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) touch();
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid(field)}
            data-empty={!day}
            className="min-w-0 flex-1 justify-between font-normal data-[empty=true]:text-muted-foreground"
          >
            {day ? day.toLocaleDateString(undefined, { dateStyle: 'medium' }) : field.mixed ? MIXED : 'Pick a date'}
            <CalendarIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
          <Calendar
            mode="single"
            selected={day}
            defaultMonth={day}
            captionLayout="dropdown"
            onSelect={(d) => {
              if (d) pick(d);
              setOpen(false);
              touch();
            }}
          />
        </PopoverContent>
      </Popover>
      {time && (
        <Input
          type="time"
          aria-label={`${field.label}, time`}
          className="w-32 bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
          value={value ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : ''}
          disabled={disabled}
          onChange={(e) => {
            const [h, m] = e.target.value.split(':').map(Number);
            if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return;
            const base = day ?? new Date();
            set(new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m));
          }}
          onBlur={touch}
        />
      )}
    </div>
  );
}

/** A colour typed as hex, with the browser's picker in its swatch, and the field's swatches to pick from. */
function ColorControl(p: ControlProps) {
  const { field, id, disabled, set, touch, props } = p;
  const { draft, error, placeholder, change } = useParsedText(p, parserFor(p.form.registry, field.decl.type));
  const swatches = Array.isArray(props.swatches) ? props.swatches.map(String) : [];
  const hex = typeof field.value === 'string' && /^#[0-9a-f]{6}$/i.test(field.value) ? field.value : '#000000';
  return (
    <div className="flex flex-col gap-2">
      <InputGroup data-disabled={disabled}>
        <InputGroupAddon>
          <input
            type="color"
            aria-label={`Pick ${field.label}`}
            value={hex}
            disabled={disabled}
            onChange={(e) => set(e.target.value)}
            onBlur={touch}
            className="size-5 cursor-pointer rounded-sm border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
          />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          value={draft}
          placeholder={placeholder ?? '#rrggbb'}
          disabled={disabled}
          aria-invalid={invalid(field) || error !== undefined}
          onChange={(e) => change(e.target.value)}
          onBlur={touch}
          className="font-mono"
        />
      </InputGroup>
      {swatches.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {swatches.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use ${c}`}
              aria-pressed={!field.mixed && field.value === c}
              disabled={disabled}
              onClick={() => {
                set(c);
                touch();
              }}
              className="size-6 rounded-full shadow-xs ring-offset-2 ring-offset-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-pressed:ring-2 aria-pressed:ring-ring"
              style={{ background: c }}
            />
          ))}
        </div>
      )}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function FileControl({ field, id, disabled, set, touch }: ControlProps) {
  const size = field.value instanceof Uint8Array ? field.value.length : 0;
  const accept = (field.decl as { accept?: readonly string[] }).accept;
  return (
    <div className="flex items-center gap-3">
      <Input
        id={id}
        type="file"
        disabled={disabled}
        className="min-w-0 flex-1"
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
      <span className="text-sm whitespace-nowrap text-muted-foreground">{size > 0 ? `${size.toLocaleString()} bytes` : 'Empty'}</span>
    </div>
  );
}

function AddButton({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" className="w-fit" disabled={disabled} onClick={onClick}>
      <PlusIcon />
      {children}
    </Button>
  );
}

function RemoveButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <XIcon />
    </Button>
  );
}

/** A list's items in rows that reorder by dragging their handle, or with its arrow keys. */
function List(p: ControlProps) {
  const list = listOf(p);
  const reorder = useReorder(list, p.disabled);
  if (p.field.decl.type === 'set') return <SetLines {...p} />;
  return (
    <div className="flex flex-col gap-3">
      {list.items.map(({ index: i, label, render }) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-md data-[dragging]:opacity-40 data-[drop=after]:shadow-[0_2px_0_var(--color-ring)] data-[drop=before]:shadow-[0_-2px_0_var(--color-ring)]"
          {...reorder.row(i)}
        >
          <Handle {...reorder.handle(i, label)} />
          <div className="min-w-0 flex-1">{render()}</div>
          <RemoveButton label={`Remove ${label}`} disabled={p.disabled} onClick={() => list.remove(i)} />
        </div>
      ))}
      <AddButton disabled={!list.canAdd} onClick={() => list.add()}>
        {text(p.props.addLabel) ?? 'Add'}
      </AddButton>
    </div>
  );
}

/** A drag handle, from `useReorder`'s props. */
function Handle(props: ReturnType<ReturnType<typeof useReorder>['handle']>) {
  return (
    <span
      {...props}
      className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4"
    >
      <GripVerticalIcon />
    </span>
  );
}

/** A set's items have no stable position to point at, so they are edited as lines. */
function SetLines(p: ControlProps) {
  const { field } = p;
  const items = field.value instanceof Set ? [...field.value] : [];
  const kind = deref({ defs: p.form.spec.defs, presets: p.form.registry.presets }, (field.decl as { items: FieldDecl }).items).type;
  const numeric = kind === 'int' || kind === 'number';
  return (
    <Textarea
      id={p.id}
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

/** A set of options, as checkboxes; other sets are lists. */
function Checks(p: ControlProps) {
  const checks = checksOf(p);
  if (!checks) return <List {...p} />;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-3" data-slot="checkbox-group">
      {checks.options.map((o, i) => (
        <Field key={i} orientation="horizontal" className="w-fit">
          <Checkbox
            id={`${p.id}-${i}`}
            checked={o.checked}
            disabled={p.disabled}
            onCheckedChange={(v) => {
              checks.toggle(i, v === true);
              p.touch();
            }}
          />
          <FieldLabel htmlFor={`${p.id}-${i}`} className="font-normal">
            {o.label}
          </FieldLabel>
        </Field>
      ))}
    </div>
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
    <div className="flex w-40 flex-none flex-col gap-1.5">
      <Input
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
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

/** A new entry's key, and the button that adds it. */
function NewEntry({ p, add }: { p: ControlProps; add: (key: string) => string | undefined }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    const refused = add(key);
    setError(refused);
    if (refused === undefined) setKey('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          className="w-40"
          aria-label="New key"
          placeholder="New key"
          value={key}
          disabled={p.disabled}
          aria-invalid={error !== undefined}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            submit();
          }}
        />
        <AddButton disabled={p.disabled || key === ''} onClick={submit}>
          {text(p.props.addLabel) ?? 'Add'}
        </AddButton>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function Entries(p: ControlProps) {
  const entries = entriesOf(p);
  return (
    <div className="flex flex-col gap-3">
      {entries.entries.map((entry, i) => (
        // By position, so a row keeps its focus and drafts while its key changes.
        <div key={i} className="flex items-start gap-2">
          <KeyInput value={entry.label} disabled={p.disabled} rename={(typed) => entries.rename(entry.key, typed)} />
          <div className="min-w-0 flex-1">{entry.render()}</div>
          <RemoveButton label={`Remove ${entry.label}`} disabled={p.disabled} onClick={() => entries.remove(entry.key)} />
        </div>
      ))}
      <NewEntry p={p} add={entries.add} />
    </div>
  );
}

/** Which sections of an accordion start open: none, the first, or all. */
const startsOpen = (p: ControlProps, count: number) =>
  p.props.open === 'all' ? Array.from({ length: count }, (_, i) => String(i)) : p.props.open === 'first' ? ['0'] : [];

/**
 * Items as sections that open and close, each headed by its name (the list's `namedBy`, else its
 * position or key). A list's sections reorder by dragging; a record's or map's key is renamed inside.
 */
function AccordionControl(p: ControlProps) {
  return p.field.decl.type === 'array' ? <ListAccordion {...p} /> : <EntriesAccordion {...p} />;
}

function ListAccordion(p: ControlProps) {
  const list = listOf(p);
  const reorder = useReorder(list, p.disabled);
  return (
    <div className="flex flex-col gap-3">
      <Accordion type="multiple" defaultValue={startsOpen(p, list.items.length)} className="rounded-lg border px-4 empty:hidden">
        {list.items.map(({ index: i, label, render }) => (
          // By position, as a list's rows are: a section keeps its open state while its item changes.
          <AccordionItem
            key={i}
            value={String(i)}
            className="data-[dragging]:opacity-40 data-[drop=after]:shadow-[0_2px_0_var(--color-ring)] data-[drop=before]:shadow-[0_-2px_0_var(--color-ring)]"
            {...reorder.row(i)}
          >
            {/* The trigger sits in a heading of its own, which takes the row's room. */}
            <div className="flex items-center gap-1 [&>h3]:min-w-0 [&>h3]:flex-1">
              <Handle {...reorder.handle(i, label)} />
              <AccordionTrigger className="min-w-0 py-3">{label}</AccordionTrigger>
              <RemoveButton label={`Remove ${label}`} disabled={p.disabled} onClick={() => list.remove(i)} />
            </div>
            <AccordionContent className="flex flex-col gap-6 pt-1">{render()}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <AddButton disabled={!list.canAdd} onClick={() => list.add()}>
        {text(p.props.addLabel) ?? 'Add'}
      </AddButton>
    </div>
  );
}

function EntriesAccordion(p: ControlProps) {
  const entries = entriesOf(p);
  return (
    <div className="flex flex-col gap-3">
      <Accordion type="multiple" defaultValue={startsOpen(p, entries.entries.length)} className="rounded-lg border px-4 empty:hidden">
        {entries.entries.map((entry, i) => (
          <AccordionItem key={i} value={String(i)}>
            {/* The trigger sits in a heading of its own, which takes the row's room. */}
            <div className="flex items-center gap-1 [&>h3]:min-w-0 [&>h3]:flex-1">
              <AccordionTrigger className="min-w-0 py-3">{entry.name ?? entry.label}</AccordionTrigger>
              <RemoveButton label={`Remove ${entry.name ?? entry.label}`} disabled={p.disabled} onClick={() => entries.remove(entry.key)} />
            </div>
            <AccordionContent className="flex flex-col gap-6 pt-1">
              <KeyInput value={entry.label} disabled={p.disabled} rename={(typed) => entries.rename(entry.key, typed)} />
              {entry.render()}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <NewEntry p={p} add={entries.add} />
    </div>
  );
}

function Variant(p: ControlProps) {
  const variant = variantOf(p);
  return (
    <div className="flex flex-col gap-6">
      <Select
        value={variant.current ?? ''}
        onValueChange={variant.choose}
        onOpenChange={(open) => {
          if (!open) p.touch();
        }}
        disabled={p.disabled}
      >
        <SelectTrigger id={p.id} className="w-full">
          <SelectValue placeholder={p.field.mixed ? MIXED : 'Choose…'} />
        </SelectTrigger>
        <SelectContent>
          {variant.options.map((o) => (
            <SelectItem key={o.name} value={o.name}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {variant.render()}
    </div>
  );
}

/** An object's fields; an absent one is offered with an Add button rather than drawn. */
function Fields(p: ControlProps) {
  const object = objectOf(p);
  if (!object.present) {
    return (
      <AddButton disabled={p.disabled} onClick={object.add}>
        Add
      </AddButton>
    );
  }
  return (
    <>
      {object.render()}
      {object.optional && (
        <Button type="button" variant="outline" size="sm" className="w-fit" disabled={p.disabled} onClick={object.remove}>
          Remove
        </Button>
      )}
    </>
  );
}

const controlRenderers = defineRenderers({
  input: TextInput,
  textarea: TextArea,
  autocomplete: Autocomplete,
  select: SelectControl,
  radio: Radios,
  segmented: Segmented,
  checkbox: CheckboxControl,
  switch: SwitchControl,
  slider: SliderControl,
  date: DatePicker,
  color: ColorControl,
  file: FileControl,
  checks: Checks,
  list: List,
  accordion: AccordionControl,
  entries: Entries,
  variant: Variant,
  fields: Fields,
});

/** Every built-in element, drawn with shadcn/ui. */
export const shadcnRenderers: Renderers = { ...layoutRenderers, ...controlRenderers };
