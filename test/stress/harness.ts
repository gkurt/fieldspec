import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createStateStore, defineCatalog, validateSpec } from '@json-render/core';
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react';
import { schema as jsonRenderSchema } from '@json-render/react/schema';
import { shadcnComponents } from '@json-render/shadcn';
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog';
/**
 * Runs a spec through every entry point: the checker, values, migrations, translations, the form
 * and its edits, layout, JSON Schema, Zod, Standard Schema, commonFields, json-render (output,
 * state, and its React renderer) and the React controls. Each step is timed and its error kept, so a stress test
 * can say which step of which spec hung or broke.
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { htmlRenderers } from '#examples/renderers/html.tsx';
import {
  checkSpec,
  checkTranslations,
  commonFields,
  createForm,
  fromJSONSchema,
  fromJsonRenderState,
  JSON_RENDER_ACTIONS,
  jsonRenderActions,
  layout,
  localize,
  migrate,
  parse,
  PatchError,
  standardOf,
  texts,
  toJSONSchema,
  toJsonRender,
  toJsonRenderState,
  walk,
  type Form,
  type Spec,
} from '#src/index.ts';
import { FormView } from '#src/react/index.tsx';
import { toZod } from '#src/zod.ts';

/** A DOM for the React steps, if none is there yet. */
export function ensureDom() {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

const catalog = defineCatalog(jsonRenderSchema, { components: shadcnComponentDefinitions, actions: JSON_RENDER_ACTIONS } as never);

export interface Step {
  readonly step: string;
  readonly ms: number;
  readonly error?: string;
}

export interface Report {
  /** Whether the checker found no errors; steps of a rejected spec may fail, but must end. */
  readonly valid: boolean;
  readonly steps: Step[];
}

/** The most nodes a walk may yield before it counts as endless. */
const WALK_LIMIT = 200_000;

/** Every pointer into a value, outermost first, up to `limit`. */
export function pointers(value: unknown, at = '', out: string[] = [], limit = 2000): string[] {
  if (out.length >= limit) return out;
  if (at !== '') out.push(at);
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : value instanceof Map
      ? [...value].map(([k, v]) => [String(k), v])
      : value instanceof Set
        ? [...value].map((v, i) => [String(i), v])
        : value && typeof value === 'object' && !(value instanceof Uint8Array) && !(value instanceof Date) && !(value instanceof RegExp)
          ? Object.entries(value)
          : [];
  for (const [k, v] of entries) pointers(v, `${at}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, out, limit);
  return out;
}

export interface ExerciseOptions {
  /** Draw the form with React and json-render's React renderer, and click its buttons. Default true. */
  readonly react?: boolean;
  /** How many random edits to make. Default 40. */
  readonly edits?: number;
  readonly seed?: number;
  /** The spec's drawing is huge on purpose: walks of its layout stop early instead of failing, json-render output stops sooner, and no buttons are clicked. */
  readonly huge?: boolean;
}

export async function exercise(spec: Spec, values: unknown = {}, options: ExerciseOptions = {}): Promise<Report> {
  const steps: Step[] = [];
  const begin = (step: string) => {
    if (process.env.STRESS_TRACE) process.stderr.write(`    ${step}\n`);
    return performance.now();
  };
  const end = (step: string, start: number, error?: unknown) => {
    const e = error as Error | undefined;
    steps.push({ step, ms: performance.now() - start, ...(error !== undefined && { error: `${e?.name}: ${e?.message}`.slice(0, 300) }) });
  };
  const run = <T>(step: string, fn: () => T): T | undefined => {
    const start = begin(step);
    try {
      const out = fn();
      end(step, start);
      return out;
    } catch (error) {
      end(step, start, error ?? new Error('threw undefined'));
      return undefined;
    }
  };
  const runAsync = async (step: string, fn: () => Promise<void>) => {
    const start = begin(step);
    try {
      await fn();
      end(step, start);
    } catch (error) {
      end(step, start, error ?? new Error('threw undefined'));
    }
  };
  // A huge spec's buttons add huge values: building one is the spec's doing, not a hang.
  const clicks = options.huge ? 0 : 12;
  const walkAll = (view?: string) => {
    let n = 0;
    for (const _ of walk(layout(spec, view))) {
      if (++n <= 200_000) continue;
      if (options.huge) return;
      throw new Error('walk did not end');
    }
  };

  const faults = run('checkSpec', () => checkSpec(spec)) ?? [];
  const valid = faults.every((f) => f.severity !== 'error');

  run('migrate', () => {
    migrate(spec, values);
    migrate(spec, values, { from: 1 });
  });
  const parsed = run('parse', () => parse(spec, values));
  const form = run('createForm', () => createForm(spec, { values }));
  if (form) {
    run('form.issues', () => form.issues);
    run('form.json', () => JSON.stringify(form.json()));
    // What a form writes, it reads back: the same values, at the spec's version.
    if (valid && parsed?.ok) {
      run('form.json round trip', () => {
        const json = form.json();
        const again = createForm(spec, { values: json }).json();
        if (JSON.stringify(again) !== JSON.stringify(json))
          throw new Error(`${JSON.stringify(json)} came back as ${JSON.stringify(again)}`.slice(0, 280));
      });
    }
    run('form.field (every value)', () => {
      for (const p of pointers(form.values)) form.field(p);
    });
    run('form.submit', () => form.submit());
    run('edits', () => edit(createForm(spec, { values }), options.edits ?? 40, options.seed ?? 1));
  }

  run('texts', () => texts(spec));
  for (const locale of Object.keys(spec.locales ?? {})) {
    run(`checkTranslations ${locale}`, () => checkTranslations(spec, spec.locales![locale]));
    const localized = run(`localize ${locale}`, () => localize(spec, locale));
    // Translations the checker accepts keep the spec valid.
    if (valid && localized) {
      run(`checkSpec(localize ${locale})`, () => {
        const errors = checkSpec(localized).filter((f) => f.severity === 'error');
        if (errors.length > 0) throw new Error(JSON.stringify(errors).slice(0, 280));
      });
    }
    const shown = run(`createForm ${locale}`, () => createForm(spec, { values, locale }));
    if (shown) {
      run(`form ${locale}`, () => {
        void shown.issues;
        for (const p of pointers(shown.values)) shown.field(p);
        let n = 0;
        for (const _ of walk(shown.layout())) if (++n > WALK_LIMIT) break;
      });
    }
  }

  run('layout + walk', () => walkAll());
  for (const view of Object.keys(spec.layouts ?? {})) run(`layout ${view}`, () => walkAll(view));

  const schema = run('toJSONSchema', () => toJSONSchema(spec));
  if (schema) {
    const back = run('fromJSONSchema', () => fromJSONSchema(schema));
    if (back) run('checkSpec(fromJSONSchema)', () => checkSpec(back));
  }
  const zod = run('toZod', () => toZod(spec));
  if (zod && form) run('zod.safeParse', () => zod.safeParse(form.json()));
  void run('standard.validate', () => standardOf(spec).validate(form?.json() ?? values));
  const resolved = form?.values ?? values;
  run('commonFields', () => {
    const common = commonFields([spec, spec], { values: [resolved, resolved] });
    common.apply(common.values, [resolved, resolved]);
  });

  const flat = run('toJsonRender', () => toJsonRender(spec, { values: resolved, ...(options.huge && { maxElements: 2000 }) }));
  if (flat) {
    // json-render lints state too: a list holding a string, say. Only values that fit must pass.
    if (parsed?.ok) {
      run('json-render validateSpec', () => {
        const result = validateSpec(flat as never);
        if (!result.valid) throw new Error(JSON.stringify(result.issues).slice(0, 200));
      });
    }
    const state = run('toJsonRenderState', () => toJsonRenderState(spec, resolved));
    run('fromJsonRenderState', () => fromJsonRenderState(spec, { form: state }));
    if (options.react !== false) {
      await runAsync('json-render React', async () => {
        const store = createStateStore(flat.state);
        const { registry } = defineRegistry(catalog as never, {
          components: shadcnComponents,
          actions: jsonRenderActions(store),
        });
        const element = createElement(JSONUIProvider, {
          registry,
          store,
          handlers: jsonRenderActions(store),
          children: createElement(Renderer, { spec: flat as never, registry }),
        } as never);
        await mount(element, options.seed ?? 1, clicks);
        fromJsonRenderState(spec, store.getSnapshot());
      });
    }
  }
  if (form && options.react !== false) {
    await runAsync('FormView', () => mount(createElement(FormView, { form, renderers: htmlRenderers }), options.seed ?? 1, clicks));
    for (const view of Object.keys(spec.layouts ?? {})) {
      await runAsync(`FormView ${view}`, () =>
        mount(createElement(FormView, { form, view, renderers: htmlRenderers }), options.seed ?? 1, clicks),
      );
    }
  }
  return { valid, steps };
}

/** Draws an element into a DOM, clicks some of its buttons, and takes it down; any error React reports is thrown. */
async function mount(element: ReactNode, seed: number, clicks = 12) {
  ensureDom();
  const errors: unknown[] = [];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host, { onUncaughtError: (e) => errors.push(e), onRecoverableError: (e) => errors.push(e) });
  // Work React schedules outside act still belongs to this step.
  const stray = (e: unknown) => errors.push(e);
  process.on('uncaughtException', stray);
  process.on('unhandledRejection', stray);
  // An error in a click handler reaches the window, not the click.
  const reported = (e: ErrorEvent) => {
    e.preventDefault();
    errors.push(e.error);
  };
  window.addEventListener('error', reported);
  try {
    await act(async () => root.render(element));
    const r = random(seed);
    for (let i = 0; i < clicks && errors.length === 0; i++) {
      const buttons = [...host.querySelectorAll('button')];
      if (buttons.length === 0) break;
      await act(async () => r.pick(buttons).click());
    }
    await act(() => new Promise((done) => setTimeout(done, 0)));
  } finally {
    await act(async () => root.unmount());
    host.remove();
    process.off('uncaughtException', stray);
    process.off('unhandledRejection', stray);
    window.removeEventListener('error', reported);
  }
  if (errors.length > 0) throw errors[0];
}

/** A small seeded random number generator (mulberry32). */
export function random(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
    chance: (p: number) => next() < p,
  };
}

/** Random edits through the form's own methods: sets, adds, removes, moves, patches, resets. */
function edit(form: Form, count: number, seed: number) {
  const r = random(seed);
  const junk = () => r.pick<unknown>([undefined, null, '', 'x', 0, -1, 1.5, true, [], {}, [1, 'a'], { a: 1 }, '2024-01-01']);
  for (let i = 0; i < count; i++) {
    const all = pointers(form.values);
    const at = all.length > 0 ? r.pick(all) : '/' + r.pick(Object.keys(form.spec.fields).concat('nope'));
    const value = form.get(at);
    const op = r.int(7);
    const start = performance.now();
    switch (op) {
      case 0:
        form.set(at, junk());
        break;
      case 1:
        form.addItem(at);
        break;
      case 2:
        form.removeItem(at);
        break;
      case 3:
        if (Array.isArray(value)) form.moveItem(at, r.int(value.length + 2) - 1, r.int(value.length + 2) - 1);
        break;
      case 4:
        try {
          form.apply([
            r.pick([
              { op: 'replace', path: at, value: junk() },
              { op: 'remove', path: at },
              { op: 'add', path: `${at}/-`, value: junk() },
            ] as never),
          ]);
        } catch (error) {
          // A patch that cannot apply says so; anything else is a bug.
          if (!(error instanceof PatchError)) throw error;
        }
        break;
      case 5:
        form.field(at);
        form.touch(at);
        break;
      case 6:
        if (r.chance(0.2)) form.reset(form.json());
        break;
    }
    void form.issues;
    if (process.env.STRESS_TRACE_EDITS) {
      process.stderr
        .write(`      edit ${op} at ${at}: ${Math.round(performance.now() - start)}ms, ${JSON.stringify(form.json() ?? null).length} chars
`);
    }
  }
}
