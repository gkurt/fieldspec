import { describe, expect, test } from 'bun:test';
import { applyPatch, checkSpec, createForm, define, encode, layout, parse, walk, type Infer, type LayoutNode } from '#src/index.ts';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>() => {};

const account = define({
  title: 'Account',
  fields: {
    firstName: { type: 'string', label: 'First name', group: 'name', aliases: ['first_name'] },
    lastName: { type: 'string', label: 'Last name', group: 'name' },
    email: { type: 'string', format: 'email', required: true },
    plan: {
      type: 'enum',
      options: [
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro' },
      ],
      default: 'free',
    },
    seats: { type: 'int', min: 1, max: 100, default: 1, visible: { $state: 'plan', eq: 'pro' } },
    renews: { type: 'date', optional: true },
    tags: { type: 'set', items: { type: 'enum', options: ['a', 'b', 'c'] } },
    limits: { type: 'map', keys: { type: 'string' }, values: { type: 'bigint' } },
    auth: {
      type: 'variant',
      key: 'method',
      variants: {
        none: { label: 'None', fields: {} },
        token: { label: 'Token', fields: { token: { type: 'string', required: true } } },
      },
    },
    servers: {
      type: 'array',
      items: {
        type: 'object',
        fields: {
          host: { type: 'string', format: 'hostname', required: true },
          port: { type: 'int', default: 443 },
          tls: { type: 'boolean', default: true, visible: { $item: 'port', neq: 80 } },
        },
      },
    },
  },
  groups: { name: { label: 'Name', render: 'row' } },
});

describe('inference', () => {
  test('values are typed from the spec', () => {
    type V = Infer<typeof account>;
    assertType<Equal<V['firstName'], string>>();
    assertType<Equal<V['plan'], 'free' | 'pro'>>();
    assertType<Equal<V['renews'], Date | undefined>>();
    assertType<Equal<V['tags'], Set<'a' | 'b' | 'c'>>>();
    assertType<Equal<V['limits'], Map<string, bigint>>>();
    assertType<Equal<V['auth'], { method: 'none' } | { method: 'token'; token: string }>>();
    assertType<Equal<V['servers'][number], { host: string; port: number; tls: boolean }>>();
    expect(true).toBe(true);
  });

  test('a function table must implement every $computed name', () => {
    const fields = { a: { type: 'string', default: { $computed: 'upper' } } } as const;
    // @ts-expect-error "upper" is missing
    define({ fields }, { fns: { lower: () => '' } });
    define({ fields }, { fns: { upper: () => '' } });
    expect(true).toBe(true);
  });
});

