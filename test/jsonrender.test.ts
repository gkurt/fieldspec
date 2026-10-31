/**
 * `toJsonRender` against the real thing: the output is checked with json-render's own
 * validators and `@json-render/shadcn`'s component props, then drawn with its React renderer
 * and those components in a DOM, and edited.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createStateStore, defineCatalog, resolvePropValue, validateSpec } from '@json-render/core';
import type * as JsonRenderReactModule from '@json-render/react';
import { schema } from '@json-render/react/schema';
import type * as ShadcnModule from '@json-render/shadcn';
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog';
import type { act, createElement } from 'react';
import type * as ClientModule from 'react-dom/client';
import { createCel } from '#src/cel.ts';
import {
  createRegistry,
  define,
  fromJsonRenderState,
  JSON_RENDER_ACTIONS,
  jsonRenderActions,
  jsonRenderFunctions,
  parse,
  toJsonRender,
  toJsonRenderState,
} from '#src/index.ts';

/** The part of React the tests use, imported once the DOM is registered. */
type ReactModule = { act: typeof act; createElement: typeof createElement };

const spec = define({
  fields: {
    name: { type: 'string', label: 'Name', placeholder: 'Ada' },
    port: { type: 'int', min: 1, max: 65535, default: 8080, hint: 'Where it listens.' },
    secure: { type: 'boolean', render: 'switch' },
    level: { type: 'enum', options: [1, 2, 3], default: 2 },
    plan: {
      type: 'enum',
      options: [
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro' },
      ],
      render: 'segmented',
    },
    notify: { type: 'set', items: { type: 'enum', options: ['billing', 'security'] } },
    tags: { type: 'set', items: { type: 'string' } },
    webhooks: {
      type: 'array',
      items: {
        type: 'object',
        fields: {
          url: { type: 'url' },
          signed: { type: 'boolean' },
          secret: { use: 'password', visible: { $state: 'signed', eq: true } },
        },
      },
    },
    headers: { type: 'record', values: { type: 'string' } },
    limits: { type: 'map', keys: { type: 'int' }, values: { type: 'string' } },
    auth: {
      type: 'variant',
      key: 'method',
      variants: {
        password: { label: 'Password', fields: { minLength: { type: 'int', default: 12 } } },
        sso: { label: 'Single sign-on', fields: { issuer: { type: 'url' } } },
      },
    },
    extra: { type: 'json', optional: true },
    menu: { use: 'Entry' },
  },
  defs: {
    Entry: {
      type: 'object',
      fields: { label: { type: 'string' }, children: { type: 'array', items: { use: 'Entry' } } },
    },
  },
  layouts: {
    tabs: {
      type: 'tabs',
      children: [
        { type: 'stack', props: { title: 'Basics' }, children: [{ field: 'name' }, { field: 'port' }] },
        { type: 'stack', props: { title: 'Rest' }, children: [{ type: 'rest' }] },
      ],
    },
  },
});

const values = {
  name: 'api',
  level: 3,
  notify: ['security'],
  tags: ['a', 'b'],
  webhooks: [{ url: 'https://hooks.example/1', signed: true, secret: 's3cret' }],
  headers: { 'X-Trace': 'on' },
  limits: [[10, 'ten']],
  auth: { method: 'password', minLength: 16 },
  extra: { any: [1, 2] },
  menu: { label: 'Home', children: [{ label: 'Docs', children: [] }] },
};

const catalog = defineCatalog(schema, { components: shadcnComponentDefinitions, actions: JSON_RENDER_ACTIONS });
type Def = { props: { partial(): { strict(): { safeParse(v: unknown): { success: boolean; error?: unknown } } } }; slots?: string[] };
const definitions = shadcnComponentDefinitions as unknown as Record<string, Def>;

/** Each element's props as its component would get them, bindings left out (their values are state's). */
function propIssues(out: ReturnType<typeof toJsonRender>, functions?: ReturnType<typeof jsonRenderFunctions>) {
  const issues: string[] = [];
  const ctx = { stateModel: out.state ?? {}, repeatItem: {}, repeatIndex: 0, repeatBasePath: '/repeat/0', functions };
  for (const [key, el] of Object.entries(out.elements)) {
    const def = definitions[el.type];
    if (!def) {
      issues.push(`${key}: ${el.type} is not in the catalog`);
      continue;
    }
    const props: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(el.props)) {
      const bound = value && typeof value === 'object' && ('$bindState' in value || '$bindItem' in value);
      if (!bound) props[name] = resolvePropValue(value, ctx);
    }
    const parsed = def.props.partial().strict().safeParse(props);
    if (!parsed.success) issues.push(`${key} (${el.type}): ${JSON.stringify(parsed.error)}`);
    if (!def.slots && el.children.length > 0) issues.push(`${key} (${el.type}) takes no children`);
  }
  return issues;
}

