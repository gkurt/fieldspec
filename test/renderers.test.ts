/** Renderers as a function: picking a renderer per element from the field it draws. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { act, createElement } from 'react';
import type * as ClientModule from 'react-dom/client';
import { createForm, define } from '#src/index.ts';
import type { ControlProps, ElementRenderer, LayoutProps, RenderRequest, Renderers, ResolveRenderer } from '#src/react/index.tsx';
import type * as UiModule from '#src/react/index.tsx';

/** The part of React the tests use, imported once the DOM is registered. */
type ReactModule = { act: typeof act; createElement: typeof createElement };

/** A field's value as an input shows it; the values here are strings and numbers. */
const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

const spec = define({
  fields: {
    work: { use: 'email', label: 'Work email' },
    home: { use: 'email', label: 'Home email', render: 'textarea' },
    name: { type: 'string' },
    size: { type: 'enum', options: ['s', 'm', 'l'] },
    tone: { type: 'enum', options: ['calm', 'loud'], render: 'select' },
    width: { type: 'int', group: 'box' },
    height: { type: 'int', group: 'box' },
  },
  groups: { box: { label: 'Box', render: 'row' } },
});

describe('Renderer functions', () => {
  let React: ReactModule;
  let client: typeof ClientModule;
  let ui: typeof UiModule;
  // Renderers made once, as they must be: a new one per call would remount the control.
  let Email: ElementRenderer;
  let Chips: ElementRenderer;
  let Boxed: ElementRenderer;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import('react');
    client = await import('react-dom/client');
    ui = await import('#src/react/index.tsx');
    const h = React.createElement;
    Email = (p: ControlProps) => h('output', { className: 'email', 'data-element': p.node.control?.type }, text(p.field.value));
    Chips = (p: ControlProps) =>
      h('div', { className: 'chips' }, ...(p.field.options ?? []).map((o) => h('button', { key: o.label }, o.label)));
    Boxed = (p: LayoutProps) => h('section', { className: 'boxed' }, p.children);
  });
  afterAll(() => GlobalRegistrator.unregister());

  async function mount(renderers: Renderers | ResolveRenderer) {
    const form = createForm(spec, { values: { work: 'a@b.co', home: 'c@d.co' } });
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    await React.act(async () => root.render(React.createElement(ui.FormView, { form, renderers })));
    const q = (s: string) => [...host.querySelectorAll<HTMLElement>(s)];
    return { form, host, q, unmount: () => React.act(async () => root.unmount()) };
  }

  test('picks by what the field is, whichever element it would have been', async () => {
    const seen: RenderRequest[] = [];
    const { q, unmount } = await mount((want) => {
      if (want.role === 'control') seen.push(want);
      return (want.field?.decl as { format?: string } | undefined)?.format === 'email' && want.role === 'control' ? Email : undefined;
    });
    // Both emails, the one drawn as an input by default and the one the spec makes a textarea.
    expect(q('output.email').map((e) => e.textContent)).toEqual(['a@b.co', 'c@d.co']);
    expect(q('output.email').map((e) => e.dataset.element)).toEqual(['input', 'textarea']);
    // The rest are drawn as the table has them.
    expect(q('select')).toHaveLength(2);
    const at = (path: string) => seen.find((w) => w.field?.path === path)!;
    expect([at('/work').element, at('/work').explicit]).toEqual(['input', false]);
    expect([at('/home').element, at('/home').explicit]).toEqual(['textarea', true]);
    expect([at('/size').element, at('/size').explicit]).toEqual(['select', false]);
    expect([at('/tone').element, at('/tone').explicit]).toEqual(['select', true]);
    await unmount();
  });

  test("can keep the control the spec names, and replace only the kind's default", async () => {
    const { q, unmount } = await mount((want, next) => (want.element === 'select' && !want.explicit ? Chips : next()));
    // `size` leaves its control to its kind; `tone` names `select`.
    expect(q('.chips')).toHaveLength(1);
    expect(q('.chips button').map((b) => b.textContent)).toEqual(['s', 'm', 'l']);
    expect(q('select')).toHaveLength(1);
    await unmount();
  });

  test('reaches layout elements, and lays over a table of its own', async () => {
    const Plain = (p: ControlProps) => React.createElement('input', { className: 'plain', value: text(p.field.value), readOnly: true });
    const table: Renderers = ui.defineRenderers({ input: Plain });
    const { q, unmount } = await mount(ui.extendRenderers(table, (want) => (want.node.group === 'box' ? Boxed : undefined)));
    // The group's row is replaced; its fields still draw, through the table beneath.
    expect(q('section.boxed')).toHaveLength(1);
    expect(q('section.boxed label').map((l) => l.textContent)).toEqual(['Width', 'Height']);
    expect(q('section.boxed input.plain')).toHaveLength(2);
    // The table's own renderer reaches every input, and the default ones everything else.
    expect(q('input.plain')).toHaveLength(4);
    expect(q('textarea')).toHaveLength(1);
    await unmount();
  });

  test("a control's state lasts while the function returns the same renderer", async () => {
    const resolve: ResolveRenderer = (want, next) => next();
    const { form, q, unmount } = await mount(resolve);
    const name = q('input[id$="_name"]')[0] as HTMLInputElement;
    name.focus();
    await React.act(async () => form.set('/size', 'm'));
    expect(q('input[id$="_name"]')[0]).toBe(name);
    expect(document.activeElement).toBe(name);
    await unmount();
  });
});

// Types only: `defineRenderers` gives each built-in element's renderer its role's props.
export const typed = (ui: typeof UiModule) =>
  ui.defineRenderers({
    input: (p) => p.field.label + String(p.disabled), // ControlProps
    field: (p) => p.control(), // FieldProps
    stack: (p) => p.children, // LayoutProps
    label: (p) => p.field?.label ?? null, // PartProps
  });
