/** The describe prompt: the mirror of the prompt that writes specs, and the message built from a spec. */
import { describe, expect, test } from 'bun:test';
import { describeMessage, describePrompt, prompt, withDescription, type Spec } from '#src/index.ts';

const spec: Spec = {
  $schema: 'https://unpkg.com/fieldspec@0.3.0/schema/spec.json',
  fieldspec: 1,
  title: 'Team',
  fields: {
    name: { type: 'string', required: true },
    plan: { type: 'enum', options: ['free', 'pro'], default: 'free' },
  },
};

describe('describePrompt', () => {
  test('asks for a sentence or two, as a person would ask for the spec, and not for a list of its fields', () => {
    const text = describePrompt();
    expect(text).toContain('what a person would have typed to ask for it');
    expect(text).toContain('One or two sentences, under 300 characters.');
    expect(text).toContain('Do not go through the fields one by one.');
    expect(text).toContain('Never list kinds, which fields are required, options, limits or defaults.');
    expect(text.endsWith('- Reply with the description alone.')).toBe(true);
    expect(text.length).toBeLessThan(1000);
  });

  test('names no kind or preset, so the description cannot turn into a list of them', () => {
    const text = describePrompt();
    for (const name of ['`string`', '`enum`', '`variant`', '`email`', '`percent`']) expect(text).not.toContain(name);
  });

  test('takes a length and rules of the application', () => {
    const text = describePrompt({ maxLength: 500, customRules: ['Write in German.'] });
    expect(text).toContain('under 500 characters');
    expect(text).toContain('- Write in German.\n- Reply with the description alone.');
  });

  test('leaves the prompt that writes specs as it was before there was a describer', () => {
    expect(prompt()).not.toContain('use exactly those');
  });
});

describe('describeMessage', () => {
  test("is the spec as JSON, without the format's own keys and without meta", () => {
    const message = describeMessage(withDescription({ ...spec, meta: { owner: 'billing' } }, 'A team.'));
    expect(message.startsWith('The spec:\n')).toBe(true);
    const sent = JSON.parse(message.slice('The spec:\n'.length));
    expect(sent).toEqual({ title: 'Team', fields: spec.fields });
    for (const left of ['$schema', 'fieldspec', 'meta', 'A team.', 'billing']) expect(message).not.toContain(left);
  });

  test('is the same for the same spec, whatever its description or the release it names', () => {
    const { $schema: _, fieldspec: __, ...bare } = spec;
    expect(describeMessage(spec)).toBe(describeMessage(structuredClone(spec)));
    expect(describeMessage(spec)).toBe(describeMessage(bare));
    expect(describeMessage(withDescription(spec, 'A team.'))).toBe(describeMessage(withDescription(spec, 'Another text.')));
  });

  test('keeps the order of the fields, which the description follows', () => {
    const { name, plan } = spec.fields;
    const message = describeMessage({ fields: { plan: plan!, name: name! } });
    expect(message.indexOf('"plan"')).toBeLessThan(message.indexOf('"name"'));
    expect(message).not.toBe(describeMessage({ fields: { name: name!, plan: plan! } }));
  });
});