describe('parse', () => {
  test('fills defaults and zeros, renames aliases, revives built-ins', () => {
    const result = parse(account, {
      first_name: 'Ada',
      email: 'ada@example.com',
      limits: [['cpu', '12345678901234567890']],
      servers: [{ host: 'example.com' }],
    });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    const v = result.value!;
    expect(v.firstName).toBe('Ada');
    expect(v.lastName).toBe('');
    expect(v.plan).toBe('free');
    expect(v.seats).toBe(1);
    expect(v.tags).toEqual(new Set());
    expect(v.limits.get('cpu')).toBe(12345678901234567890n);
    expect(v.auth).toEqual({ method: 'none' });
    expect(v.servers[0]).toEqual({ host: 'example.com', port: 443, tls: true });
    expect('renews' in v).toBe(false);
  });

  test('reports every issue at its path, skipping hidden fields', () => {
    const result = parse(account, {
      email: 'nope',
      plan: 'team',
      seats: 1000,
      auth: { method: 'token' },
      servers: [{ host: '', port: 80, tls: 'x' }],
      extra: 1,
    });
    expect(result.ok).toBe(false);
    const byPath = Object.fromEntries(result.issues.map((i) => [i.path, i.code]));
    expect(byPath).toEqual({
      '/email': 'format',
      '/plan': 'enum',
      '/auth/token': 'required',
      '/servers/0/host': 'required',
      '/extra': 'unknown',
    });
  });

  test("a pattern's message names what the field is", () => {
    const spec = define({
      defs: { Slug: { type: 'string', pattern: '[a-z0-9]+(-[a-z0-9]+)*' }, ZipCode: { type: 'string', pattern: '[0-9]{5}' } },
      fields: {
        slug: { use: 'Slug', label: 'Address' },
        zip: { use: 'ZipCode' },
        code: { type: 'string', label: 'IBAN code', pattern: '[A-Z]{2}[0-9]+' },
        vatId: { type: 'string', pattern: '[A-Z]+' },
        tags: { type: 'array', items: { type: 'string', pattern: '[a-z]+' } },
        own: { type: 'string', pattern: 'x+', patternMessage: 'Only x, please' },
      },
    });
    const values = { slug: 'Hello World', zip: '1', code: 'x', vatId: '1', tags: ['A'], own: 'y' };
    expect(Object.fromEntries(parse(spec, values).issues.map((i) => [i.path, i.message]))).toEqual({
      '/slug': "This isn't a valid slug",
      '/zip': "This isn't a valid zip code",
      '/code': "This isn't a valid IBAN code",
      '/vatId': "This isn't a valid vat id",
      '/tags/0': "This isn't valid",
      '/own': 'Only x, please',
    });
    expect(checkSpec({ fields: { a: { type: 'string', patternMessage: 'No' } } })).toEqual([
      { path: '/fields/a/patternMessage', message: 'explains a pattern, but there is none', severity: 'warning' },
    ]);
  });

  test('conditional visibility unlocks validation', () => {
    const result = parse(account, { email: 'a@b.co', plan: 'pro', seats: 1000 });
    expect(result.issues.map((i) => i.path)).toEqual(['/seats']);
  });

  test('encode round-trips to JSON', () => {
    const value = parse(account, { email: 'a@b.co', renews: '2026-12-01', limits: { cpu: '5' } }).value!;
    const json = encode(account, value);
    expect(json).toMatchObject({ renews: '2026-12-01', limits: [['cpu', '5']], tags: [] });
    expect(parse(account, JSON.parse(JSON.stringify(json))).value).toEqual(value);
  });

  test('encode leaves a value of another type as it is', () => {
    const spec = define({
      fields: { d: { type: 'date' }, b: { type: 'bigint' }, u: { type: 'url' }, r: { type: 'regexp' }, y: { type: 'bytes' } },
    });
    const junk = { d: '', b: null, u: 'x', r: 3, y: [] };
    expect(encode(spec, junk)).toEqual(junk);
    expect(() => encode(spec, { d: new Date(Number.NaN) })).not.toThrow();
    const form = createForm(spec);
    form.set('/d', null);
    expect(form.json()).toMatchObject({ d: null });
  });
});

describe('expressions', () => {
  test('computed and conditional defaults resolve in dependency order', () => {
    const spec = define(
      {
        fields: {
          display: { type: 'string', default: { $template: '${first} ${last}' } },
          first: { type: 'string', default: 'Ada' },
          last: { type: 'string', default: { $computed: 'upper', args: { s: 'lovelace' } } },
          tier: { type: 'enum', options: ['low', 'high'], default: { $cond: { $state: '/score', gt: 10 }, $then: 'high', $else: 'low' } },
          score: { type: 'int', default: 42 },
        },
      },
      { fns: { upper: ({ s }) => String(s).toUpperCase() } },
    );
    const v = parse(spec, {}).value!;
    expect(v).toEqual({ display: 'Ada LOVELACE', first: 'Ada', last: 'LOVELACE', tier: 'high', score: 42 });
  });

  test('dynamic options are validated against their evaluated list', () => {
    const spec = define(
      { fields: { region: { type: 'enum', options: { $computed: 'regions' }, optional: true } } },
      { fns: { regions: () => ['eu', 'us'] } },
    );
    expect(parse(spec, { region: 'eu' }).ok).toBe(true);
    expect(parse(spec, { region: 'mars' }).issues[0]?.code).toBe('enum');
  });
});