describe('json-render output, checked by json-render', () => {
  for (const view of [undefined, 'tabs']) {
    test(`the ${view ?? 'default'} layout is a valid spec for the shadcn catalog`, () => {
      const out = toJsonRender(spec, { values, view });
      expect(validateSpec(out as never).issues).toEqual([]);
      expect(catalog.validate(out).success).toBe(true);
      expect(propIssues(out)).toEqual([]);
    });
  }

  test('lists, sets, records and maps repeat over state', () => {
    const out = toJsonRender(spec, { values });
    const repeats = Object.values(out.elements).flatMap((e) => (e.repeat ? [e.repeat.statePath] : []));
    expect(repeats).toEqual(
      expect.arrayContaining([
        '/form/tags',
        '/form/webhooks',
        '/form/headers',
        '/form/limits',
        '/form/menu/children',
        { $item: 'children' },
      ]),
    );
    const form = (out.state as { form: Record<string, unknown> }).form;
    expect(form.headers).toEqual([{ key: 'X-Trace', value: 'on' }]);
    expect(form.limits).toEqual([{ key: 10, value: 'ten' }]);
    expect(form.level).toBe('3');
    expect(form.notify).toBe('security');
    expect(form.extra).toBe(JSON.stringify({ any: [1, 2] }, null, 2));
  });

  test('a definition that contains itself is drawn to a depth, then noted', () => {
    const deep = toJsonRender(spec, { values, depth: 2 });
    const notes = Object.values(deep.elements).filter((e) => String(e.props.text).includes('deeper levels are not shown'));
    expect(notes.length).toBe(1);
  });

  test('state converts back to the same values', () => {
    const state = { form: toJsonRenderState(spec, values) };
    const back = parse(spec, fromJsonRenderState(spec, state));
    expect(back.ok).toBe(true);
    expect(back.value).toEqual(parse(spec, values).value);
  });

  test("an enum's choices are held by label, which selects show, and conditions compare", () => {
    const regions = define({
      fields: {
        region: {
          type: 'enum',
          options: [
            { value: 'eu', label: 'Europe' },
            { value: 'us', label: 'United States' },
          ],
        },
        sizes: {
          type: 'set',
          items: {
            type: 'enum',
            options: [
              { value: 1, label: 'One' },
              { value: 2, label: 'Two' },
            ],
          },
          render: 'checks',
        },
        // Repeated labels cannot stand for their values: these keep the values.
        tier: {
          type: 'enum',
          options: [
            { value: 'a', label: 'Same' },
            { value: 'b', label: 'Same' },
          ],
        },
        vat: { type: 'string', visible: { $state: 'region', eq: 'eu' } },
      },
    });
    const out = toJsonRender(regions, { values: { region: 'us', sizes: [2], tier: 'b' } });
    const form = (out.state as { form: Record<string, unknown> }).form;
    expect(form).toMatchObject({ region: 'United States', sizes: 'Two', tier: 'b' });
    const select = Object.values(out.elements).find((e) => e.type === 'Select' && e.props.name === 'region')!;
    expect(select.props.options).toEqual(['Europe', 'United States']);
    expect(
      Object.values(out.elements).some((e) => JSON.stringify(e.visible) === JSON.stringify({ $state: '/form/region', eq: 'Europe' })),
    ).toBe(true);
    expect(parse(regions, fromJsonRenderState(regions, out.state)).value).toEqual({
      region: 'us',
      sizes: new Set([2]),
      tier: 'b',
      vat: '',
    });
  });
});

