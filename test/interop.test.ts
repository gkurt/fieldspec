import { describe, expect, test } from 'bun:test';
import * as z from 'zod/v4';
import { design, type GradientValue } from '#examples/design.ts';
import {
  checkSpec,
  createForm,
  createRegistry,
  layout,
  walk,
  define,
  fromFlat,
  fromJSONSchema,
  metaSchema,
  parse,
  prompt,
  toFlat,
  toJSONSchema,
  toJsonRender,
  type Infer,
  type RenderNode,
  type StandardSchemaV1,
} from '#src/index.ts';
import { fromZod, toZod } from '#src/zod.ts';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>() => {};

const spec = define({
  title: 'Service',
  fields: {
    name: { type: 'string', label: 'Name', minLength: 1, aliases: ['title'] },
    port: { type: 'int', min: 1, max: 65535, default: 8080, unit: '', hint: 'Where it listens' },
    mode: {
      type: 'enum',
      options: [
        { value: 'dev', label: 'Development' },
        { value: 'prod', label: 'Production' },
      ],
      default: 'dev',
    },
    replicas: { type: 'int', default: 1, visible: { $state: 'mode', eq: 'prod' } },
    started: { type: 'date', time: true, optional: true },
    budget: { type: 'bigint', min: '0', optional: true },
    hook: { type: 'url', protocols: ['https:'], optional: true },
    env: { type: 'record', values: { type: 'string' } },
    auth: {
      type: 'variant',
      key: 'kind',
      variants: { none: { fields: {} }, basic: { label: 'Basic', fields: { user: { type: 'string' } } } },
    },
  },
  groups: { net: { label: 'Network' } },
  layouts: { compact: { type: 'row', children: [{ field: 'name' }, { type: 'rest' }] } },
});

describe('JSON Schema', () => {
  test('out: annotations, x- keywords, required by io', () => {
    // oxlint-disable-next-line typescript/no-explicit-any -- reads the generated JSON Schema by path, several levels deep
    const schema = toJSONSchema(spec) as any;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.properties.port).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 65535,
      default: 8080,
      'x-hint': 'Where it listens',
    });
    expect(schema.properties.mode.oneOf).toEqual([
      { const: 'dev', title: 'Development' },
      { const: 'prod', title: 'Production' },
    ]);
    expect(schema.properties.replicas['x-visible']).toEqual({ $state: 'mode', eq: 'prod' });
    expect(schema.properties.started).toMatchObject({ type: 'string', format: 'date-time', 'x-type': 'date' });
    expect(schema.properties.auth['x-key']).toBe('kind');
    expect(schema.required).toContain('port');
    expect(toJSONSchema(spec, { io: 'input' }).required ?? []).not.toContain('port');
  });

  test('round trip keeps the spec', () => {
    const back = fromJSONSchema(toJSONSchema(spec));
    expect(back).toEqual(JSON.parse(JSON.stringify(spec)));
  });

  test('in: plain schemas from elsewhere', () => {
    const back = fromJSONSchema({
      type: 'object',
      properties: {
        a: { type: 'string', format: 'date' },
        b: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
        c: { $ref: '#/$defs/C' },
        d: {
          oneOf: [
            { type: 'object', properties: { t: { const: 'x' }, v: { type: 'number' } } },
            { type: 'object', properties: { t: { const: 'y' } } },
          ],
        },
      },
      required: ['a'],
      $defs: { C: { enum: ['p', 'q'] } },
    });
    expect(back.fields).toEqual({
      a: { type: 'date' },
      b: { type: 'int', min: 0, optional: true },
      c: { use: 'C', optional: true },
      d: {
        type: 'variant',
        key: 't',
        variants: { x: { fields: { v: { type: 'number', optional: true } } }, y: { fields: {} } },
        optional: true,
      },
    } as never);
    expect(back.defs).toEqual({ C: { type: 'enum', options: ['p', 'q'] } });
  });

  test('recursive schemas stay recursive, both ways', () => {
    const tree = define({
      defs: { Node: { type: 'object', fields: { name: { type: 'string' }, children: { type: 'array', items: { use: 'Node' } } } } },
      fields: { root: { use: 'Node', label: 'Root' } },
    });
    // oxlint-disable-next-line typescript/no-explicit-any -- reads the generated JSON Schema by path, several levels deep
    const schema = toJSONSchema(tree) as any;
    expect(schema.properties.root).toEqual({ $ref: '#/$defs/Node', title: 'Root', 'x-use': 'Node', 'x-own': { label: 'Root' } });
    expect(schema.$defs.Node.properties.children.items).toEqual({ $ref: '#/$defs/Node', 'x-use': 'Node' });
    expect(fromJSONSchema(schema)).toEqual(JSON.parse(JSON.stringify(tree)));
  });

  test("a field's own constraints hold beside its definition's $ref, or write it out when they change one", () => {
    const spec = define({
      defs: { Slug: { type: 'string', pattern: '[a-z]+', maxLength: 40 } },
      fields: { short: { use: 'Slug', minLength: 3 }, long: { use: 'Slug', maxLength: 60 }, plain: { use: 'Slug', label: 'Plain' } },
    });
    // oxlint-disable-next-line typescript/no-explicit-any -- reads the generated JSON Schema by path
    const schema = toJSONSchema(spec) as any;
    expect(schema.properties.short).toEqual({ $ref: '#/$defs/Slug', minLength: 3, 'x-use': 'Slug', 'x-own': { minLength: 3 } });
    expect(schema.properties.long).toMatchObject({ type: 'string', maxLength: 60, pattern: '^(?:[a-z]+)$', 'x-use': 'Slug' });
    expect(schema.properties.long.$ref).toBeUndefined();
    expect(schema.properties.plain).toEqual({ $ref: '#/$defs/Slug', title: 'Plain', 'x-use': 'Slug', 'x-own': { label: 'Plain' } });
    expect(fromJSONSchema(schema)).toEqual(JSON.parse(JSON.stringify(spec)));
    // Written out, a field still brings its definition back when nothing else refers to it.
    const alone = define({ defs: { Slug: { type: 'string', maxLength: 40 } }, fields: { long: { use: 'Slug', maxLength: 60 } } });
    expect(fromJSONSchema(toJSONSchema(alone))).toEqual(JSON.parse(JSON.stringify(alone)));
  });

  test('a recursive Zod schema comes in as a definition', () => {
    type Category = { name: string; sub: Category[] };
    const Category: z.ZodType<Category> = z.object({
      name: z.string(),
      get sub() {
        return z.array(Category);
      },
    });
    const s = fromZod(z.object({ top: Category }));
    const def = Object.keys(s.defs ?? {})[0]!;
    expect(s.fields.top).toEqual({ use: def } as never);
    expect(checkSpec(s).filter((f) => f.severity === 'error')).toEqual([]);
    expect(parse(s, { top: { name: 'a', sub: [{ name: 'b', sub: [] }] } }).ok).toBe(true);
  });
});