describe('checkSpec', () => {
  test('a good spec has no faults', () => {
    expect(checkSpec(account).filter((f) => f.severity === 'error')).toEqual([]);
  });

  test('collects every fault with a path and a fix', () => {
    const faults = checkSpec({
      fields: {
        a: { type: 'strng' },
        b: { type: 'int', min: 5, max: 1, lable: 'B' },
        c: { type: 'enum', options: ['x', 'y'], default: 'z' },
        d: { type: 'string', group: 'nmae', visible: { $state: '/b', eq: 1, gt: 2 } },
        e: { type: 'string', visible: { $item: 'x' } },
      },
      groups: {
        name: { label: 'Name', render: { type: 'row', children: [{ field: 'a' }, { type: 'Bogus' }] } },
      },
    });
    const messages = faults.map((f) => `${f.path}: ${f.message}`);
    expect(messages).toContainEqual(expect.stringContaining('/fields/a/type: "strng" is not a built-in kind. Did you mean "string"?'));
    expect(messages).toContainEqual(expect.stringContaining('/fields/b/max: must be at least min'));
    expect(messages).toContainEqual(expect.stringContaining('/fields/b/lable: is not a property of a int field. Did you mean "label"?'));
    expect(messages).toContainEqual(expect.stringContaining('/fields/c/default: must be one of'));
    expect(messages).toContainEqual(expect.stringContaining('/fields/d/group: no group "nmae" in this scope. Did you mean "name"?'));
    expect(messages).toContainEqual(expect.stringContaining('/fields/d/visible: has eq and gt; use one operator'));
    expect(messages).toContainEqual(expect.stringContaining('/fields/e/visible: $item works only inside an array item'));
    expect(messages).toContainEqual(expect.stringContaining('/groups/name/render/children/0/field: "a" is not in this group'));
    expect(messages).toContainEqual(expect.stringContaining('/groups/name/render/children/1/type: "Bogus" is not an element'));
  });

  test('a field placed twice in one view is a fault', () => {
    const faults = checkSpec({
      fields: { a: { type: 'string' } },
      layouts: { compact: { type: 'row', children: [{ field: 'a' }, { field: 'a' }] } },
    });
    expect(faults.map((f) => f.message)).toContainEqual(expect.stringContaining('already placed'));
  });

  test('$computed names must be declared and implemented', () => {
    const spec = { fields: { a: { type: 'string', default: { $computed: 'nope' } } }, functions: { other: {} } };
    const messages = checkSpec(spec, { fns: {} }).map((f) => f.message);
    expect(messages).toContainEqual(expect.stringContaining('"nope", which `functions` does not declare'));
    expect(messages).toContainEqual(expect.stringContaining('which the function table does not implement'));
    expect(messages).toContainEqual(expect.stringContaining('declared but never called'));
  });
});

const shape = (node: LayoutNode): unknown => {
  const kids = [...node.children, ...(node.inner ? [node.inner] : [])];
  const label = node.field !== undefined ? `${node.type}:${node.field}` : node.type;
  return kids.length === 0 ? label : { [label]: kids.map(shape) };
};

describe('layout', () => {
  test('a group with render: row puts its fields side by side where its first field is', () => {
    const tree = layout(
      define({
        fields: {
          firstName: { type: 'string', group: 'name' },
          email: { type: 'string' },
          lastName: { type: 'string', group: 'name' },
        },
        groups: { name: { label: 'Name', render: 'row' } },
      }),
    );
    expect(shape(tree)).toEqual({
      stack: [{ row: ['field:firstName', 'field:lastName'] }, 'field:email'],
    });
  });

  test('a full group fragment replaces the frame; unplaced members follow', () => {
    const tree = layout(
      define({
        fields: {
          first: { type: 'string', group: 'name' },
          last: { type: 'string', group: 'name' },
          middle: { type: 'string', group: 'name' },
        },
        groups: {
          name: {
            render: {
              type: 'stack',
              children: [
                { type: 'label', props: { text: 'Name' } },
                {
                  type: 'row',
                  children: [
                    { type: 'control', props: { field: 'first' } },
                    { type: 'control', props: { field: 'last' } },
                  ],
                },
                { type: 'errors', props: { fields: ['first', 'last'] } },
                { type: 'field', props: { field: 'first' } },
                { type: 'field', props: { field: 'last' } },
              ],
            },
          },
        },
      }),
    );
    expect(shape(tree)).toEqual({
      stack: [
        {
          stack: [{ stack: ['label', { row: ['control:first', 'control:last'] }, 'errors', 'field:first', 'field:last'] }, 'field:middle'],
        },
      ],
    });
  });

  test('rest places the remainder; layouts are alternate views', () => {
    const spec = define({
      fields: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } },
      layouts: { compact: { type: 'stack', children: [{ type: 'rest' }, { type: 'divider' }, { field: 'a' }] } },
    });
    expect(shape(layout(spec, 'compact'))).toEqual({ stack: [{ stack: ['field:b', 'field:c'] }, 'divider', 'field:a'] });
  });

  test('containers carry their inside: objects, items and variants', () => {
    const tree = layout(account);
    const servers = [...walk(tree)].find((n) => n.field === 'servers')!;
    expect(servers.item?.inner?.children.map((n) => n.field)).toEqual(['host', 'port', 'tls']);
    const auth = [...walk(tree)].find((n) => n.field === 'auth')!;
    expect(Object.keys(auth.variants!)).toEqual(['none', 'token']);
  });
});