describe('json-render output, drawn by json-render', () => {
  let React: ReactModule;
  let client: typeof ClientModule;
  let jr: typeof JsonRenderReactModule;
  let shadcn: typeof ShadcnModule;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import('react');
    client = await import('react-dom/client');
    jr = await import('@json-render/react');
    shadcn = await import('@json-render/shadcn');
  });
  afterAll(() => GlobalRegistrator.unregister());

  async function mount(view?: string) {
    const out = toJsonRender(spec, { values, view });
    const store = createStateStore(out.state);
    const { registry } = jr.defineRegistry(catalog, {
      components: shadcn.shadcnComponents,
      actions: jsonRenderActions(store) as never,
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    await React.act(async () =>
      root.render(
        React.createElement(jr.JSONUIProvider, {
          registry,
          store,
          handlers: jsonRenderActions(store),
          children: React.createElement(jr.Renderer, { spec: out as never, registry }),
        }),
      ),
    );
    const act = (fn: () => void) => React.act(async () => fn());
    const buttons = (label: string) => [...host.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);
    const type = (input: HTMLInputElement, text: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    return { host, store, root, act, buttons, type, values: () => parse(spec, fromJsonRenderState(spec, store.getSnapshot())) };
  }

  test('draws every field, bound to state, and edits round-trip to values', async () => {
    const ui = await mount();
    const name = ui.host.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(name.value).toBe('api');
    await ui.type(name, 'gateway');
    const port = ui.host.querySelector<HTMLInputElement>('input[name="port"]')!;
    await ui.type(port, '9090');
    expect(ui.host.textContent).toContain('Where it listens.');

    // A list of objects: its items' fields bind to the item; a condition reads a sibling in it.
    const urls = () => [...ui.host.querySelectorAll<HTMLInputElement>('input[name="webhooks/*/url"]')];
    expect(urls().map((i) => i.value)).toEqual(['https://hooks.example/1']);
    expect(ui.host.querySelector<HTMLInputElement>('input[name="webhooks/*/secret"]')?.type).toBe('password');

    const result = ui.values();
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      name: 'gateway',
      port: 9090,
      level: 3,
      headers: { 'X-Trace': 'on' },
      limits: new Map([[10, 'ten']]),
    });
    await ui.act(() => ui.root.unmount());
  });

  test('add and remove buttons edit lists, records and nested lists', async () => {
    const ui = await mount();
    const count = (path: string) => (ui.store.get(path) as unknown[]).length;
    // Add buttons in document order: tags, webhooks, headers, limits, then the menu item's own
    // children (inside the item), then the menu's children.
    const [addTag, addHook, addHeader] = ui.buttons('Add');
    await ui.act(() => addHook!.click());
    expect(count('/form/webhooks')).toBe(2);
    await ui.act(() => addHeader!.click());
    const key = [...ui.host.querySelectorAll<HTMLInputElement>('input[name="headers/*/key"]')].at(-1)!;
    await ui.type(key, 'X-New');
    await ui.act(() => addTag!.click());
    expect(count('/form/tags')).toBe(3);

    // The nested list inside a menu item: its remove button uses the removeItem action.
    expect(count('/form/menu/children/0/children')).toBe(0);
    const nestedAdd = ui.buttons('Add').at(-2)!;
    await ui.act(() => nestedAdd.click());
    expect(count('/form/menu/children/0/children')).toBe(1);
    // The new item's remove button comes before its parent item's.
    const nestedRemove = ui.buttons('Remove').at(-2)!;
    await ui.act(() => nestedRemove.click());
    expect(count('/form/menu/children/0/children')).toBe(0);

    await ui.act(() => ui.buttons('Remove')[0]!.click());
    expect(count('/form/tags')).toBe(2);

    const result = ui.values();
    expect((result.value as { headers: Record<string, string> }).headers).toEqual({ 'X-Trace': 'on', 'X-New': '' });
    expect((result.value as { webhooks: unknown[] }).webhooks).toHaveLength(2);
    await ui.act(() => ui.root.unmount());
  });

  test('code runs through jsonRenderFunctions, and derived values follow', async () => {
    const registry = createRegistry({ languages: [createCel()] });
    const order = registry.define(
      {
        fields: {
          qty: { type: 'int', default: 2 },
          price: { type: 'number', default: 1.5 },
          total: {
            type: 'number',
            label: 'Total',
            value: { $cel: 'double(qty) * price', args: { qty: { $state: 'qty' }, price: { $state: 'price' } } },
          },
          note: { type: 'string', label: { $computed: 'shout', args: { s: { $state: 'qty' } } } },
          // A condition json-render cannot run holds.
          gift: { type: 'boolean', visible: { $cel: 'qty > 5', args: { qty: { $state: 'qty' } } } },
        },
      },
      { fns: { shout: ({ s }) => `Note for ${String(s)}!` } },
    );
    const out = toJsonRender(order);
    expect(propIssues(out, jsonRenderFunctions(order))).toEqual([]);
    const store = createStateStore(out.state);
    const { registry: components } = jr.defineRegistry(catalog, {
      components: shadcn.shadcnComponents,
      actions: jsonRenderActions(store) as never,
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    await React.act(async () =>
      root.render(
        React.createElement(jr.JSONUIProvider, {
          registry: components,
          store,
          functions: jsonRenderFunctions(order),
          children: React.createElement(jr.Renderer, { spec: out as never, registry: components }),
        }),
      ),
    );
    expect(host.textContent).toContain('Total');
    expect(host.textContent).toContain('3');
    expect(host.textContent).toContain('Note for 2!');
    expect(host.querySelector('input[name="gift"], button[role="checkbox"]')).not.toBeNull();
    await React.act(async () => store.set('/form/qty', 4));
    expect(host.textContent).toContain('6');
    expect(host.textContent).toContain('Note for 4!');
    expect(parse(order, fromJsonRenderState(order, store.getSnapshot())).value).toMatchObject({ qty: 4, total: 6 });
    await React.act(async () => root.unmount());
  });

  test('the tabs layout shows one tab at a time', async () => {
    const ui = await mount('tabs');
    expect(ui.host.querySelector('input[name="name"]')).not.toBeNull();
    expect(ui.host.querySelector('input[name="webhooks/*/url"]')).toBeNull();
    await ui.act(() => ui.store.set('/ui/tabs0', 'tab-1'));
    expect(ui.host.querySelector('input[name="name"]')).toBeNull();
    expect(ui.host.querySelector('input[name="webhooks/*/url"]')).not.toBeNull();
    await ui.act(() => ui.root.unmount());
  });
});
