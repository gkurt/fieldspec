/** The prompt that teaches a model to write specs: what each purpose is told, and how long that is. */
import { describe, expect, test } from 'bun:test';
import { design } from '#examples/design.ts';
import { checkSpec, prompt, type PromptOptions, type Spec } from '#src/index.ts';

/** The spec a prompt shows under "Example". */
function exampleOf(text: string): Spec {
  const from = text.indexOf('```json', text.indexOf('## Example')) + '```json'.length;
  return JSON.parse(text.slice(from, text.indexOf('```', from)));
}

/** Every declaration of a spec's fields, at every depth, with its pointer. */
function declarations(fields: object, at = '/fields'): [string, Record<string, unknown>][] {
  return Object.entries(fields).flatMap(([key, decl]: [string, Record<string, unknown>]) => [
    [`${at}/${key}`, decl] as [string, Record<string, unknown>],
    ...(decl.fields ? declarations(decl.fields, `${at}/${key}/fields`) : []),
    ...((decl.items as { fields?: object } | undefined)?.fields
      ? declarations((decl.items as { fields: object }).fields, `${at}/${key}/items/fields`)
      : []),
  ]);
}

describe('prompt for data', () => {
  const text = prompt(undefined, { purpose: 'data' });

  test('says no form is drawn, and teaches nothing a form alone reads', () => {
    expect(text).toContain('Nothing draws it as a form');
    for (const word of [
      'render',
      'groups',
      'layouts',
      'locales',
      'placeholder',
      'hint',
      'label',
      'visible',
      'display',
      'slider',
      'patternMessage',
      '$state',
    ])
      expect(text).not.toContain(word);
  });

  test('asks for a description on every field, nesting over prefixed keys, and required and optional', () => {
    expect(text).toContain('Every field, at every depth, has a `description`.');
    expect(text).toContain('Never flatten its parts into keys with a shared prefix');
    expect(text).toContain('The sender must always give it: `required: true`.');
    expect(text).toContain('The sender may not know it, or it may not apply: `optional: true`');
    expect(text).toContain("the kind's zero");
  });

  test('names every kind with the properties it needs', () => {
    for (const kind of ['string', 'int', 'enum', 'date', 'array', 'object', 'variant', 'record']) expect(text).toContain(`### ${kind}`);
    for (const needed of ['`options` (required)', '`items` (required)', '`fields` (required)', '`variants` (required)'])
      expect(text).toContain(needed);
    expect(prompt(design, { purpose: 'data' })).toContain('### Gradient');
  });

  test('shows an example for a kind that cannot be written without one, and says a repeated list once', () => {
    expect(text).toContain('Example: `{"type":"variant","key":"method","variants":{"none":{"fields":{}}');
    expect(text).toContain('Example: `{"type":"record","values":{"type":"string"}}`');
    expect(text).toContain('### int\nA whole number.\nTakes what `number` takes.');
    const form = prompt();
    expect(form).toContain('Example: `{"type":"enum","label":"Mode"');
    expect(form).not.toContain('{"type":"boolean"');
  });

  test('offers the presets that say something about the value, not about its control', () => {
    expect(text).toContain('`email`');
    expect(text).toContain('`port`');
    for (const drawn of ['`percent`', '`password`', '`multiline`', '`color`']) expect(text).not.toContain(drawn);
  });

  test('shows an example that does what it asks: nested, described at every depth, and checked', () => {
    const example = exampleOf(text);
    expect(checkSpec(example)).toEqual([]);
    const all = declarations(example.fields);
    expect(all.map(([at]) => at)).toContain('/fields/customer/fields/email');
    expect(all.map(([at]) => at)).toContain('/fields/lines/items/fields/sku');
    for (const [at, decl] of all) {
      expect([at, typeof decl.description]).toEqual([at, 'string']);
      expect([at, decl.required === true && decl.optional === true]).toEqual([at, false]);
      for (const prop of ['label', 'group', 'render']) expect([at, prop in decl]).toEqual([at, false]);
    }
    expect(all.some(([, decl]) => decl.required === true)).toBe(true);
    expect(all.some(([, decl]) => decl.optional === true)).toBe(true);
    expect(all.some(([, decl]) => decl.required === undefined && decl.optional === undefined)).toBe(true);
  });

  test('takes rules of the application', () => {
    expect(prompt(undefined, { purpose: 'data', customRules: ['Amounts are in cents.'] }).endsWith('- Amounts are in cents.')).toBe(true);
  });
});

describe('prompt for a form', () => {
  test('is what prompt gives when no purpose is named', () => {
    expect(prompt(undefined, { purpose: 'form' })).toBe(prompt());
    expect(prompt()).toContain('how a form for them is laid out');
    expect(checkSpec(exampleOf(prompt()))).toEqual([]);
  });
});

/** The heading of each section a prompt has. */
const sections = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).split(' (')[0]);