describe('form', () => {
  test('field state follows the values', () => {
    const form = createForm(account, { values: { email: 'a@b.co' } });
    expect(form.field('/seats')?.visible).toBe(false);
    form.set('/plan', 'pro');
    expect(form.field('/seats')?.visible).toBe(true);
    expect(form.field('/plan')?.options?.map((o) => o.label)).toEqual(['Free', 'Pro']);
    expect(form.field('/lastName')?.label).toBe('Last name');
    expect(form.field('/email')?.required).toBe(true);
  });

  test("switching a variant fills the new variant's defaults", () => {
    const form = createForm(
      define({
        fields: {
          auth: {
            type: 'variant',
            key: 'method',
            variants: { none: { fields: {} }, basic: { fields: { user: { type: 'string', default: 'admin' } } } },
          },
        },
      }),
    );
    form.set('/auth/method', 'basic');
    expect(form.values.auth).toEqual({ method: 'basic', user: 'admin' });
  });

  test('items are added with their defaults, and $item conditions see their own item', () => {
    const form = createForm(account);
    form.addItem('/servers');
    form.set('/servers/0/port', 80);
    expect(form.values.servers[0]).toEqual({ host: '', port: 80, tls: true });
    expect(form.field('/servers/0/tls')?.visible).toBe(false);
    form.addItem('/servers');
    expect(form.field('/servers/1/tls')?.visible).toBe(true);
    form.moveItem('/servers', 1, 0);
    expect(form.values.servers.map((s) => s.port)).toEqual([443, 80]);
    form.removeItem('/servers/0');
    expect(form.values.servers.length).toBe(1);
  });

  test('JSON patches decode their values against the spec', () => {
    const form = createForm(account);
    form.apply([
      { op: 'replace', path: '/email', value: 'x@y.z' },
      { op: 'add', path: '/renews', value: '2027-01-01' },
      { op: 'add', path: '/servers/-', value: { host: 'a.example' } },
    ]);
    expect(form.values.renews).toEqual(new Date('2027-01-01'));
    expect(form.values.servers[0]).toEqual({ host: 'a.example', port: 443, tls: true });
    expect(() => form.apply([{ op: 'test', path: '/email', value: 'nope' }])).toThrow('test failed');
  });

  test('issues show after touch or submit', () => {
    const form = createForm(account);
    expect(form.field('/email')?.showIssues).toBe(false);
    expect(form.field('/email')?.issues[0]?.code).toBe('required');
    const result = form.submit();
    expect(result.ok).toBe(false);
    expect(form.field('/email')?.showIssues).toBe(true);
  });
});

describe('patch', () => {
  test('RFC 6902 operations', () => {
    const doc = { a: [1, 2], b: { c: 1 } };
    expect(
      applyPatch(doc, [
        { op: 'add', path: '/a/1', value: 9 },
        { op: 'move', from: '/b/c', path: '/d' },
        { op: 'copy', from: '/a', path: '/e' },
        { op: 'remove', path: '/a/0' },
      ]),
    ).toEqual({ a: [9, 2], b: {}, d: 1, e: [1, 9, 2] });
    expect(doc).toEqual({ a: [1, 2], b: { c: 1 } });
  });
});
