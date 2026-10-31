/** DialKit's controls drawing a fieldspec form: the form stays fieldspec's, the controls are DialKit's. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { act, createElement } from 'react';
import type * as ClientModule from 'react-dom/client';
import type * as DialKitModule from '#examples/renderers/dialkit.tsx';
import { createForm, define } from '#src/index.ts';
import type { RenderRequest } from '#src/react/index.tsx';

/** The part of React the tests use, imported once the DOM is registered. */
type ReactModule = { act: typeof act; createElement: typeof createElement };

const card = define({
  fields: {
    title: { type: 'string', default: 'Hello', required: true },
    radius: { type: 'int', min: 0, max: 64, default: 16, render: 'slider', group: 'shape' },
    opacity: { use: 'percent', default: 0.5, group: 'shape' },
    accent: { use: 'color', default: '#2456e6' },
    layout: { type: 'enum', options: ['stack', 'grid'], default: 'stack', render: 'segmented' },
    visible: { type: 'boolean', default: true, render: 'switch' },
    gap: { type: 'int', default: 8, enabled: { $state: 'layout', eq: 'grid' } },
    secret: { use: 'password' },
    tags: { type: 'array', items: { type: 'string' }, default: ['a', 'b'] },
    shadow: { type: 'object', fields: { blur: { type: 'int', min: 0, max: 40, default: 12, render: 'slider' } } },
  },
  groups: { shape: { label: 'Shape', render: 'row' } },
});

describe('DialKitView', () => {
  let React: ReactModule;
  let client: typeof ClientModule;
  let ui: typeof DialKitModule;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import('react');
    client = await import('react-dom/client');
    ui = await import('#examples/renderers/dialkit.tsx');
  });
  afterAll(() => GlobalRegistrator.unregister());

  async function mount() {
    const form = createForm(card);
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    const act = (fn: () => void) => React.act(async () => fn());
    await act(() => root.render(React.createElement(ui.DialKitView, { form, title: 'Card', theme: 'dark' })));
    const q = (s: string) => [...host.querySelectorAll<HTMLElement>(s)];
    return { form, host, q, act, unmount: () => act(() => root.unmount()) };
  }

  test("draws each control with DialKit's own, groups and objects as its folders", async () => {
    const { host, q, unmount } = await mount();
    expect(host.querySelector('.dialkit-root')?.getAttribute('data-theme')).toBe('dark');
    // Text controls: the title, the gap (an unbounded int), and the list's two items.
    expect(q('.dialkit-text-label').map((e) => e.textContent)).toEqual(['Title *', 'Gap', '#1', '#2']);
    expect(q('textarea.dialkit-text-input:not([aria-hidden])').map((e) => (e as HTMLTextAreaElement).value)).toEqual([
      'Hello',
      '8',
      'a',
      'b',
    ]);
    expect(q('.dialkit-slider-label').map((e) => e.textContent)).toEqual(['Radius', 'Opacity', 'Blur']);
    expect(q('.dialkit-color-control')).toHaveLength(1);
    expect(q('.dialkit-select-label').map((e) => e.textContent)).toEqual(['Layout']);
    expect(q('.dialkit-folder-title').map((e) => e.textContent)).toEqual(['Card', 'Shape', 'Tags', 'Shadow']);
    await unmount();
  });

  test("keeps fieldspec's own controls where DialKit has none", async () => {
    const { q, unmount } = await mount();
    // The password keeps its masked input; the list keeps its items, handles and Add.
    expect(q('input[type="password"]')).toHaveLength(1);
    expect(q('.fs-handle')).toHaveLength(2);
    expect(q('button').some((b) => b.textContent === 'Add')).toBe(true);
    await unmount();
  });

  test('edits the form, and follows it', async () => {
    const { form, q, act, unmount } = await mount();
    const title = q('textarea.dialkit-text-input:not([aria-hidden])')[0] as unknown as HTMLTextAreaElement;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(title, 'Changed');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect((form.values as { title: string }).title).toBe('Changed');
    await act(() => form.set('/tags/-', 'c'));
    expect(q('.fs-handle')).toHaveLength(3);
    await unmount();
  });

  test("a control laid over DialKit's keeps fieldspec's frame, with its label", async () => {
    const form = createForm(card);
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    const Mine = () => React.createElement('output', { className: 'mine' }, 'mine');
    const renderers = (want: RenderRequest) => (want.role === 'control' && want.field?.path === '/title' ? Mine : undefined);
    await React.act(async () => root.render(React.createElement(ui.DialKitView, { form, title: 'Card', renderers })));
    expect(host.querySelectorAll('output.mine')).toHaveLength(1);
    expect([...host.querySelectorAll('.fs-label')].map((e) => e.textContent)).toEqual(['Title *', 'Secret']);
    // The others are DialKit's still.
    expect([...host.querySelectorAll('.dialkit-text-label')].map((e) => e.textContent)).toEqual(['Gap', '#1', '#2']);
    await React.act(async () => root.unmount());
  });

  test('makes a disabled field inert, and enables it with its condition', async () => {
    const { form, q, act, unmount } = await mount();
    expect(q('.fs-dial-disabled')).toHaveLength(1);
    expect(q('.fs-dial-disabled')[0]!.hasAttribute('inert')).toBe(true);
    await act(() => form.set('/layout', 'grid'));
    expect(q('.fs-dial-disabled')).toHaveLength(0);
    await unmount();
  });
});
