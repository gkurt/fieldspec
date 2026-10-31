import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { design } from '#examples/design.ts';
import pkg from '#package.json' with { type: 'json' };
import { checkSpec, FORMAT_VERSION, fromJSONSchema, metaSchema, prompt, SCHEMA_URL, toJSONSchema, VERSION } from '#src/index.ts';

const ajv = new Ajv2020({ strict: false, allErrors: true });
const core = ajv.compile(metaSchema());
const closed = new Ajv2020({ strict: false, allErrors: true }).compile(metaSchema(design));

const valid = {
  $schema: SCHEMA_URL,
  title: 'Account',
  fields: {
    firstName: { type: 'string', label: 'First name', group: 'name' },
    lastName: { type: 'string', label: 'Last name', group: 'name' },
    email: { use: 'email', required: true },
    plan: {
      type: 'enum',
      options: [
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro' },
      ],
      default: 'free',
      render: 'segmented',
    },
    seats: {
      type: 'int',
      min: 1,
      max: 100,
      render: { type: 'slider', props: { format: 'number' } },
      visible: { $state: 'plan', eq: 'pro' },
    },
    discount: {
      use: 'percent',
      visible: [
        { $state: 'plan', eq: 'pro' },
        { $state: 'seats', gt: 5 },
      ],
    },
    label: {
      type: 'string',
      label: { $template: 'Hi ${/firstName}' },
      default: { $cond: { $state: 'plan', eq: 'pro' }, $then: 'Pro', $else: 'Free' },
    },
    menu: { use: 'Entry', label: 'Menu' },
    look: { type: 'object', fields: { size: { type: 'int' } }, render: { type: 'columns', props: { count: 2 } } },
  },
  defs: {
    Entry: {
      type: 'object',
      fields: {
        label: { type: 'string' },
        newTab: { type: 'boolean', visible: { $state: '../../allowNewTabs', eq: true } },
        children: { type: 'array', items: { use: 'Entry' } },
      },
    },
  },
  groups: { name: { label: 'Name', render: { type: 'collapsible', props: { collapsed: true } } } },
  layouts: { compact: { type: 'row', children: [{ field: 'email' }, { type: 'rest' }] } },
};

const errorsOf = (validate: ReturnType<typeof ajv.compile>, spec: unknown) =>
  validate(spec) === true ? [] : validate.errors!.map((e) => `${e.instancePath} ${e.message}`);

describe('the published schema', () => {
  test('is the file the package ships, current, and versioned like the package', () => {
    const file = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'schema', 'spec.json'), 'utf8'));
    expect(file).toEqual(JSON.parse(JSON.stringify(metaSchema())));
    expect(VERSION).toBe(pkg.version);
    expect(file.$id).toBe(`https://unpkg.com/fieldspec@${pkg.version}/schema/spec.json`);
    expect(pkg.files).toContain('schema');
  });

  test('accepts a spec using every part of the format', () => {
    expect(errorsOf(core, valid)).toEqual([]);
    expect(checkSpec(valid).filter((f) => f.severity === 'error')).toEqual([]);
  });

  test('is open to capitalized kinds and elements, so extended registries validate too', () => {
    const extended = { fields: { ramp: { type: 'Gradient', render: { type: 'GradientPicker', props: { angle: false } } } } };
    expect(errorsOf(core, extended)).toEqual([]);
  });

  test('rejects what is not the format', () => {
    for (const bad of [
      { fields: { a: { type: 'strng' } } },
      { fields: { a: { type: 'string', lable: 'A' } } },
      { fields: { a: { type: 'string', render: 'Sliderr'.toLowerCase() } } },
      { fields: { a: { type: 'int', render: { type: 'slider', props: { format: 'percentage' } } } } },
      { fields: {}, groups: { g: { render: { type: 'collapsible', props: { collapsed: 'yes' } } } } },
      { fields: {}, defs: { lower: { type: 'string' } } },
      { fields: { a: { use: 'percent', type: 'number' } } },
      { fields: { a: { type: 'string', visible: { $state: '/b', gt: { $nope: 1 }, extra: true } } } },
      { fieldz: {} },
    ])
      expect(errorsOf(core, bad).length).toBeGreaterThan(0);
  });

  test("a registry's own schema is closed to names it does not have", () => {
    expect(errorsOf(closed, { fields: { ramp: { type: 'Gradient', render: 'GradientPicker' }, tint: { use: 'Swatch' } } })).toEqual([]);
    expect(errorsOf(closed, { fields: { x: { type: 'Mystery' } } }).length).toBeGreaterThan(0);
    expect((metaSchema(design) as { $id?: string }).$id).toBeUndefined();
  });

  test('the checker notices a spec written for another version', () => {
    const old = { $schema: 'https://unpkg.com/fieldspec@0.0.9/schema/spec.json', fields: {} };
    expect(checkSpec(old)).toEqual([
      {
        path: '/$schema',
        message: `the spec is written for fieldspec 0.0.9; this is ${VERSION}. Check it against ${SCHEMA_URL} and update $schema.`,
        severity: 'warning',
      },
    ]);
  });

  test('the prompt tells agents to name it', () => {
    expect(prompt()).toContain(`"$schema": "${SCHEMA_URL}", "fieldspec": ${FORMAT_VERSION}`);
  });

  test('a spec may state the version of the format it is written for', () => {
    const stated = { ...valid, fieldspec: FORMAT_VERSION };
    expect(checkSpec(stated)).toEqual([]);
    expect(errorsOf(core, stated)).toEqual([]);
    expect(errorsOf(core, { ...valid, fieldspec: FORMAT_VERSION + 1 }).length).toBeGreaterThan(0);
    const back = fromJSONSchema(toJSONSchema(stated));
    expect(back.fieldspec).toBe(FORMAT_VERSION);
  });

  test('the checker rejects a format version it does not read', () => {
    expect(checkSpec({ fieldspec: FORMAT_VERSION + 1, fields: {} })).toEqual([
      {
        path: '/fieldspec',
        message: `the spec is written for version ${FORMAT_VERSION + 1} of the spec format; this fieldspec reads version ${FORMAT_VERSION}`,
        severity: 'error',
      },
    ]);
    for (const bad of [0, 1.5, '1']) expect(checkSpec({ fieldspec: bad, fields: {} }).map((f) => f.path)).toEqual(['/fieldspec']);
  });
});
