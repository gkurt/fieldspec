import { describe, expect, test } from 'bun:test';
import { Environment } from '@marcbachmann/cel-js';
import { createCel } from '#src/cel.ts';
import { checkSpec, commonFields, createForm, createRegistry, metaSchema, parse, prompt, validate, type Spec } from '#src/index.ts';

const cel = createCel();
const registry = createRegistry({ languages: [cel] });

const booking = registry.define({
  fields: {
    start: { type: 'date' },
    end: { type: 'date', default: { $cel: 'start + duration("168h")', args: { start: { $state: 'start' } } } },
    nights: {
      type: 'int',
      default: { $cel: '(end - start).getHours() / 24', args: { start: { $state: 'start' }, end: { $state: 'end' } } },
    },
    label: { type: 'string', default: { $cel: '"Stay of " + string(nights) + " nights"', args: { nights: { $state: 'nights' } } } },
    late: { type: 'boolean', visible: { $cel: 'end.getHours("UTC") >= 20', args: { end: { $state: 'end' } } } },
  },
});

describe('$cel', () => {
  test('defaults and conditions evaluate over their args', () => {
    const form = createForm(booking, { values: { start: '2026-03-01T00:00:00.000Z' } });
    expect(form.values.end).toEqual(new Date('2026-03-08T00:00:00.000Z'));
    expect(form.values.nights).toBe(7);
    expect(form.values.label).toBe('Stay of 7 nights');
    expect(form.field('/late')?.visible).toBe(false);
    form.set('/end', new Date('2026-03-08T21:00:00.000Z'));
    expect(form.field('/late')?.visible).toBe(true);
  });

  test('a condition compares what the expression gives', () => {
    const spec = registry.define({
      fields: {
        tags: { type: 'set', items: { type: 'string' } },
        note: { type: 'string', required: { $cel: 'size(tags)', args: { tags: { $state: 'tags' } }, gte: 2 } },
      },
    });
    expect(parse(spec, { tags: ['a'] }).ok).toBe(true);
    expect(parse(spec, { tags: ['a', 'b'] }).issues.map((i) => i.path)).toEqual(['/note']);
  });

  test('values arrive as CEL values, and whole results come back as numbers', () => {
    expect(cel.run('m["a"] + n', { m: new Map([['a', 1n]]), n: 2n })).toBe(3);
    expect(cel.run('n * 2', { n: 2n ** 60n })).toBe(2n ** 61n);
    expect(cel.run('"x" in s', { s: new Set(['x']) })).toBe(true);
    expect(cel.run('x + 0.5', { x: 2 })).toBe(2.5);
    expect(cel.run('u.startsWith("https:")', { u: new URL('https://example.com') })).toBe(true);
    expect(cel.run('gone == null', { gone: undefined })).toBe(true);
    expect(cel.run('{"a": [1, 2], "b": "x"}', {})).toEqual({ a: [1, 2], b: 'x' });
  });

  test('an expression that fails is a condition issue, and a form treats it as holding', () => {
    const spec = registry.define({
      fields: { a: { type: 'number' }, b: { type: 'string', visible: { $cel: 'a + 1', args: { a: { $state: 'a' } } } } },
    });
    expect(validate(spec, { a: 1, b: '' })).toEqual([
      { path: '/b', code: 'condition', message: 'EvaluationError: no such overload: dyn<double> + int' },
    ]);
    expect(createForm(spec).field('/b')?.visible).toBe(true);
  });

  test('an environment brings functions of its own', () => {
    const environment = new Environment().registerFunction('slug(string): string', (s: string) => s.toLowerCase().replaceAll(' ', '-'));
    const custom = createCel({ environment });
    expect(custom.check('slug(title)', ['title'])).toBeUndefined();
    expect(custom.run('slug(title)', { title: 'Hello World' })).toBe('hello-world');
    expect(cel.check('slug(title)', ['title'])).toBe("TypeError: found no matching overload for 'slug(dyn)'");
  });

  test('commonFields keeps a condition only where what its args read is shared', () => {
    const visible = { $cel: 'on', args: { on: { $state: 'on' } } };
    const a = registry.define({ fields: { on: { type: 'boolean' }, x: { type: 'string', visible } } });
    const b = registry.define({ fields: { x: { type: 'string', visible } } });
    expect(commonFields([a, a]).spec.fields.x).toEqual({ type: 'string', visible });
    expect(commonFields([a, b]).spec.fields.x).toEqual({ type: 'string' });
  });
});

describe('checking $cel', () => {
  const faults = (spec: Spec, r = registry) => checkSpec(spec, { registry: r }).map((f) => `${f.path}: ${f.message}`);

  test('syntax errors, unknown variables and type errors the expression shows on its face', () => {
    expect(
      faults({
        fields: {
          a: { type: 'string' },
          b: { type: 'string', visible: { $cel: 'a +', args: { a: { $state: 'a' } } } },
          c: { type: 'string', visible: { $cel: 'b == "x"', args: { a: { $state: 'a' } } } },
          d: { type: 'string', label: { $cel: '"n: " + 1' } },
        },
      }),
    ).toEqual([
      '/fields/b/visible/$cel: ParseError: Unexpected token: EOF',
      '/fields/c/visible/$cel: TypeError: Unknown variable: b',
      '/fields/d/label/$cel: TypeError: no such overload: string + int',
    ]);
  });

  test('a registry with no engine for $cel faults where it is used', () => {
    expect(faults({ fields: { a: { type: 'string', visible: { $cel: 'true' } } } }, createRegistry())).toEqual([
      '/fields/a/visible/$cel: needs an engine for $cel: give the registry one (fieldspec/cel runs $cel, fieldspec/js runs $js)',
    ]);
  });

  test('agents hear of $cel only from a registry that runs it', () => {
    expect(prompt(registry)).toContain('"$cel"');
    expect(prompt(registry)).not.toContain('"$js"');
    expect(prompt()).not.toContain('$cel');
    expect(JSON.stringify(metaSchema(registry))).toContain('"$cel"');
    expect(JSON.stringify(metaSchema(registry))).not.toContain('"$js"');
  });
});
