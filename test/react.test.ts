/** The React controls in a DOM: renaming entries' keys and reordering lists by dragging. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { act, createElement } from 'react';
import type * as ClientModule from 'react-dom/client';
import type * as HtmlModule from '#examples/renderers/html.tsx';
import { createForm, define } from '#src/index.ts';
import type * as UiModule from '#src/react/index.tsx';

/** The part of React the tests use, imported once the DOM is registered. */
type ReactModule = { act: typeof act; createElement: typeof createElement };

const spec = define({
  fields: {
    headers: { type: 'record', values: { type: 'string' } },
    limits: { type: 'map', keys: { type: 'int' }, values: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
  },
});

describe('React controls', () => {
  let React: ReactModule;
  let client: typeof ClientModule;
  let ui: typeof UiModule;
  let html: typeof HtmlModule;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import('react');
    client = await import('react-dom/client');
    ui = await import('#src/react/index.tsx');
    html = await import('#examples/renderers/html.tsx');
  });
  afterAll(() => GlobalRegistrator.unregister());

  async function mount(values: unknown) {
    const form = createForm(spec, { values });
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    const act = (fn: () => void) => React.act(async () => fn());
    await act(() => root.render(React.createElement(ui.FormView, { form, renderers: html.htmlRenderers })));
    const type = (input: HTMLInputElement, text: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const keys = () => [...host.querySelectorAll<HTMLInputElement>('input[aria-label="Key"]')];
    return { form, host, root, act, type, keys };
  }

  test("an entry's key is renamed in place, keeping its value and position", async () => {
    const { form, act, type, keys, root, host } = await mount({ headers: { A: '1', B: '2', C: '3' }, limits: [[10, 'ten']] });
    const b = keys()[1]!;
    await type(b, 'Beta');
    await act(() => b.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(Object.entries(form.values.headers)).toEqual([
      ['A', '1'],
      ['Beta', '2'],
      ['C', '3'],
    ]);

    // A taken key is refused, with the reason; Escape puts the key back.
    const c = keys()[2]!;
    await type(c, 'A');
    await act(() => c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(host.textContent).toContain('"A" is already a key');
    expect(Object.keys(form.values.headers)).toEqual(['A', 'Beta', 'C']);
    await act(() => c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(keys()[2]!.value).toBe('C');

    // A map's keys are read as its key kind.
    const ten = keys()[3]!;
    await type(ten, 'x');
    await act(() => ten.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(host.textContent).toContain('Enter a whole number');
    await type(ten, '20');
    await act(() => ten.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect([...form.values.limits]).toEqual([[20, 'ten']]);
    await act(() => root.unmount());
  });

  test('an absent object is offered, not drawn, so one that may contain itself ends', async () => {
    const chain = define({
      fields: { head: { use: 'Node' } },
      defs: { Node: { type: 'object', fields: { name: { type: 'string' }, next: { use: 'Node', optional: true } } } },
    });
    const form = createForm(chain, { values: { head: { name: 'a' } } });
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    const act = (fn: () => void) => React.act(async () => fn());
    await act(() => root.render(React.createElement(ui.FormView, { form, renderers: html.htmlRenderers })));
    const button = (label: string) => [...host.querySelectorAll('button')].filter((b) => b.textContent === label);
    expect(host.querySelectorAll('input')).toHaveLength(1);
    expect(button('Add')).toHaveLength(1);

    await act(() => button('Add')[0]!.click());
    expect(form.values.head).toEqual({ name: 'a', next: { name: '' } });
    expect(host.querySelectorAll('input')).toHaveLength(2);
    expect(button('Add')).toHaveLength(1);

    await act(() => button('Remove')[0]!.click());
    expect(form.values.head).toEqual({ name: 'a' });
    expect(host.querySelectorAll('input')).toHaveLength(1);
    await act(() => root.unmount());
  });

  test('a list item moves where its handle is dropped', async () => {
    const { form, act, host, root } = await mount({ steps: ['one', 'two', 'three'] });
    const rows = () => [...host.querySelectorAll<HTMLElement>('.fs-item')];
    const handle = rows()[0]!.querySelector<HTMLElement>('.fs-handle')!;
    expect(handle.getAttribute('draggable')).toBe('true');
    const drag = (type: string, target: HTMLElement) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
      event.dataTransfer = { setData() {}, setDragImage() {}, effectAllowed: '', dropEffect: '' };
      target.dispatchEvent(event);
    };
    await act(() => drag('dragstart', handle));
    await act(() => drag('dragover', rows()[2]!));
    expect(rows()[2]!.dataset.drop).toBe('after');
    await act(() => drag('drop', rows()[2]!));
    expect(form.values.steps).toEqual(['two', 'three', 'one']);
    expect(rows().some((r) => r.dataset.drop !== undefined)).toBe(false);
    await act(() => root.unmount());
  });

  test('a list item moves with the arrow keys on its handle, which keeps the focus', async () => {
    const { form, act, host, root } = await mount({ steps: ['one', 'two', 'three'] });
    const handles = () => [...host.querySelectorAll<HTMLElement>('.fs-handle')];
    expect(host.querySelector('[aria-label="Move up"], [aria-label="Move down"]')).toBeNull();
    const press = (el: HTMLElement, key: string) =>
      act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    handles()[0]!.focus();
    await press(handles()[0]!, 'ArrowDown');
    expect(form.values.steps).toEqual(['two', 'one', 'three']);
    expect(document.activeElement).toBe(handles()[1]!);
    await press(handles()[1]!, 'ArrowDown');
    await press(handles()[2]!, 'ArrowDown'); // already last
    expect(form.values.steps).toEqual(['two', 'three', 'one']);
    expect(document.activeElement).toBe(handles()[2]!);
    expect(handles()[2]!.getAttribute('aria-label')).toBe('Move #3, item 3 of 3');
    await act(() => root.unmount());
  });

  test('items are named by their key or position, not a label of their own', async () => {
    const { act, host, root } = await mount({ headers: { Accept: 'json' }, steps: ['one'] });
    const labels = [...host.querySelectorAll<HTMLLabelElement>('label.fs-label')];
    const of = (text: string) => labels.find((l) => l.textContent === text)!;
    expect(of('Accept').classList.contains('fs-sr-only')).toBe(true);
    expect(of('Headers')).toBeUndefined(); // a container's label is its legend
    expect(host.querySelector('legend')!.textContent).toBe('Headers');
    expect(labels.filter((l) => !l.classList.contains('fs-sr-only')).map((l) => l.textContent)).toEqual([]);
    await act(() => root.unmount());
  });

  test("a group's title sits on its frame, and a collapsible one opens from it", async () => {
    const grouped = define({
      fields: { a: { type: 'string', group: 'g' }, b: { type: 'string', group: 'h' } },
      groups: { g: { label: 'General' }, h: { label: 'More', render: { type: 'collapsible', props: { collapsed: true } } } },
    });
    const form = createForm(grouped);
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    const act = (fn: () => void) => React.act(async () => fn());
    await act(() => root.render(React.createElement(ui.FormView, { form, renderers: html.htmlRenderers })));
    expect([...host.querySelectorAll('fieldset > legend')].map((l) => l.textContent)).toEqual(['General', 'More']);
    const toggle = host.querySelector<HTMLButtonElement>('.fs-toggle')!;
    const body = () => host.querySelector<HTMLElement>(`#${CSS.escape(toggle.getAttribute('aria-controls')!)}`)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body().hidden).toBe(true);
    expect(body().style.display).toBe('');
    await act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body().hidden).toBe(false);
    await act(() => root.unmount());
  });

  test('useFormState is a new object on each change, and useField follows its field', async () => {
    const form = createForm(spec, { values: { steps: ['a'] } });
    const states: unknown[] = [];
    const Probe = () => {
      const state = ui.useFormState(form);
      const field = ui.useField(form, '/steps/0');
      states.push(state);
      return React.createElement('output', null, `${(state.json as { steps: string[] }).steps.length} ${String(field?.value)}`);
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    await React.act(async () => root.render(React.createElement(Probe)));
    expect(host.textContent).toBe('1 a');
    await React.act(async () => form.set('/steps/0', 'b'));
    expect(host.textContent).toBe('1 b');
    await React.act(async () => form.addItem('/steps'));
    expect(host.textContent).toBe('2 b');
    expect(new Set(states).size).toBe(3);
    await React.act(async () => root.unmount());
  });
});
