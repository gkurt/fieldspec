import { describe, expect, test } from 'bun:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createCel } from '#src/cel.ts';
import {
  checkSpec,
  createForm,
  createRegistry,
  define,
  fromJSONSchema,
  metaSchema,
  parse,
  prompt,
  toJSONSchema,
  validate,
  type Spec,
} from '#src/index.ts';
import { toZod } from '#src/zod.ts';

const stay = define({
  fields: {
    start: { type: 'date' },
    end: {
      type: 'date',
      checks: [{ assert: { $state: 'end', gte: { $state: 'start' } }, message: 'Ends before it starts' }],
    },
  },
});

describe('checks', () => {
  test('a failing assert is an issue at the field, saying its message', () => {
    expect(parse(stay, { start: '2026-03-08', end: '2026-03-01' }).issues).toEqual([
      { path: '/end', code: 'check', message: 'Ends before it starts' },
    ]);
    expect(parse(stay, { start: '2026-03-01', end: '2026-03-08' }).ok).toBe(true);
  });

  test('run only on a present, otherwise valid value of a visible field', () => {
    const spec = define({
      fields: {
        on: { type: 'boolean' },
        max: { type: 'int', min: 0 },
        n: {
          type: 'int',
          optional: true,
          min: 0,
          visible: { $state: 'on' },
          checks: [{ assert: { $state: 'n', lte: { $state: 'max' } }, message: 'Over the limit' }],
        },
      },
    });
    expect(parse(spec, { on: true, max: 3, n: 5 }).issues.map((i) => i.message)).toEqual(['Over the limit']);
    expect(parse(spec, { on: true, max: 3 }).ok).toBe(true);
    expect(parse(spec, { on: true, max: 3, n: -1 }).issues.map((i) => i.code)).toEqual(['min']);
    expect(parse(spec, { on: false, max: 3, n: 5 }).ok).toBe(true);
  });

  test('every failing check is reported, with its own code and a message that may be an expression', () => {
    const spec = define({
      fields: {
        max: { type: 'int' },
        name: {
          type: 'string',
          checks: [
            { assert: { $state: 'name', neq: 'admin' }, message: 'is reserved', code: 'reserved' },
            {
              assert: { $state: 'max', gte: 3 },
              message: { $template: 'needs a limit of 3, not ${max}' },
            },
          ],
        },
      },
    });
    expect(validate(spec, { max: 1, name: 'admin' })).toEqual([
      { path: '/name', code: 'reserved', message: 'is reserved' },
      { path: '/name', code: 'check', message: 'needs a limit of 3, not 1' },
    ]);
  });

  test('an object or a list may check its own value', () => {
    const spec = define({
      fields: {
        range: {
          type: 'object',
          fields: { lo: { type: 'int' }, hi: { type: 'int' } },
          checks: [{ assert: { $state: 'range/hi', gte: { $state: 'range/lo' } }, message: 'is upside down' }],
        },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            fields: { a: { type: 'int' }, b: { type: 'int' } },
            checks: [{ assert: { $state: 'b', gt: { $state: 'a' } }, message: 'b must exceed a' }],
          },
        },
      },
    });
    const issues = validate(spec, {
      range: { lo: 2, hi: 1 },
      rows: [
        { a: 1, b: 2 },
        { a: 3, b: 3 },
      ],
    });
    expect(issues).toEqual([
      { path: '/range', code: 'check', message: 'is upside down' },
      { path: '/rows/1', code: 'check', message: 'b must exceed a' },
    ]);
  });

  test("a definition's checks hold wherever it is used, beside the use's own", () => {
    const spec = define({
      defs: {
        Slug: {
          type: 'string',
          checks: [{ assert: { $state: 'slug', neq: 'new' }, message: 'is taken by the editor' }],
        },
      },
      fields: {
        slug: {
          use: 'Slug',
          checks: [{ assert: { $state: 'slug', neq: 'admin' }, message: 'is reserved' }],
        },
      },
    });
    expect(validate(spec, { slug: 'new' }).map((i) => i.message)).toEqual(['is taken by the editor']);
    expect(validate(spec, { slug: 'admin' }).map((i) => i.message)).toEqual(['is reserved']);
  });

  test('a form shows the issue on the field', () => {
    const form = createForm(stay, { values: { start: '2026-03-08', end: '2026-03-01' } });
    expect(form.field('/end')?.issues.map((i) => i.message)).toEqual(['Ends before it starts']);
    form.set('/end', new Date('2026-03-09'));
    expect(form.field('/end')?.issues).toEqual([]);
  });

  test('a default is not checked against values that are not there yet', () => {
    const spec = {
      fields: {
        max: { type: 'int', default: 5 },
        n: { type: 'int', default: 1, checks: [{ assert: { $state: 'n', lte: { $state: 'max' } }, message: 'Over' }] },
      },
    } as const satisfies Spec;
    expect(checkSpec(spec)).toEqual([]);
  });
});

