/** Items named by `namedBy`, strings offering `suggestions`, and the accordion and autocomplete controls. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { act, createElement } from 'react';
import type * as ClientModule from 'react-dom/client';
import type * as HtmlModule from '#examples/renderers/html.tsx';
import type * as AriaModule from '#examples/renderers/react-aria.tsx';
import { checkSpec, createForm, define, defaultControl, fromJSONSchema, toJSONSchema, toJsonRender } from '#src/index.ts';
import type * as UiModule from '#src/react/index.tsx';

const team = define({
  fields: {
    people: {
      type: 'array',
      namedBy: 'name',
      render: { type: 'accordion', props: { open: 'first' } },
      items: { type: 'object', fields: { name: { type: 'string' }, role: { type: 'string', suggestions: { $state: '/roles' } } } },
    },
    pairs: {
      type: 'array',
      namedBy: { $template: '${first} ${last}' },
      items: { type: 'object', fields: { first: { type: 'string' }, last: { type: 'string' } } },
    },
    tags: { type: 'array', namedBy: '', items: { type: 'string' } },
    links: { type: 'record', namedBy: 'title', values: { type: 'object', fields: { title: { type: 'string' }, url: { type: 'string' } } } },
    roles: { type: 'array', items: { type: 'string' }, default: ['Engineer', 'Designer'] },
    city: { type: 'string', suggestions: ['Amsterdam', 'Berlin', 'Istanbul'] },
  },
});

const values = {
  people: [
    { name: 'Ada', role: 'Engineer' },
    { name: '', role: 'Designer' },
  ],
  pairs: [{ first: 'Grace', last: 'Hopper' }],
  tags: ['urgent'],
  links: { docs: { title: 'Documentation', url: 'https://example.com' } },
};

describe('namedBy', () => {
  test('names items by a field of theirs, a template, or themselves; else by position or key', () => {
    const form = createForm(team, { values });
    const label = (path: string) => form.field(path)?.label;
    expect(label('/people/0')).toBe('Ada');
    expect(label('/people/1')).toBe('#2'); // an empty name falls back
    expect(label('/pairs/0')).toBe('Grace Hopper');
    expect(label('/tags/0')).toBe('urgent');
    expect(label('/links/docs')).toBe('Documentation');
    expect(label('/roles/0')).toBe('#1'); // no namedBy
    form.set('/people/1/name', 'Lin');
    expect(label('/people/1')).toBe('Lin');
  });

  test('the checker knows what an item has', () => {
    const messages = (spec: unknown) => checkSpec(spec).map((f) => `${f.path}: ${f.message}`);
    expect(
      messages({ fields: { people: { type: 'array', namedBy: 'nmae', items: { type: 'object', fields: { name: { type: 'string' } } } } } }),
    ).toEqual(['/fields/people/namedBy: no field "nmae" in an item. Did you mean "name"?']);
    expect(messages({ fields: { tags: { type: 'array', namedBy: 'name', items: { type: 'string' } } } })[0]).toContain('names no field');
    expect(messages({ fields: { tags: { type: 'set', namedBy: '', items: { type: 'string' } } } })[0]).toContain(
      'is not a property of a set',
    );
    expect(checkSpec(team).filter((f) => f.severity === 'error')).toEqual([]);
  });

  test('travels through JSON Schema', () => {
    const back = fromJSONSchema(toJSONSchema(team)) as { fields: Record<string, { namedBy?: unknown; suggestions?: unknown }> };
    expect(back.fields.people?.namedBy).toBe('name');
    expect(back.fields.pairs?.namedBy).toEqual({ $template: '${first} ${last}' });
    expect(back.fields.city?.suggestions).toEqual(['Amsterdam', 'Berlin', 'Istanbul']);
  });
});

describe('suggestions', () => {
  test('are evaluated, and make a string an autocomplete', () => {
    const form = createForm(team, { values });
    expect(form.field('/city')?.suggestions).toEqual(['Amsterdam', 'Berlin', 'Istanbul']);
    expect(form.field('/people/0/role')?.suggestions).toEqual(['Engineer', 'Designer']);
    form.set('/roles', ['Engineer', 'Writer', 42]);
    expect(form.field('/people/0/role')?.suggestions).toEqual(['Engineer', 'Writer']);
    expect(defaultControl(form.format, { type: 'string', suggestions: [] })).toBe('autocomplete');
    expect(defaultControl(form.format, { type: 'string' })).toBe('input');
  });

  test('the checker wants strings or an expression', () => {
    const faults = checkSpec({ fields: { a: { type: 'string', suggestions: ['x', 1] }, b: { type: 'string', suggestions: 'x' } } });
    expect(faults.map((f) => f.path)).toEqual(['/fields/a/suggestions/1', '/fields/b/suggestions']);
    expect(checkSpec({ fields: { n: { type: 'int', suggestions: ['1'] } } })[0]?.message).toContain('is not a property of a int');
  });

  test('json-render draws an autocomplete as a text box', () => {
    const out = toJsonRender(define({ fields: { city: { type: 'string', suggestions: ['Berlin'] } } }));
    expect(Object.values(out.elements).some((e) => e.type === 'Input' || e.type === 'input')).toBe(true);
  });
});

describe('accordion and autocomplete, drawn', () => {
  type ReactModule = { act: typeof act; createElement: typeof createElement };
  let React: ReactModule;
  let client: typeof ClientModule;
  let ui: typeof UiModule;
  let html: typeof HtmlModule;
  let aria: typeof AriaModule;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import('react');
    client = await import('react-dom/client');
    ui = await import('#src/react/index.tsx');
    html = await import('#examples/renderers/html.tsx');
    aria = await import('#examples/renderers/react-aria.tsx');
  });
  afterAll(() => GlobalRegistrator.unregister());

  async function mount(renderers: UiModule.Renderers) {
    const form = createForm(team, { values });
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    const run = (fn: () => void) => React.act(async () => fn());
    await run(() => root.render(React.createElement(ui.FormView, { form, renderers })));
    const q = (s: string) => [...host.querySelectorAll<HTMLElement>(s)];
    return { form, q, run, unmount: () => run(() => root.unmount()) };
  }

  test('an accordion heads each section with its name, and reorders by its handle, removes and adds', async () => {
    const { form, q, run, unmount } = await mount(html.htmlRenderers);
    const people = () => q('.fs-accordion')[0]!;
    const headings = () => [...people().querySelectorAll(':scope > details > summary .fs-summary-label')].map((e) => e.textContent);
    expect(headings()).toEqual(['Ada', '#2']);
    expect([...people().querySelectorAll(':scope > details')].map((d) => (d as HTMLDetailsElement).open)).toEqual([true, false]);
    // No move buttons: the handle in each heading drags, or moves with the arrow keys.
    expect(people().querySelector('button[aria-label^="Move"]')).toBeNull();
    const handle = people().querySelector<HTMLElement>(':scope > details > summary > .fs-handle')!;
    expect(handle.getAttribute('aria-label')).toBe('Move Ada, item 1 of 2');
    expect(handle.getAttribute('draggable')).toBe('true');
    await run(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    expect(form.values.people.map((p) => p.name)).toEqual(['', 'Ada']);
    expect(headings()).toEqual(['#1', 'Ada']);
    // Pressing the handle does not open or close its section: its click is cancelled.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    await run(() => people().querySelector<HTMLElement>('.fs-handle')!.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    await run(() => people().querySelector<HTMLButtonElement>('button[aria-label="Remove #1"]')!.click());
    expect(headings()).toEqual(['Ada']);
    await run(() => [...people().querySelectorAll<HTMLButtonElement>(':scope > div > button')].at(-1)!.click());
    expect(headings()).toEqual(['Ada', '#2']);
    await unmount();
  });

  test('an autocomplete offers the suggestions and takes any text', async () => {
    const { form, q, run, unmount } = await mount(html.htmlRenderers);
    const input = q('input[list]').find((i) => i.id.endsWith('_city')) as HTMLInputElement;
    const list = document.getElementById(input.getAttribute('list')!)!;
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['Amsterdam', 'Berlin', 'Istanbul']);
    await run(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Lisbon');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(form.values.city).toBe('Lisbon');
    await unmount();
  });

  test("React Aria's combobox takes typed text too", async () => {
    const { form, q, run, unmount } = await mount(aria.reactAriaRenderers);
    const box = q('.fs-aria-combobox').find((b) => b.textContent.startsWith('City'))!;
    const input = box.querySelector('input')!;
    expect(input.getAttribute('role')).toBe('combobox');
    await run(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Berl');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(form.values.city).toBe('Berl');
    await unmount();
  });
});