describe('Standard Schema', () => {
  test('a defined spec is a Standard Schema with JSON Schema', async () => {
    const std = (spec as unknown as StandardSchemaV1<unknown, Infer<typeof spec>>)['~standard'];
    expect(std.vendor).toBe('fieldspec');
    expect(await std.validate({ name: 'api', port: 99999 })).toEqual({ issues: [{ message: 'must be at most 65535', path: ['port'] }] });
    const ok = await std.validate({ name: 'api' });
    expect('value' in ok && ok.value.port).toBe(8080);
    expect(std.jsonSchema!.input({ target: 'draft-2020-12' }).type).toBe('object');
    expect(Object.keys(JSON.parse(JSON.stringify(spec)))).not.toContain('~standard');
  });
});

describe('Zod', () => {
  test('toZod validates like the spec, conditions included', () => {
    const schema = toZod(spec);
    const values = parse(spec, { name: 'api' }).value!;
    expect(schema.safeParse(values).success).toBe(true);
    const bad = schema.safeParse({ ...values, mode: 'prod', replicas: 1.5 });
    expect(bad.success).toBe(false);
    assertType<Equal<z.infer<typeof schema>, Infer<typeof spec>>>();
  });

  test('fromZod keeps shape and meta', () => {
    const zs = z.object({
      host: z.string().min(1).describe('Where to connect'),
      port: z.number().int().min(1).default(5432),
      mode: z.enum(['a', 'b']),
      tags: z.array(z.string()).optional(),
    });
    const s = fromZod(zs);
    expect(s.fields).toEqual({
      host: { type: 'string', minLength: 1, description: 'Where to connect' },
      port: { type: 'int', min: 1, default: 5432 },
      mode: { type: 'enum', options: ['a', 'b'] },
      tags: { type: 'array', items: { type: 'string' }, optional: true },
    } as never);
    expect(checkSpec(s)).toEqual([]);
  });
});