describe('checks in CEL', () => {
  const registry = createRegistry({ languages: [createCel()] });

  test('assert with $cel, typed by the fields it reads', () => {
    const spec = registry.define({
      fields: {
        seats: { type: 'int' },
        admins: {
          type: 'int',
          checks: [
            {
              assert: { $cel: 'admins <= seats / 2', args: { admins: { $state: 'admins' }, seats: { $state: 'seats' } } },
              message: 'At most half the seats can be admins',
            },
          ],
        },
      },
    });
    expect(parse(spec, { seats: 10, admins: 5 }).ok).toBe(true);
    expect(parse(spec, { seats: 10, admins: 6 }).issues.map((i) => i.message)).toEqual(['At most half the seats can be admins']);
  });

  test('the checker type-checks it', () => {
    const faults = checkSpec(
      {
        fields: {
          seats: { type: 'int' },
          admins: {
            type: 'int',
            checks: [
              {
                assert: { $cel: 'admins <= seats / 2.0', args: { admins: { $state: 'admins' }, seats: { $state: 'seats' } } },
                message: 'x',
              },
            ],
          },
        },
      },
      { registry },
    );
    expect(faults.map((f) => f.path)).toEqual(['/fields/admins/checks/0/assert/$cel']);
  });

  test('one that fails to run is a condition issue', () => {
    const spec = registry.define({
      fields: {
        n: { type: 'int', checks: [{ assert: { $cel: '10 / n > 1', args: { n: { $state: 'n' } } }, message: 'x' }] },
      },
    });
    expect(validate(spec, { n: 0 })).toEqual([{ path: '/n', code: 'condition', message: 'EvaluationError: division by zero' }]);
  });
});

describe('checking checks', () => {
  test('each fault at its spot', () => {
    const faults = checkSpec({
      fields: {
        a: { type: 'int', checks: { assert: true } },
        b: {
          type: 'int',
          checks: [
            { assrt: { $state: 'b' }, message: 'x' },
            { assert: { $state: 'nope', gt: 1 } },
            { assert: false, message: 'x', code: 2 },
            'x',
          ],
        },
      },
    });
    expect(faults.map((f) => [f.path, f.severity])).toEqual([
      ['/fields/a/checks', 'error'],
      ['/fields/b/checks/0/assrt', 'error'],
      ['/fields/b/checks/0/assert', 'error'],
      ['/fields/b/checks/1/assert/$state', 'warning'],
      ['/fields/b/checks/1/message', 'error'],
      ['/fields/b/checks/2/assert', 'warning'],
      ['/fields/b/checks/2/code', 'error'],
      ['/fields/b/checks/3', 'error'],
    ]);
    expect(faults[1]!.message).toContain('Did you mean "assert"?');
  });

  test('the meta-schema and the prompt know them', () => {
    const valid = new Ajv2020({ strict: false }).compile(metaSchema());
    expect(valid(stay)).toBe(true);
    expect(valid({ fields: { a: { type: 'int', checks: [{ assert: true }] } } })).toBe(false);
    expect(prompt()).toContain('## Checks (`checks`)');
  });
});

describe('checks in interop', () => {
  test('Zod reports them', () => {
    const result = toZod(stay).safeParse({ start: new Date('2026-03-08'), end: new Date('2026-03-01') });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => [i.path, i.message])).toEqual([[['end'], 'Ends before it starts']]);
  });

  test('JSON Schema carries them as x-checks, and back', () => {
    const schema = toJSONSchema(stay);
    expect((schema.properties as Record<string, Record<string, unknown>>).end!['x-checks']).toEqual(stay.fields.end.checks);
    expect(fromJSONSchema(schema).fields.end).toMatchObject({ checks: stay.fields.end.checks });
  });
});
