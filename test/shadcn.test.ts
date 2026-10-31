/** shadcn/ui drawing a fieldspec form: the form stays fieldspec's, every element is shadcn's. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { act, createElement } from 'react';
import type * as ClientModule from 'react-dom/client';
import type * as ShadcnModule from '#examples/renderers/shadcn.tsx';
import { createForm, define } from '#src/index.ts';
import type * as UiModule from '#src/react/index.tsx';

/** The part of React the tests use, imported once the DOM is registered. */
type ReactModule = { act: typeof act; createElement: typeof createElement };

const spec = define({
  fields: {
    name: { type: 'string', required: true, description: 'Shown on the card.' },
    email: { use: 'email' },
    port: { type: 'int', min: 1, max: 65535, default: 8080 },
    width: { type: 'int', default: 320, unit: 'px' },
    opacity: { use: 'percent', default: 0.5 },
    public: { type: 'boolean', render: 'switch' },
    agree: { type: 'boolean' },
    region: { type: 'enum', options: ['eu', 'us'], default: 'eu' },
    size: { type: 'enum', options: ['s', 'm', 'l'], default: 'm', render: 'radio' },
    layout: { type: 'enum', options: ['stack', 'grid'], default: 'stack', render: 'segmented' },
    days: { type: 'set', items: { type: 'enum', options: ['mon', 'tue', 'wed'] } },
    start: { type: 'date', default: '2026-10-31' },
    accent: { use: 'color', default: '#2456e6' },
    city: { type: 'string', suggestions: ['Berlin', 'Bern', 'Lisbon'] },
    gap: { type: 'int', default: 8, enabled: { $state: 'layout', eq: 'grid' } },
    tags: { type: 'array', items: { type: 'string' }, default: ['a'] },
    people: {
      type: 'array',
      namedBy: 'name',
      render: { type: 'accordion', props: { open: 'first' } },
      items: { type: 'object', fields: { name: { type: 'string' } } },
      default: [{ name: 'Ada' }, { name: 'Lin' }],
    },
    stock: { type: 'record', values: { type: 'int' }, default: { apples: 4 } },
  },
});