describe('json-render', () => {
  test('flat and nested fragments convert both ways', () => {
    const nested: RenderNode = {
      type: 'stack',
      children: [
        { type: 'label', props: { text: 'Name' } },
        {
          type: 'row',
          children: [
            { type: 'control', props: { field: 'first' } },
            { type: 'control', props: { field: 'last' } },
          ],
          visible: { $state: '/x' },
        },
      ],
    };
    const flat = toFlat(nested);
    expect(flat.elements[flat.root]!.children.length).toBe(2);
    expect(fromFlat(flat)).toEqual(nested);
  });

  test('a form becomes a bound json-render spec', () => {
    const out = toJsonRender(spec);
    const els = Object.values(out.elements);
    const port = els.find((e) => (e.props.value as { $bindState?: string } | undefined)?.$bindState === '/form/port')!;
    expect(port).toMatchObject({ type: 'Input', props: { label: 'Port', type: 'number' } });
    const replicas = els.find((e) => (e.props.value as { $bindState?: string } | undefined)?.$bindState === '/form/replicas')!;
    // json-render's state holds the enum by its label, so the condition compares that.
    expect(replicas.visible).toEqual({ $state: '/form/mode', eq: 'Production' });
    expect((out.state?.form as { port?: unknown } | undefined)?.port).toBe(8080);
  });
});

describe('agents', () => {
  test('the prompt covers kinds, elements and functions', () => {
    const text = prompt(design, {
      functions: { palette: { description: 'Brand colours', returns: 'string[]' } },
      customRules: ['Prefer sliders.'],
    });
    for (const needle of [
      '### Gradient',
      '`GradientPicker`',
      '`row`',
      '`percent`',
      '`Swatch`',
      '`palette()` → string[]',
      'Prefer sliders.',
    ])
      expect(text).toContain(needle);
  });

  test('the meta-schema names every kind, element and the use form', () => {
    // oxlint-disable-next-line typescript/no-explicit-any -- reads the generated meta-schema by path, several levels deep
    const schema = metaSchema(design) as any;
    const kinds = schema.$defs.field.anyOf.map((b: { properties: { type?: { const: unknown } } }) => b.properties.type?.const);
    expect(kinds).toContain('Gradient');
    expect(schema.$defs.field.anyOf.some((b: { required?: string[] }) => b.required?.includes('use'))).toBe(true);
    const slider = schema.$defs.render.anyOf[3].anyOf.find(
      (b: { properties: { type: { const: unknown } } }) => b.properties.type.const === 'slider',
    );
    expect(Object.keys(slider.properties.props.properties)).toContain('format');
  });
});

describe('extension kinds', () => {
  const panel = design.define({
    fields: {
      padding: { type: 'number', min: 0, max: 128, step: 2, unit: 'px', default: 48, render: 'slider' },
      ground: { use: 'color', default: '#1c1c1e' },
      accent: { use: 'Swatch' },
      ramp: { type: 'Gradient', default: { from: '#000000', to: '#ffffff', angle: 90, shape: 'linear' } },
    },
  });

  test('they validate, default and check like core kinds', () => {
    expect(checkSpec(panel)).toEqual([]);
    expect(parse(panel, {}).value).toMatchObject({ padding: 48, ground: '#1c1c1e', accent: '#3b82f6', ramp: { angle: 90 } });
    expect(parse(panel, { ground: 'red' }).issues[0]).toMatchObject({ path: '/ground', code: 'format' });
  });

  test('they infer their value types, presets included', () => {
    const s = design.define({
      fields: { ramp: { type: 'Gradient' }, tint: { use: 'Swatch', optional: true }, opacity: { use: 'percent' } },
    });
    assertType<Equal<Infer<typeof s>, { ramp: GradientValue; opacity: number; tint?: string }>>();
    expect(createForm(s).values.ramp.shape).toBe('linear');
  });

  test("the kind's own control is the default, and controls must fit the kind", () => {
    const tree = layout(panel);
    expect([...walk(tree)].find((n) => n.field === 'ramp')?.control?.type).toBe('GradientPicker');
    const messages = checkSpec({ fields: { ramp: { type: 'Gradient', render: 'slider' } } }, { registry: design }).map(
      (f) => `${f.path}: ${f.message}`,
    );
    expect(messages).toContain('/fields/ramp/render: slider edits number, int fields; this is a Gradient field');
  });

  test('registry rules apply', () => {
    const messages = checkSpec({ fields: { Bad: { use: 'Swatch', default: 'red' } } }, { registry: design }).map(
      (f) => `${f.path}: ${f.message}`,
    );
    expect(messages).toContain('/fields/Bad/default: must be a valid color');
    expect(messages).toContain('/fields/Bad: must start with a lowercase letter and hold only letters and digits');
  });

  test('names the application adds must be capitalized', () => {
    expect(() => createRegistry({ presets: { money: { type: 'bigint' } } })).toThrow(
      'A preset "money" must start with an uppercase letter (e.g. "Money")',
    );
  });
});
