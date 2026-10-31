import { describe, expect, test } from 'bun:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createCel } from '#src/cel.ts';
import { checkSpec, createForm, createRegistry, define, fromJSONSchema, metaSchema, parse, prompt, toJSONSchema } from '#src/index.ts';

const registry = createRegistry({ languages: [createCel()] });

const order = registry.define({
  fields: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        fields: {
          price: { type: 'number' },
          qty: { type: 'int', default: 1 },
          total: { type: 'number', value: { $cel: 'price * double(qty)', args: { price: { $state: 'price' }, qty: { $state: 'qty' } } } },
        },
      },
    },
    totals: { type: 'array', items: { type: 'number' }, value: { $cel: 'l.map(x, x.total)', args: { l: { $state: 'lines' } } } },
    count: { type: 'int', max: 2, value: { $cel: 'size(t)', args: { t: { $state: 'totals' } } } },
    title: { type: 'string', value: { $template: 'An order of ${count}' } },
  },
});

describe('value', () => {
  test('decides the value: a given one is replaced, and values read values', () => {
    const result = parse(order, { lines: [{ price: 2, qty: 3, total: 999 }, { price: 50 }], count: 7, title: 'Mine' });
    expect(result.value).toEqual({
      lines: [
        { price: 2, qty: 3, total: 6 },
        { price: 50, qty: 1, total: 50 },
      ],
      totals: [6, 50],
      count: 2,
      title: 'An order of 2',
    });
  });

  test('is validated like any value', () => {
    const result = parse(order, { lines: [{ price: 1 }, { price: 1 }, { price: 1 }] });
    expect(result.issues).toEqual([{ path: '/count', code: 'max', message: 'must be at most 2', params: { max: 2 } }]);
  });

  test('a literal is a constant', () => {
    const spec = define({ fields: { kind: { type: 'string', value: 'service' } } });
    expect(parse(spec, { kind: 'job' }).value).toEqual({ kind: 'service' });
  });

  test('in a form, follows every edit and cannot be edited', () => {
    const form = createForm(order, { values: { lines: [{ price: 2 }] } });
    expect(form.field('/lines/0/total')).toMatchObject({ value: 2, readOnly: true });
    expect(form.field('/lines/0/price')?.readOnly).toBe(false);
    form.set('/lines/0/qty', 4);
    expect(form.get('/lines/0/total')).toBe(8);
    form.addItem('/lines');
    expect(form.values).toMatchObject({ totals: [8, 0], count: 2, title: 'An order of 2' });
    form.set('/count', 9);
    expect(form.get('/count')).toBe(2);
  });

  test('the checker checks it, and says when it leaves a default unused', () => {
    const spec = {
      fields: {
        a: { type: 'int', value: 'x' },
        b: { type: 'int', default: 1, value: { $state: 'a' } },
        c: { type: 'int', value: { $state: 'nope' } },
      },
    };
    expect(checkSpec(spec).map((f) => [f.path, f.severity])).toEqual([
      ['/fields/a/value', 'error'],
      ['/fields/b/default', 'warning'],
      ['/fields/c/value/$state', 'warning'],
    ]);
    expect(checkSpec(order)).toEqual([]);
  });

  test('JSON Schema marks it read-only and keeps the expression', () => {
    const schema = toJSONSchema(order);
    expect((schema.properties as Record<string, unknown>).count).toMatchObject({ readOnly: true, 'x-value': order.fields.count.value });
    // A URL has no zero, so parse requires one, unless a `value` gives it.
    const urls = define({ fields: { given: { type: 'url', value: 'https://example.com' }, asked: { type: 'url' } } });
    expect(toJSONSchema(urls, { io: 'input' }).required).toEqual(['asked']);
    expect(fromJSONSchema(schema).fields.count).toEqual(order.fields.count);
  });

  test('the meta-schema and the prompt know it', () => {
    const ajv = new Ajv2020({ strict: false });
    expect(ajv.validate(metaSchema(registry), order)).toBe(true);
    expect(prompt(registry)).toContain('`value`');
  });
});

describe('defaults inside records and maps', () => {
  test('fill the absent fields of each value', () => {
    const item = { type: 'object', fields: { a: { type: 'int', default: 3 } } } as const;
    const spec = define({ fields: { r: { type: 'record', values: item }, m: { type: 'map', keys: { type: 'string' }, values: item } } });
    const result = parse(spec, { r: { x: {} }, m: [['k', {}]] });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ r: { x: { a: 3 } }, m: new Map([['k', { a: 3 }]]) });
  });
});

describe('defaults and values that would never end', () => {
  test('cannot read what holds them: that holds the field too', () => {
    const spec = define({
      fields: {
        o: { type: 'object', fields: { a: { type: 'int', default: 2 }, copy: { type: 'json', optional: true, value: { $state: '' } } } },
      },
    });
    expect(parse(spec, {}).value).toEqual({ o: { a: 2 } });
  });

  test('an expression default does not end a definition that holds itself', () => {
    const spec = {
      fields: { t: { use: 'Node' } },
      defs: { Node: { type: 'object', fields: { copy: { use: 'Node', default: { $state: '' } } } } },
    };
    expect(checkSpec(spec).map((f) => f.path)).toEqual(['/defs/Node']);
    const literal = { ...spec, defs: { Node: { type: 'object', fields: { copy: { use: 'Node', default: {} } } } } };
    expect(checkSpec(literal).filter((f) => f.severity === 'error')).toEqual([]);
  });
});
