/** The describe prompt: the mirror of the prompt that writes specs, and the message built from a spec. */
import { describe, expect, test } from 'bun:test';
import { design } from '#examples/design.ts';
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
  test('names every kind and preset the writer prompt teaches, with the same words', () => {
    for (const registry of [undefined, design]) {
      const [describer, writer] = [describePrompt(registry), prompt(registry)];
      const kinds = [...(registry ?? design).kinds.values()].filter((k) => registry !== undefined || k.name.toLowerCase() === k.name);
      for (const kind of kinds) {
        expect(describer).toContain(`\`${kind.name}\``);
        expect(describer).toContain(kind.description);
        expect(writer).toContain(kind.description);
      }
    }
    expect(describePrompt(design)).toContain('`Gradient`');
    expect(describePrompt()).not.toContain('`Gradient`');
    for (const preset of ['email', 'percent', 'port']) expect(describePrompt()).toContain(`\`${preset}\``);
  });

  test('asks for what a round trip must keep: keys, kinds, required, options, limits and defaults', () => {
    const text = describePrompt();
    for (const word of ['key', 'kind', 'required', 'optional', 'options', 'limits', 'default', 'order']) expect(text).toContain(word);
    expect(text).toContain('Reply with the description alone.');
    expect(prompt()).toContain('use exactly those');
  });

  test('takes a length and rules of the application', () => {
    expect(describePrompt()).not.toContain('characters');
    const text = describePrompt(undefined, { maxLength: 4000, customRules: ['Write in German.'] });
    expect(text).toContain('- Keep it under 4000 characters.');
    expect(text).toContain('- Write in German.');
    expect(text.trimEnd().endsWith('Reply with the description alone.')).toBe(true);
  });

  test('is the same text for the same registry', () => {
    expect(describePrompt()).toBe(describePrompt());
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