describe('shadcn renderers', () => {
  let React: ReactModule;
  let client: typeof ClientModule;
  let ui: typeof UiModule;
  let shadcn: typeof ShadcnModule;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import('react');
    client = await import('react-dom/client');
    ui = await import('#src/react/index.tsx');
    shadcn = await import('#examples/renderers/shadcn.tsx');
  });
  afterAll(() => GlobalRegistrator.unregister());

  async function mount() {
    const form = createForm(spec);
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    const act = (fn: () => void) => React.act(async () => fn());
    await act(() => root.render(React.createElement(ui.FormView, { form, renderers: shadcn.shadcnRenderers })));
    const q = (s: string) => [...host.querySelectorAll<HTMLElement>(s)];
    /** A field's frame, by the id its control carries. */
    const field = (path: string) => q('[data-slot=field], [data-slot=field-set]').find((f) => f.querySelector(`[id$="${path}"]`))!;
    const type = (input: HTMLInputElement, text: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    return { form, host, q, field, act, type, unmount: () => act(() => root.unmount()) };
  }

  test("draws each control with shadcn's own, labelled and described", async () => {
    const { q, unmount } = await mount();
    for (const slot of [
      'input',
      'input-group',
      'slider',
      'switch',
      'checkbox',
      'select-trigger',
      'radio-group',
      'toggle-group',
      'accordion',
    ])
      expect(q(`[data-slot=${slot}]`).length, slot).toBeGreaterThan(0);

    // The label points at the input; the description sits under it.
    const name = q('input[data-slot=input]')[0]!;
    const label = q(`label[for="${name.id}"]`)[0]!;
    expect(label.textContent).toBe('Name*');
    expect(label.closest('[data-slot=field]')!.querySelector('[data-slot=field-description]')!.textContent).toBe('Shown on the card.');
    // A unit sits in the input's group; a percent slider shows a percent, and its thumb is named by the label.
    expect(q('[data-slot=input-group]')[0]!.textContent).toBe('px');
    const thumb = q('[role=slider]')[0]!;
    expect(document.getElementById(thumb.getAttribute('aria-labelledby')!)!.textContent).toBe('Opacity');
    expect(q('[data-slot=slider] + output')[0]!.textContent).toBe('50%');
    // Radios and toggles are named by their options, the group by its legend.
    expect(q('[data-slot=radio-group] label').map((l) => l.textContent)).toEqual(['s', 'm', 'l']);
    expect(q('[data-slot=toggle-group-item][data-state=on]').map((t) => t.textContent)).toEqual(['stack']);
    const group = q('[data-slot=radio-group]')[0]!;
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent).toBe('Size');
    await unmount();
  });

  test('edits the form, and follows it', async () => {
    const { form, q, act, type, unmount } = await mount();
    const values = () =>
      form.values as { name: string; public: boolean; agree: boolean; size: string; days: Set<string>; port: number; region: string };
    await type(q('input[data-slot=input]')[0] as HTMLInputElement, 'Ada');
    expect(values().name).toBe('Ada');
    await act(() => q('[data-slot=switch]')[0]!.click());
    expect(values().public).toBe(true);
    await act(() => q('[data-slot=checkbox]')[0]!.click());
    expect(values().agree).toBe(true);
    await act(() => q('[data-slot=radio-group-item]')[2]!.click());
    expect(values().size).toBe('l');
    await act(() => q('[data-slot=checkbox-group] [data-slot=checkbox]')[1]!.click());
    expect([...values().days]).toEqual(['tue']);
    await act(() => form.set('/port', 443));
    expect(q('input[type=number]').map((i) => (i as HTMLInputElement).value)).toContain('443');
    await act(() => form.set('/layout', 'grid'));
    expect(q('[data-slot=toggle-group-item][data-state=on]').map((t) => t.textContent)).toEqual(['grid']);
    await act(() => form.set('/region', 'us'));
    expect(q('[data-slot=select-value]')[0]!.textContent).toBe('us');
    await unmount();
  });

  test('a mixed checkbox shows a dash', async () => {
    const form = createForm(define({ fields: { on: { type: 'boolean' } } }), { mixed: ['/on'] });
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    await React.act(async () => root.render(React.createElement(ui.FormView, { form, renderers: shadcn.shadcnRenderers })));
    expect(host.querySelector('[data-slot=checkbox]')!.getAttribute('data-state')).toBe('indeterminate');
    await React.act(async () => root.unmount());
  });

  test('a date is the day it is in fieldspec, and a colour its hex', async () => {
    const { form, q, act, unmount } = await mount();
    const day = () => q('[data-slot=popover-trigger]')[0]!.textContent;
    expect(day()).toContain('31');
    await act(() => form.set('/start', new Date('2027-02-03T00:00:00Z')));
    expect(day()).toContain('2027');
    expect(day()).toContain('3');
    const hex = q('[data-slot=input-group] input[data-slot=input-group-control]').map((i) => (i as HTMLInputElement).value);
    expect(hex).toContain('#2456e6');
    await unmount();
  });

  test('offers suggestions that match what is typed', async () => {
    const { form, q, act, type, unmount } = await mount();
    const city = q('input[role=combobox]')[0] as HTMLInputElement;
    await act(() => city.focus());
    await type(city, 'ber');
    const offered = () => [...document.querySelectorAll('[data-slot=command-item]')].map((i) => i.textContent);
    expect(offered()).toEqual(['Berlin', 'Bern']);
    // The box keeps the focus while the list highlights an option, and is named by the field's label.
    expect(document.activeElement).toBe(city);
    expect(document.getElementById(city.getAttribute('aria-labelledby')!)!.textContent).toBe('City');
    await act(() => (document.querySelector('[data-slot=command-item]') as HTMLElement).click());
    expect((form.values as { city: string }).city).toBe('Berlin');
    expect(offered()).toEqual([]);
    await unmount();
  });

  test('shows issues once touched, and disables by condition', async () => {
    const { form, field, act, unmount } = await mount();
    expect(field('name').getAttribute('data-invalid')).toBe('false');
    await act(() => form.touch('/name'));
    expect(field('name').getAttribute('data-invalid')).toBe('true');
    expect(field('name').querySelector('[data-slot=field-error]')!.textContent).not.toBe('');
    const gap = () => (field('gap').querySelector('input') as HTMLInputElement).disabled;
    expect(gap()).toBe(true);
    await act(() => form.set('/layout', 'grid'));
    expect(gap()).toBe(false);
    await unmount();
  });

  test('lists add, remove and reorder; records rename keys; an accordion is headed by names', async () => {
    const { form, q, act, type, unmount } = await mount();
    const values = () => form.values as { tags: string[]; people: { name: string }[]; stock: Record<string, number> };
    const tags = q('[data-slot=field-set][data-kind=array]')[0]!;
    await act(() => [...tags.querySelectorAll('button')].find((b) => b.textContent === 'Add')!.click());
    expect(values().tags).toHaveLength(2);
    await act(() => (tags.querySelector('[aria-label^="Remove"]') as HTMLElement).click());
    expect(values().tags).toHaveLength(1);

    expect(q('[data-slot=accordion-trigger]').map((t) => t.textContent)).toEqual(['Ada', 'Lin']);
    expect(q('[data-slot=accordion-item][data-state=open]')).toHaveLength(1);
    const handle = q('[data-slot=accordion] [role=button]')[0]!;
    await act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(values().people.map((p) => p.name)).toEqual(['Lin', 'Ada']);

    const key = q('input[aria-label=Key]')[0] as HTMLInputElement;
    await type(key, 'pears');
    await act(() => key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(values().stock).toEqual({ pears: 4 });
    await unmount();
  });
});