describe('topics', () => {
  test('a form is taught conditions, groups and controls unless told otherwise', () => {
    expect(sections(prompt())).toEqual([
      'Every field may have',
      'Kinds',
      'Conditions',
      'Presets',
      'Groups',
      'Controls',
      'Example',
      'Rules',
    ]);
    expect(prompt()).toBe(prompt(undefined, { topics: ['conditions', 'groups', 'controls'] }));
  });

  test('data is taught none, and never what only a form draws', () => {
    const data = (topics: PromptOptions['topics']) => sections(prompt(undefined, { purpose: 'data', topics }));
    const plain = ['Every field may have', 'Given, unknown, or left to a default', 'Shape', 'Kinds', 'Presets', 'Example', 'Rules'];
    expect(data(undefined)).toEqual(plain);
    expect(data(['groups', 'controls', 'layout', 'locales'])).toEqual(plain);
    expect(data('all')).toEqual([
      'Every field may have',
      'Given, unknown, or left to a default',
      'Shape',
      'Kinds',
      'Conditions',
      'Checks',
      'Expressions',
      'Names',
      'Presets and definitions',
      'Versions and migrations',
      'Functions',
      'Example',
      'Rules',
    ]);
  });

  test('all teaches a form everything', () => {
    expect(sections(prompt(undefined, { topics: 'all' }))).toEqual([
      'Every field may have',
      'Kinds',
      'Conditions',
      'Checks',
      'Expressions',
      'Names',
      'Presets and definitions',
      'Translations',
      'Versions and migrations',
      'Groups',
      'Rendering',
      'Functions',
      'Example',
      'Rules',
    ]);
  });

  test('a topic brings the properties it is about, and the topics it leans on', () => {
    const none = prompt(undefined, { topics: [] });
    for (const prop of ['`visible`', '`enabled`', '`checks`', '`value`', '`group`', '`render`']) expect(none).not.toContain(prop);
    expect(none).toContain('- `required`: `true`: must be given and non-empty.');
    expect(sections(prompt(undefined, { topics: ['checks'] }))).toContain('Conditions');
    expect(prompt(undefined, { topics: ['checks'] })).toContain('- `checks`:');
    expect(sections(prompt(undefined, { topics: ['layout'] }))).toContain('Rendering');
    expect(prompt(undefined, { topics: ['layout'] })).toContain('- `slider`:');
    expect(sections(prompt(undefined, { topics: [], functions: { total: { returns: 'number' } } }))).toContain('Expressions');
  });

  test('the example uses only what was taught, and is a spec the checker takes', () => {
    for (const topics of [[], ['conditions'], ['groups'], ['controls'], 'all'] as PromptOptions['topics'][]) {
      const text = prompt(undefined, { topics });
      const example = exampleOf(text);
      expect(checkSpec(example).filter((f) => f.severity === 'error')).toEqual([]);
      const said = JSON.stringify(example);
      const taught = (topic: string) => topics === 'all' || topics!.includes(topic as never);
      expect([topics, said.includes('"visible"')]).toEqual([topics, taught('conditions')]);
      expect([topics, said.includes('"group"')]).toEqual([topics, taught('groups')]);
      expect([topics, said.includes('"render":"slider"')]).toEqual([topics, taught('controls')]);
      expect([topics, said.includes('"render":"row"')]).toEqual([topics, topics === 'all']);
    }
  });
});

describe('controls', () => {
  test('a form is offered the controls worth choosing, not the ones its fields already have', () => {
    const text = prompt();
    for (const offered of ['- `slider` [number, int]:', '- `segmented` [enum]:', '- `textarea` [string, json]:', '- `switch` [boolean]:'])
      expect(text).toContain(offered);
    for (const own of ['select', 'checkbox', 'date', 'variant', 'fields', 'entries', 'file']) expect(text).not.toContain(`- \`${own}\` [`);
    expect(prompt(undefined, { topics: ['layout'] })).toContain('- `select`: A drop-down of options. Edits: enum.');
  });
});

describe('length', () => {
  // How long each prompt may be, in characters. A prompt that grows past its budget fails here:
  // raise the budget only on purpose. The whole prompt was 18,650 before there were topics.
  const budgets: [name: string, options: PromptOptions, most: number][] = [
    ['a form', {}, 10_500],
    ['data', { purpose: 'data' }, 7_000],
    ['a form, every topic', { topics: 'all' }, 18_000],
    ['data, every topic', { purpose: 'data', topics: 'all' }, 11_500],
  ];
  for (const [name, options, most] of budgets) {
    test(`the prompt for ${name} is at most ${most} characters`, () => {
      expect(prompt(undefined, options).length).toBeLessThanOrEqual(most);
    });
  }

  test('data is well under half of what the whole prompt was, and a form is much shorter', () => {
    expect(prompt(undefined, { purpose: 'data' }).length).toBeLessThan(18_650 * 0.4);
    expect(prompt().length).toBeLessThan(18_650 * 0.6);
  });
});
