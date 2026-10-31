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
      fields: { a: { type: 'int' }, b: { type: 'string', visible: { $cel: '10 / a > 1', args: { a: { $state: 'a' } } } } },
    });
    expect(validate(spec, { a: 0, b: '' })).toEqual([{ path: '/b', code: 'condition', message: 'EvaluationError: division by zero' }]);
    expect(createForm(spec).field('/b')?.visible).toBe(true);
  });

  test('an environment brings functions of its own', () => {
    const environment = new Environment().registerFunction('slug(string): string', (s: string) => s.toLowerCase().replaceAll(' ', '-'));
    const custom = createCel({ environment });
    expect(custom.check('slug(title)', { title: { type: 'string' } })).toBeUndefined();
    expect(custom.run('slug(title)', { title: 'Hello World' })).toBe('hello-world');
    expect(cel.check('slug(title)', { title: undefined })).toBe("TypeError: found no matching overload for 'slug(dyn)'");
  });

  test('commonFields keeps a condition only where what its args read is shared', () => {
    const visible = { $cel: 'on', args: { on: { $state: 'on' } } };
    const a = registry.define({ fields: { on: { type: 'boolean' }, x: { type: 'string', visible } } });
    const b = registry.define({ fields: { x: { type: 'string', visible } } });
    expect(commonFields([a, a]).spec.fields.x).toEqual({ type: 'string', visible });
    expect(commonFields([a, b]).spec.fields.x).toEqual({ type: 'string' });
  });
});

describe('typed args', () => {
  const order = registry.define({
    defs: {
      Line: {
        type: 'object',
        fields: {
          qty: { type: 'int', default: 1 },
          total: { type: 'int', default: { $cel: 'qty * 2', args: { qty: { $state: 'qty' } } } },
        },
      },
    },
    fields: {
      count: { type: 'int', default: 3 },
      price: { type: 'number', default: 2.5 },
      scores: { type: 'array', items: { type: 'int' }, default: [1, 2] },
      stock: { type: 'record', values: { type: 'int' }, default: { a: 4 } },
      box: { type: 'object', fields: { n: { type: 'int', default: 5 } } },
      discount: { type: 'number', optional: true },
      line: { use: 'Line' },
      summary: {
        type: 'string',
        default: {
          $cel: 'string(count + 1) + " " + string(int(price) * 2) + " " + string(scores.map(s, s * 2)[1]) + " " + string(stock["a"] + 1) + " " + string(box.n + 1) + " " + string(discount == null)',
          args: {
            count: { $state: 'count' },
            price: { $state: 'price' },
            scores: { $state: 'scores' },
            stock: { $state: 'stock' },
            box: { $state: 'box' },
            discount: { $state: 'discount' },
          },
        },
      },
    },
  });

  test('an int field is a CEL int, wherever its values sit', () => {
    const values = createForm(order).values;
    expect(values.summary).toBe('4 4 4 5 6 true');
    expect(values.line.total).toBe(2);
    expect(checkSpec(order)).toEqual([]);
  });

  test('the checker catches arithmetic across double and int', () => {
    const faults = checkSpec(
      {
        fields: {
          price: { type: 'number' },
          count: { type: 'int' },
          tags: { type: 'set', items: { type: 'string' } },
          discount: { type: 'number', optional: true },
          a: { type: 'number', default: { $cel: 'price + 1', args: { price: { $state: 'price' } } } },
          b: { type: 'number', default: { $cel: 'count + 1.5', args: { count: { $state: 'count' } } } },
          c: { type: 'boolean', default: { $cel: 'tags.exists(t, t > 1)', args: { tags: { $state: 'tags' } } } },
          d: { type: 'number', default: { $cel: 'discount + 1', args: { discount: { $state: 'discount' } } } },
        },
      },
      { registry },
    ).map((f) => `${f.path}: ${f.message}`);
    expect(faults).toEqual([
      '/fields/a/default/$cel: TypeError: no such overload: double + int',
      '/fields/b/default/$cel: TypeError: no such overload: int + double',
      '/fields/c/default/$cel: TypeError: no such overload: string > int',
    ]);
  });

  test('an untyped whole number works as an int or a double', () => {
    const plus = (source: string) => ({ type: 'number', default: { $cel: source, args: { n: { $state: 'n' } } } }) as const;
    const spec = registry.define({ fields: { n: { type: 'number', optional: true }, a: plus('n + 1'), b: plus('n + 0.5') } });
    expect(parse(spec, { n: 2 }).value).toEqual({ n: 2, a: 3, b: 2.5 });
    // A migration reads untyped JSON too.
    const moved = registry.define({
      version: 2,
      fields: { ms: { type: 'int' } },
      migrations: { '2': [{ op: 'add', path: '/ms', value: { $cel: 's * 1000', args: { s: { $state: '/s' } } } }] },
    });
    expect(parse(moved, { $version: 1, s: 5 }).value).toMatchObject({ ms: 5000 });
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
