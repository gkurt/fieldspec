/** The example spec editor view (examples/editor.tsx), drawn in a DOM and driven through its elements. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { act, createElement } from 'react';
import type * as ClientModule from 'react-dom/client';
import type * as EditorModule from '#examples/editor.tsx';
import { createSpecEditor, type Spec, type SpecEditorOptions } from '#src/index.ts';

type ReactModule = { act: typeof act; createElement: typeof createElement };

const spec: Spec = {
  fields: {
    name: { type: 'string', required: true },
    address: { type: 'object', fields: { street: { type: 'string' } } },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

describe('SpecEditorView', () => {
  let React: ReactModule;
  let client: typeof ClientModule;
  let view: typeof EditorModule;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import('react');
    client = await import('react-dom/client');
    view = await import('#examples/editor.tsx');
  });
  afterAll(() => GlobalRegistrator.unregister());

  async function mount(options: SpecEditorOptions, props: Partial<EditorModule.SpecEditorViewProps> = {}) {
    const editor = createSpecEditor(options);
    const host = document.createElement('div');
    document.body.append(host);
    const root = client.createRoot(host);
    await React.act(async () => root.render(React.createElement(view.SpecEditorView, { editor, ...props })));
    const one = <E extends HTMLElement>(selector: string) => host.querySelector<E>(selector)!;
    const labelled = <E extends HTMLElement>(label: string) => one<E>(`[aria-label="${label}"]`);
    const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
    /** Types into a text box and leaves it, as a person would. */
    const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string, leave = true) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      if (leave) await React.act(async () => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    };
    const click = (el: HTMLElement) => React.act(async () => el.click());
    return { editor, host, one, labelled, button, type, click, unmount: () => React.act(async () => root.unmount()) };
  }

  test('draws every field as a row, nested ones inside their parent', async () => {
    const { host, unmount } = await mount({ spec });
    const keys = [...host.querySelectorAll<HTMLInputElement>('input.fse-key')].map((i) => i.value);
    expect(keys).toEqual(['name', 'address', 'street', 'tags']);
    expect(host.querySelector('span.fse-key')?.textContent).toBe('items');
    expect(host.querySelectorAll('button').length).toBeGreaterThan(8);
    await unmount();
  });

  test('renames, changes kind, requires, adds and removes through the editor', async () => {
    const { editor, labelled, button, type, click, host, unmount } = await mount({ spec });
    await type(labelled<HTMLInputElement>('Key of /fields/address/fields/street'), 'line1');
    expect(editor.node('/fields/address/fields/line1')?.kind).toBe('string');

    const kind = labelled<HTMLSelectElement>('Kind of /fields/tags/items');
    await React.act(async () => {
      kind.value = 'int';
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(editor.spec.fields.tags).toEqual({ type: 'array', items: { type: 'int' } });

    await click(labelled('/fields/name is required'));
    expect(editor.node('/fields/name')?.required).toBe(false);

    await click(button('Add a field'));
    expect(Object.keys(editor.spec.fields.address as object)).toEqual(['type', 'fields']);
    expect(editor.node('/fields/address/fields/field2')).toBeDefined();
    await click(labelled('Remove /fields/name'));
    expect(Object.keys(editor.spec.fields)).toEqual(['address', 'tags']);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await unmount();
  });

  test('shows why an edit was refused, and keeps the row as it was', async () => {
    const { editor, labelled, type, host, unmount } = await mount({ spec });
    await type(labelled<HTMLInputElement>('Key of /fields/name'), 'tags');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('"tags" is already here');
    expect(editor.spec).toBe(spec);
    await unmount();
  });

  test('applies edited JSON, or says what is wrong with it', async () => {
    const { editor, labelled, button, type, click, host, unmount } = await mount({ spec });
    const json = labelled<HTMLTextAreaElement>('The spec as JSON');
    await type(json, '{ "fields": ', false);
    await click(button('Apply'));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(editor.spec).toBe(spec);
    await type(json, '{ "fields": { "only": { "type": "boolean" } } }', false);
    await click(button('Apply'));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect([...host.querySelectorAll<HTMLInputElement>('input.fse-key')].map((i) => i.value)).toEqual(['only']);
    await unmount();
  });

  test('writes the fields from the description, asking before it replaces fields no description wrote', async () => {
    const asked: (readonly string[])[] = [];
    const written: Spec = { fields: { title: { type: 'string' } } };
    const { editor, one, button, type, click, host, unmount } = await mount(
      { spec, generate: () => written, describe: () => 'A title.' },
      {
        generate: true,
        describe: true,
        confirm: (keys) => {
          asked.push(keys);
          return asked.length > 1;
        },
      },
    );
    await type(one<HTMLTextAreaElement>('.fse-description textarea'), 'A title.', false);
    expect(host.querySelector('.fse-stale')).not.toBeNull();
    await click(button('Write the fields from it'));
    expect(asked).toEqual([['name', 'address', 'tags']]);
    expect(Object.keys(editor.spec.fields)).toEqual(['name', 'address', 'tags']);
    await click(button('Write the fields from it'));
    expect(Object.keys(editor.spec.fields)).toEqual(['title']);
    expect(host.querySelector('.fse-stale')).toBeNull();

    await click(button('Add a field'));
    expect(host.querySelector('.fse-stale')).not.toBeNull();
    await click(button('Describe the fields'));
    expect(editor.description).toBe('A title.');
    expect(host.querySelector('.fse-stale')).toBeNull();
    await unmount();
  });
});
