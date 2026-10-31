import { describe, expect, test } from 'bun:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createCel } from '#src/cel.ts';
import {
  checkSpec,
  createForm,
  createRegistry,
  define,
  encode,
  fromJSONSchema,
  metaSchema,
  migrate,
  parse,
  prompt,
  toJSONSchema,
  versionOf,
  type Infer,
} from '#src/index.ts';

const registry = createRegistry({ languages: [createCel()] });

// Version 1 had `host`, `timeout` in seconds, `mode: "fast" | "slow"`, backends with an `address`, and `legacy`.
const settings = registry.define({
  version: 3,
  fields: {
    server: { type: 'object', fields: { host: { type: 'string' }, port: { type: 'int', default: 80 } } },
    timeoutMs: { type: 'int', min: 100, default: 1000 },
    mode: { type: 'enum', options: ['quick', 'thorough'] },
    backends: {
      type: 'array',
      items: { type: 'object', fields: { url: { type: 'string' }, weight: { type: 'int' } } },
    },
  },
  migrations: {
    '2': [
      { op: 'move', from: '/host', path: '/server/host' },
      { op: 'move', from: '/backends/*/address', path: '/backends/*/url' },
    ],
    '3': [
      { op: 'move', from: '/timeout', path: '/timeoutMs' },
      { op: 'replace', path: '/timeoutMs', value: { $cel: 'timeoutMs * 1000.0', args: { timeoutMs: { $state: 'timeoutMs' } } } },
      { op: 'replace', path: '/mode', value: { $cond: { $state: 'mode', eq: 'fast' }, $then: 'quick', $else: 'thorough' } },
      { op: 'add', path: '/backends/*/weight', value: 1 },
      { op: 'remove', path: '/legacy' },
    ],
  },
});

const v1 = { host: 'a.example', timeout: 2, mode: 'fast', legacy: true, backends: [{ address: 'x' }, { address: 'y' }] };
const now: Infer<typeof settings> = {
  server: { host: 'a.example', port: 80 },
  timeoutMs: 2000,
  mode: 'quick',
  backends: [
    { url: 'x', weight: 1 },
    { url: 'y', weight: 1 },
  ],
};

describe('migrate', () => {
  test('values say their version, and are brought forward one migration at a time', () => {
    expect(parse(settings, { $version: 1, ...v1 })).toEqual({ ok: true, value: now, issues: [] });
    expect(
      migrate(settings, { $version: 2, server: { host: 'h' }, timeout: 3, mode: 'slow', backends: [{ url: 'z', weight: 5 }] }),
    ).toEqual({ $version: 3, server: { host: 'h' }, timeoutMs: 3000, mode: 'thorough', backends: [{ url: 'z', weight: 1 }] });
  });

  test('`from` says the version of values that do not; without either they are taken as current', () => {
    expect(parse(settings, v1, { from: 1 }).value).toEqual(now);
    expect(parse(settings, v1).issues.map((i) => i.path)).toContain('/host');
    expect(migrate(settings, { timeoutMs: 5 })).toEqual({ timeoutMs: 5 });
  });

  test('what an operation does not find, it leaves be', () => {
    expect(migrate(settings, { $version: 1 })).toEqual({ $version: 3 });
    expect(parse(settings, { $version: 1 }).ok).toBe(true);
  });

  test('a value that cannot be worked out keeps its old one, and is an issue', () => {
    const result = parse(settings, { $version: 2, timeout: 'soon' });
    expect(result.issues.map((i) => [i.path, i.code])).toEqual([
      ['/timeoutMs', 'migration'],
      ['/timeoutMs', 'type'],
    ]);
    expect(result.issues[0]!.message).toStartWith('could not be brought to version 3: ');
  });

  test('`encode` writes the version, and `parse` reads it back', () => {
    const json = encode(settings, now);
    expect(Object.keys(json as object)[0]).toBe('$version');
    expect((json as { $version: number }).$version).toBe(3);
    expect(parse(settings, json)).toEqual({ ok: true, value: now, issues: [] });
    expect(versionOf(settings)).toBe(3);
    expect(encode(define({ fields: { a: { type: 'int' } } }), { a: 1 })).toEqual({ a: 1 });
  });

  test('a version the spec cannot read is an issue', () => {
    expect(parse(settings, { $version: 4, ...now }).issues[0]).toEqual({
      path: '/$version',
      code: 'version',
      message: 'was written for version 4; this is version 3',
      params: { version: 4, current: 3 },
    });
    expect(parse(settings, { $version: 'two', ...now }).issues[0]?.message).toBe('must be a version: a whole number from 1');
  });

  test('a form migrates the values it is given, and writes the version', () => {
    const form = createForm(settings, { values: v1, from: 1 });
    expect(form.values).toEqual(now);
    expect(form.json()).toMatchObject({ $version: 3, timeoutMs: 2000 });
  });
});

describe('checking versions and migrations', () => {
  test('each fault at its spot', () => {
    const faults = checkSpec(
      {
        version: 2,
        fields: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
        migrations: {
          '1': [],
          '3': [],
          '2': [
            { op: 'rename', from: '/a', path: '/b' },
            { op: 'move', from: '/title', path: '/name', value: 1 },
            { op: 'add', path: 'name' },
            { op: 'copy', from: '/old/*/x', path: '/tags' },
            { op: 'add', path: '/nope', value: { $state: '/whatever' } },
            { op: 'replace', path: '/tags/*', value: { $cel: 'x', args: { x: { $state: '/old' } } } },
          ],
        },
      },
      { registry },
    );
    expect(faults.map((f) => [f.path, f.severity])).toEqual([
      ['/migrations/1', 'error'],
      ['/migrations/2/0/op', 'error'],
      ['/migrations/2/1/value', 'error'],
      ['/migrations/2/2/path', 'error'],
      ['/migrations/2/2/value', 'error'],
      ['/migrations/2/3/path', 'error'],
      ['/migrations/2/4/path', 'warning'],
      ['/migrations/3', 'error'],
    ]);
    expect(faults[1]!.message).toContain('must be one of "add", "replace", "remove", "move", "copy"');
  });

  test('a version is a whole number, and migrations need one', () => {
    expect(checkSpec({ version: 1.5, fields: {} }).map((f) => f.path)).toEqual(['/version']);
    expect(checkSpec({ fields: {}, migrations: {} }).map((f) => f.message)).toEqual([
      'needs `version`: the version of the values this spec describes',
    ]);
    expect(checkSpec(settings, { registry })).toEqual([]);
  });

  test('the meta-schema, JSON Schema and the prompt know them', () => {
    const valid = new Ajv2020({ strict: false }).compile(metaSchema());
    expect(valid(settings)).toBe(true);
    expect(valid({ version: 2, fields: {}, migrations: { '2': [{ op: 'move', path: '/a' }] } })).toBe(false);

    const output = toJSONSchema(settings);
    expect(output.properties).toMatchObject({ $version: { const: 3 } });
    expect(output.required).toContain('$version');
    expect(toJSONSchema(settings, { io: 'input' }).properties).toMatchObject({ $version: { type: 'integer', minimum: 1, maximum: 3 } });
    const back = fromJSONSchema(output);
    expect(back.version).toBe(3);
    expect(back.migrations).toEqual(settings.migrations);
    expect(back.fields).not.toHaveProperty('$version');
    expect(new Ajv2020({ strict: false }).compile(output)(encode(settings, now))).toBe(true);

    expect(prompt()).toContain('## Versions and migrations');
  });
});
