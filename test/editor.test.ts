/** The headless spec editor: the fields as a tree, the JSON as text and the description, over one checked state. */
import { describe, expect, test } from 'bun:test';
import { createCel } from '#src/cel.ts';
import {
  checkSpec,
  createRegistry,
  createSpecEditor,
  descriptionOf,
  fingerprint,
  getAt,
  isDescriptionStale,
  readSpec,
  withDescription,
  type Spec,
  type SpecNode,
} from '#src/index.ts';

const account: Spec = {
  title: { $template: 'Account of ${/name}' },
  fields: {
    name: { type: 'string', required: true, group: 'who' },
    email: { use: 'email', group: 'who' },
    plan: { type: 'enum', options: ['free', 'pro'], default: 'free' },
    seats: { type: 'int', min: 1, default: 1, visible: { $state: 'plan', eq: 'pro' } },
    address: {
      type: 'object',
      fields: {
        street: { type: 'string' },
        city: { type: 'string', label: { $template: 'City of ${street}' } },
      },
    },
    members: {
      type: 'array',
      namedBy: 'handle',
      items: {
        type: 'object',
        fields: {
          handle: { type: 'string' },
          role: { type: 'enum', options: ['admin', 'member'], enabled: { $item: 'handle' } },
          owner: { type: 'boolean', visible: { $state: '../../plan', eq: 'pro' } },
        },
      },
    },
    login: {
      type: 'variant',
      key: 'method',
      variants: {
        password: { fields: { secret: { type: 'string' } } },
        token: { fields: { token: { type: 'string' }, expires: { type: 'date', optional: true } } },
      },
    },
  },
  groups: { who: { label: 'Who', render: { type: 'row', children: [{ field: 'name' }, { field: 'email' }] } } },
  layouts: {
    short: { type: 'stack', children: [{ field: 'name' }, { type: 'field', props: { field: 'plan' } }, { field: 'address/street' }] },
  },
  locales: { de: { '/fields/name/label': 'Name', '/fields/plan/options/0/label': 'Kostenlos' } },
};

const keysOf = (nodes: readonly SpecNode[]) => nodes.map((n) => n.key);
const errors = (spec: Spec) => checkSpec(spec).filter((f) => f.severity === 'error');
/** The message a promise fails with. */
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: Error) => error.message,
  );
/** What the checker says of a spec, but for the translations the account leaves out. */
const unresolved = (spec: Spec) => checkSpec(spec).filter((f) => f.path !== '/locales/de');

describe('the tree', () => {
  const editor = createSpecEditor({ spec: account });

  test('lists the fields in order, each with its kind and what is inside it', () => {
    expect(keysOf(editor.fields.nodes)).toEqual(['name', 'email', 'plan', 'seats', 'address', 'members', 'login']);
    const [name, email, , , address, members, login] = editor.fields.nodes;
    expect(name).toMatchObject({ path: '/fields/name', kind: 'string', required: true, optional: false, label: 'Name', slot: 'field' });
    expect(email).toMatchObject({ kind: 'string', use: 'email' });
    expect(address!.fields!.path).toBe('/fields/address/fields');
    expect(keysOf(address!.fields!.nodes)).toEqual(['street', 'city']);
    expect(members!.items).toMatchObject({ path: '/fields/members/items', slot: 'items', kind: 'object' });
    expect(keysOf(members!.items!.fields!.nodes)).toEqual(['handle', 'role', 'owner']);
    expect(login!.variants!.map((v) => v.name)).toEqual(['password', 'token']);
    expect(login!.variants![1]!.fields.nodes[1]).toMatchObject({ path: '/fields/login/variants/token/fields/expires', optional: true });
  });

  test('finds a declaration at any depth by its pointer', () => {
    expect(editor.node('/fields/members/items/fields/role')?.kind).toBe('enum');
    expect(editor.node('/fields/login/variants/token/fields/token')?.key).toBe('token');
    expect(editor.node('/fields/nowhere')).toBeUndefined();
  });

  test("says which properties a declaration may have, the kind's own first", () => {
    const props = editor.props('/fields/seats');
    expect(props.slice(0, 4).map((p) => p.name)).toEqual(['min', 'max', 'step', 'unit']);
    expect(props.find((p) => p.name === 'min')).toMatchObject({ own: true, value: 1 });
    expect(props.find((p) => p.name === 'label')).toMatchObject({ own: false, value: undefined });
    expect(editor.props('/fields/plan').find((p) => p.name === 'options')).toMatchObject({ required: true });
    expect(editor.props('/fields/email').find((p) => p.name === 'format')).toMatchObject({ value: undefined, inherited: 'email' });
  });

  test('names the kinds and what a field can build on', () => {
    expect(editor.kinds).toContain('variant');
    expect(editor.uses).toContain('email');
    expect(createSpecEditor({ spec: { fields: {}, defs: { Address: { type: 'string' } } } }).uses[0]).toBe('Address');
  });
});

describe('editing fields', () => {
  test('adds a field with a key not taken, where asked, and at any depth', () => {
    const editor = createSpecEditor();
    expect(editor.add()).toEqual({ ok: true, path: '/fields/field1' });
    expect(editor.add('/fields', { key: 'age', decl: { type: 'int', min: 0 }, index: 0 })).toEqual({ ok: true, path: '/fields/age' });
    expect(editor.spec.fields).toEqual({ age: { type: 'int', min: 0 }, field1: { type: 'string' } });
    editor.setKind('/fields/field1', 'object');
    expect(editor.add('/fields/field1/fields')).toEqual({ ok: true, path: '/fields/field1/fields/field1' });
    expect(keysOf(editor.node('/fields/field1')!.fields!.nodes)).toEqual(['field1']);
    expect(editor.version).toBe(4);
  });

  test('adds definitions, variants and groups with a start of their own', () => {
    const editor = createSpecEditor({ spec: account });
    expect(editor.add('/fields/login/variants')).toMatchObject({ ok: true, path: '/fields/login/variants/variant3' });
    expect(editor.spec.fields.login).toMatchObject({ variants: { variant3: { fields: {} } } });
    expect(editor.add('/defs', { key: 'Slug', decl: { type: 'string', pattern: '^[a-z-]+$' } }).ok).toBe(true);
    expect(editor.faultsAt('/defs/Slug').map((f) => f.message)).toEqual(['is never used']);
  });

  test('refuses a key that is taken or that no field may have, and keeps the spec', () => {
    const editor = createSpecEditor({ spec: account });
    const taken = editor.add('/fields', { key: 'name' });
    expect(taken).toMatchObject({ ok: false, faults: [{ path: '/fields/name' }] });
    const bad = editor.add('/fields', { key: '$cost' });
    expect(bad).toMatchObject({ ok: false, faults: [{ path: '/fields/$cost' }] });
    expect(editor.refused?.faults[0]?.message).toContain('must not start with $');
    expect(editor.spec).toBe(account);
    expect(editor.set('/fields/name/label', 'Full name').ok).toBe(true);
    expect(editor.refused).toBeUndefined();
  });

  test('sets and removes a property anywhere, refusing what the checker does', () => {
    const editor = createSpecEditor({ spec: account });
    expect(editor.set('/fields/address/fields/street/maxLength', 80).ok).toBe(true);
    expect(editor.set('/fields/name/required', undefined).ok).toBe(true);
    expect(editor.node('/fields/name')!.required).toBe(false);
    expect(editor.set('/fields/plan/default', 'enterprise')).toMatchObject({ ok: false, faults: [{ path: '/fields/plan/default' }] });
    expect(editor.set('/fields/seats/minimum', 2)).toMatchObject({ ok: false, faults: [{ path: '/fields/seats/minimum' }] });
    expect(editor.spec.fields.plan).toEqual(account.fields.plan);
    expect(editor.set('/title', 'Account').ok).toBe(true);
    expect(editor.spec.title).toBe('Account');
  });

  test('moves a field among its siblings', () => {
    const editor = createSpecEditor({ spec: account });
    editor.move('/fields/plan', 0);
    editor.move('/fields/address/fields/city', 0);
    expect(keysOf(editor.fields.nodes).slice(0, 3)).toEqual(['plan', 'name', 'email']);
    expect(keysOf(editor.node('/fields/address')!.fields!.nodes)).toEqual(['city', 'street']);
    editor.move('/fields/plan', 99);
    expect(keysOf(editor.fields.nodes).at(-1)).toBe('plan');
  });

  test('removes a field with its translations, and reports what still places it', () => {
    const editor = createSpecEditor({ spec: account });
    expect(editor.remove('/fields/seats').ok).toBe(true);
    expect(editor.remove('/fields/plan')).toMatchObject({ ok: false });
    expect(editor.refused!.faults.map((f) => f.path)).toContain('/layouts/short/children/1/props/field');
    expect(editor.set('/layouts', undefined).ok).toBe(true);
    expect(editor.remove('/fields/plan').ok).toBe(true);
    expect(editor.spec.locales).toEqual({ de: { '/fields/name/label': 'Name' } });
    expect(editor.faults.map((f) => f.path)).toContain('/fields/members/items/fields/owner/visible/$state');
  });
});

describe('changing a kind', () => {
  test('keeps what the new kind takes and drops what it refuses', () => {
    const editor = createSpecEditor({ spec: account });
    editor.set('/fields/seats/label', 'Seats');
    expect(editor.setKind('/fields/seats', 'number').ok).toBe(true);
    expect(editor.spec.fields.seats).toEqual({
      type: 'number',
      min: 1,
      default: 1,
      visible: { $state: 'plan', eq: 'pro' },
      label: 'Seats',
    });
    expect(editor.setKind('/fields/seats', 'string').ok).toBe(true);
    expect(editor.spec.fields.seats).toEqual({ type: 'string', visible: { $state: 'plan', eq: 'pro' }, label: 'Seats' });
  });

  test('starts what the new kind needs', () => {
    const editor = createSpecEditor({ spec: { fields: { x: { type: 'string', label: 'X' } } } });
    const starts: Record<string, object> = {
      enum: { options: ['option1', 'option2'] },
      array: { items: { type: 'string' } },
      set: { items: { type: 'string' } },
      record: { values: { type: 'string' } },
      map: { keys: { type: 'string' }, values: { type: 'string' } },
      object: { fields: {} },
      variant: { key: 'type', variants: { variant1: { fields: {} } } },
    };
    for (const [kind, start] of Object.entries(starts)) {
      expect(editor.setKind('/fields/x', kind)).toEqual({ ok: true, path: '/fields/x' });
      expect(editor.spec.fields.x).toEqual({ type: kind, label: 'X', ...start });
    }
    for (const kind of editor.kinds) expect(editor.setKind('/fields/x', kind).ok).toBe(true);
  });

  test('gives a field built on a preset a kind of its own, and refuses a kind the registry lacks', () => {
    const editor = createSpecEditor({ spec: account });
    expect(editor.setKind('/fields/email', 'url').ok).toBe(true);
    expect(editor.spec.fields.email).toEqual({ type: 'url', group: 'who' });
    expect(editor.setKind('/fields/email', 'Money')).toMatchObject({ ok: false, faults: [{ path: '/fields/email/type' }] });
  });

  test("an item, a value and a variant's field change kind like any field", () => {
    const editor = createSpecEditor({ spec: account });
    expect(editor.setKind('/fields/members/items/fields/role', 'string').ok).toBe(true);
    expect(editor.setKind('/fields/login/variants/token/fields/expires', 'int').ok).toBe(true);
    expect(editor.node('/fields/login/variants/token/fields/expires')).toMatchObject({ kind: 'int', optional: true });
  });
});

describe('renaming', () => {
  test('a field keeps its place, and everything that names it follows', () => {
    const editor = createSpecEditor({ spec: account });
    expect(editor.rename('/fields/name', 'fullName')).toEqual({ ok: true, path: '/fields/fullName' });
    const spec = editor.spec;
    expect(Object.keys(spec.fields)[0]).toBe('fullName');
    expect(spec.title).toEqual({ $template: 'Account of ${/fullName}' });
    expect(spec.groups!.who!.render).toEqual({ type: 'row', children: [{ field: 'fullName' }, { field: 'email' }] });
    expect(getAt(spec, '/layouts/short/children/0')).toEqual({ field: 'fullName' });
    expect(spec.locales!.de).toEqual({ '/fields/fullName/label': 'Name', '/fields/plan/options/0/label': 'Kostenlos' });
    expect(unresolved(spec)).toEqual([]);
  });

  test('pointers follow, relative and absolute, from siblings and from inside items', () => {
    const editor = createSpecEditor({ spec: account });
    editor.rename('/fields/plan', 'tier');
    const at = (pointer: string) => getAt(editor.spec, pointer);
    expect(at('/fields/seats/visible')).toEqual({ $state: 'tier', eq: 'pro' });
    expect(at('/fields/members/items/fields/owner/visible')).toEqual({ $state: '../../tier', eq: 'pro' });
    expect(at('/layouts/short/children/1')).toEqual({ type: 'field', props: { field: 'tier' } });
    expect(editor.spec.locales!.de).toHaveProperty('/fields/tier/options/0/label');
    expect(unresolved(editor.spec)).toEqual([]);
  });

  test('a nested field is followed by its siblings, by placements that reach it, and by the list that is named by it', () => {
    const editor = createSpecEditor({ spec: account });
    editor.rename('/fields/address/fields/street', 'line1');
    editor.rename('/fields/members/items/fields/handle', 'nick');
    const at = (pointer: string) => getAt(editor.spec, pointer);
    expect(at('/fields/address/fields/city/label')).toEqual({ $template: 'City of ${line1}' });
    expect(at('/layouts/short/children/2')).toEqual({ field: 'address/line1' });
    expect(at('/fields/members/namedBy')).toBe('nick');
    expect(at('/fields/members/items/fields/role/enabled')).toEqual({ $item: 'nick' });
    expect(unresolved(editor.spec)).toEqual([]);
  });

  test('a field of the same key elsewhere is left alone', () => {
    const spec: Spec = {
      fields: {
        name: { type: 'string' },
        pet: { type: 'object', fields: { name: { type: 'string' }, tag: { type: 'string', visible: { $state: 'name' } } } },
        greeting: { type: 'string', default: { $template: '${name} and ${pet/name}' }, visible: { $state: '/pet/name' } },
      },
    };
    const editor = createSpecEditor({ spec });
    editor.rename('/fields/pet/fields/name', 'called');
    expect(editor.spec.fields).toEqual({
      name: { type: 'string' },
      pet: { type: 'object', fields: { called: { type: 'string' }, tag: { type: 'string', visible: { $state: 'called' } } } },
      greeting: { type: 'string', default: { $template: '${name} and ${pet/called}' }, visible: { $state: '/pet/called' } },
    });
    editor.rename('/fields/name', 'title');
    expect(editor.spec.fields.greeting).toMatchObject({ default: { $template: '${title} and ${pet/called}' } });
    expect(editor.spec.fields.pet).toMatchObject({ fields: { tag: { visible: { $state: 'called' } } } });
  });

  test('a field of a definition is followed inside it and through every use of it', () => {
    const spec: Spec = {
      defs: {
        Address: {
          type: 'object',
          fields: { street: { type: 'string' }, city: { type: 'string', enabled: { $state: 'street' } } },
        },
      },
      fields: {
        home: { use: 'Address' },
        work: { use: 'Address' },
        sameStreet: { type: 'boolean', visible: { $state: 'home/street', eq: { $state: '/work/street' } } },
      },
      layouts: { short: { type: 'stack', children: [{ field: 'home/street' }] } },
    };
    const editor = createSpecEditor({ spec });
    expect(editor.rename('/defs/Address/fields/street', 'line1').ok).toBe(true);
    expect(editor.spec.defs!.Address).toMatchObject({ fields: { city: { enabled: { $state: 'line1' } } } });
    expect(editor.spec.fields.sameStreet).toMatchObject({ visible: { $state: 'home/line1', eq: { $state: '/work/line1' } } });
    expect(editor.spec.layouts!.short).toEqual({ type: 'stack', children: [{ field: 'home/line1' }] });
    expect(checkSpec(editor.spec)).toEqual([]);
  });

  test('code reads the field through its args, which follow', () => {
    const registry = createRegistry({ languages: [createCel()] });
    const spec: Spec = {
      fields: {
        start: { type: 'int' },
        end: {
          type: 'int',
          checks: [
            { assert: { $cel: 'end >= start', args: { end: { $state: 'end' }, start: { $state: 'start' } } }, message: 'Ends early' },
          ],
        },
      },
    };
    const editor = createSpecEditor({ spec, registry });
    expect(editor.rename('/fields/start', 'from').ok).toBe(true);
    expect(editor.spec.fields.end).toMatchObject({
      checks: [{ assert: { $cel: 'end >= start', args: { end: { $state: 'end' }, start: { $state: 'from' } } } }],
    });
  });

  test('a definition is followed by every use, a group by its members and placements', () => {
    const spec: Spec = {
      defs: { Slug: { type: 'string', pattern: '^[a-z-]+$' } },
      fields: {
        id: { use: 'Slug', group: 'ids' },
        aliases: { type: 'array', items: { use: 'Slug' }, group: 'more' },
      },
      groups: { ids: { label: 'Ids' }, more: { group: 'ids' } },
      layouts: { all: { type: 'stack', children: [{ group: 'ids' }] } },
    };
    const editor = createSpecEditor({ spec });
    expect(editor.rename('/defs/Slug', 'Handle')).toEqual({ ok: true, path: '/defs/Handle' });
    expect(editor.spec.fields).toMatchObject({ id: { use: 'Handle' }, aliases: { items: { use: 'Handle' } } });
    expect(editor.rename('/groups/ids', 'names').ok).toBe(true);
    expect(editor.spec.fields.id).toMatchObject({ group: 'names' });
    expect(editor.spec.groups).toEqual({ names: { label: 'Ids' }, more: { group: 'names' } });
    expect(editor.spec.layouts!.all).toEqual({ type: 'stack', children: [{ group: 'names' }] });
    expect(errors(editor.spec)).toEqual([]);
  });

  test('the values the spec gives for the field move to the new key: defaults and examples, of it or around it', () => {
    const spec: Spec = {
      fields: {
        people: {
          type: 'array',
          items: { type: 'object', fields: { name: { type: 'string' }, pet: { type: 'object', fields: { name: { type: 'string' } } } } },
          default: [{ name: 'Ada', pet: { name: 'Rex' } }, { name: 'Lin' }],
          examples: [[{ name: 'Sam' }]],
        },
        boss: { type: 'object', fields: { name: { type: 'string' } }, default: { name: { $state: '/people/0/name' } } },
      },
    };
    const editor = createSpecEditor({ spec });
    expect(editor.rename('/fields/people/items/fields/name', 'called').ok).toBe(true);
    expect(editor.spec.fields.people).toMatchObject({
      default: [{ called: 'Ada', pet: { name: 'Rex' } }, { called: 'Lin' }],
      examples: [[{ called: 'Sam' }]],
    });
    expect(editor.spec.fields.boss).toMatchObject({ default: { name: { $state: '/people/0/called' } } });
    expect(editor.rename('/fields/boss/fields/name', 'title').ok).toBe(true);
    expect(editor.spec.fields.boss).toMatchObject({ default: { title: { $state: '/people/0/called' } } });
    expect(checkSpec(editor.spec)).toEqual([]);
  });

  test('can keep the old key as an alias, so stored values are still read', () => {
    const editor = createSpecEditor({ spec: account });
    editor.rename('/fields/seats', 'licences', { alias: true });
    expect(editor.spec.fields.licences).toMatchObject({ aliases: ['seats'] });
    editor.rename('/fields/licences', 'seats', { alias: true });
    expect(editor.spec.fields.seats).toMatchObject({ aliases: ['licences'] });
  });

  test('refuses a key that is taken, and one the checker refuses', () => {
    const editor = createSpecEditor({ spec: account });
    expect(editor.rename('/fields/name', 'email')).toMatchObject({ ok: false, faults: [{ path: '/fields/email' }] });
    expect(editor.rename('/fields/name', 'a/b')).toMatchObject({ ok: false });
    expect(editor.rename('/fields/missing', 'x')).toMatchObject({ ok: false, faults: [{ path: '/fields/missing' }] });
    expect(editor.spec).toBe(account);
    expect(editor.rename('/fields/name', 'name')).toEqual({ ok: true, path: '/fields/name' });
  });
});

describe('the JSON way', () => {
  test('gives the spec as text and takes edited text back', () => {
    const editor = createSpecEditor({ spec: { fields: { name: { type: 'string' } } } });
    expect(JSON.parse(editor.json())).toEqual(editor.spec);
    const edited = editor.json().replace('"string"', '"int"');
    expect(editor.applyJson(edited)).toEqual({ ok: true, path: '' });
    expect(editor.fields.nodes[0]!.kind).toBe('int');
  });

  test('keeps the last good spec when the text does not parse, and says why', () => {
    const editor = createSpecEditor({ spec: account });
    const edit = editor.applyJson('{ "fields": ');
    expect(edit.ok).toBe(false);
    expect(editor.refused?.parse).toBeString();
    expect(editor.refused?.faults).toEqual([]);
    expect(editor.spec).toBe(account);
  });

  test('keeps the last good spec when the checker finds errors, and gives them at their paths', () => {
    const editor = createSpecEditor({ spec: account });
    const edit = editor.applyJson(JSON.stringify({ fields: { size: { type: 'enum' }, n: { type: 'integer' } } }));
    expect(edit).toMatchObject({ ok: false });
    expect(editor.refused!.faults.map((f) => f.path)).toEqual(['/fields/size/options', '/fields/n/type']);
    expect(editor.applyJson('[]')).toMatchObject({ ok: false, faults: [{ path: '' }] });
    expect(editor.applyJson('')).toMatchObject({ ok: false });
    expect(editor.spec).toBe(account);
  });

  test('takes a spec with warnings, and shows them', () => {
    const editor = createSpecEditor();
    expect(editor.applyJson(JSON.stringify({ fields: { a: { type: 'string' } }, groups: { g: {} } })).ok).toBe(true);
    expect(editor.faults).toMatchObject([{ path: '/groups/g', severity: 'warning' }]);
    expect(editor.refused).toBeUndefined();
  });

  test('readSpec does the same without an editor', () => {
    expect(readSpec('{ "fields": { "a": { "type": "string" } } }')).toEqual({
      ok: true,
      spec: { fields: { a: { type: 'string' } } },
      warnings: [],
    });
    expect(readSpec('nope')).toMatchObject({ ok: false, faults: [] });
    expect(readSpec('{ "fields": { "a": {} } }')).toMatchObject({ ok: false, faults: [{ path: '/fields/a/type' }] });
  });
});

describe('the description', () => {
  const written: Spec = { fields: { name: { type: 'string', required: true } } };

  test('a spec without one has none, is not out of date, and a generate would replace its fields', () => {
    const editor = createSpecEditor({ spec: account });
    expect(editor.description).toBe('');
    expect(editor.stale).toBe(false);
    expect(editor.replaces).toEqual(Object.keys(account.fields));
    expect(createSpecEditor().replaces).toEqual([]);
  });

  test('typing one makes it out of date until a spec is written from it', async () => {
    const calls: unknown[] = [];
    const editor = createSpecEditor({
      generate: (description, spec) => {
        calls.push([description, spec]);
        return written;
      },
    });
    editor.setDescription('A name, required.');
    expect(editor.state).toMatchObject({ description: 'A name, required.', stale: true, replaces: [] });
    expect(descriptionOf(editor.spec)).toEqual({ text: 'A name, required.', of: '' });
    expect(await editor.generate()).toEqual({ ok: true, path: '' });
    expect(calls).toEqual([['A name, required.', undefined]]);
    expect(editor.state).toMatchObject({ stale: false, replaces: [], description: 'A name, required.' });
    expect(editor.spec).toEqual(withDescription(written, 'A name, required.'));
  });

  test('a hand edit makes it out of date, and a generate would then replace the fields', async () => {
    const editor = createSpecEditor({ spec: withDescription(written, 'A name, required.'), generate: () => written });
    expect(editor.state).toMatchObject({ stale: false, replaces: [] });
    editor.add('/fields', { key: 'age', decl: { type: 'int' } });
    expect(editor.state).toMatchObject({ stale: true, replaces: ['name', 'age'] });
    editor.remove('/fields/age');
    expect(editor.state).toMatchObject({ stale: false, replaces: [] });
    editor.applyJson(JSON.stringify({ ...editor.spec, title: 'People' }));
    expect(editor.state).toMatchObject({ stale: true, replaces: ['name'] });
  });

  test('typing after generating loses nothing to another generate, and revises the spec', async () => {
    const seen: (Spec | undefined)[] = [];
    const editor = createSpecEditor({
      spec: withDescription({ ...written, meta: { owner: 'billing' } }, 'A name, required.'),
      generate: (_, spec) => {
        seen.push(spec);
        return { fields: { ...written.fields, age: { type: 'int' } } };
      },
    });
    editor.setDescription('A name, required, and an age.');
    expect(editor.state).toMatchObject({ stale: true, replaces: [] });
    await editor.generate();
    expect(seen).toEqual([written]);
    expect(Object.keys(editor.spec.fields)).toEqual(['name', 'age']);
    expect(editor.spec.meta).toEqual({
      owner: 'billing',
      description: { text: 'A name, required, and an age.', of: fingerprint(editor.spec) },
    });
  });

  test('clearing the text removes the description', () => {
    const editor = createSpecEditor({ spec: withDescription(written, 'A name, required.') });
    editor.setDescription('  ');
    expect(editor.spec).toEqual(written);
    expect(editor.state).toMatchObject({ description: '', stale: false, replaces: [] });
    editor.set('/fields/name/label', 'Name');
    expect(editor.replaces).toEqual(['name']);
  });

  test('a spec the model writes with errors is refused, and the fields stay', async () => {
    const editor = createSpecEditor({
      spec: withDescription(written, 'A name, required.'),
      generate: () => ({ fields: { size: { type: 'enum' } } }),
    });
    expect(await editor.generate()).toMatchObject({ ok: false, faults: [{ path: '/fields/size/options' }] });
    expect(editor.spec.fields).toEqual(written.fields);
    expect(editor.pending).toBeUndefined();
  });

  test('nothing is generated from no description, and a failing model leaves the editor as it was', async () => {
    let fail = (_: Error) => {};
    const editor = createSpecEditor({
      spec: written,
      generate: () => new Promise<Spec>((_, reject) => (fail = reject)),
      describe: () => Promise.reject(new Error('no model')),
    });
    expect(await editor.generate()).toMatchObject({ ok: false, faults: [{ path: '/meta/description/text' }] });
    editor.setDescription('A name.');
    const generating = editor.generate();
    expect(editor.pending).toBe('generate');
    fail(new Error('no model'));
    expect(await failure(generating)).toBe('no model');
    expect(editor.pending).toBeUndefined();
    expect(editor.spec.fields).toEqual(written.fields);
    expect(await failure(editor.describe())).toBe('no model');
    expect(await failure(createSpecEditor().describe())).toContain('no `describe`');
  });

  test('describing writes the description from the spec, without its meta, and brings it in step', async () => {
    const seen: Spec[] = [];
    const editor = createSpecEditor({
      spec: { ...account, meta: { owner: 'billing' } },
      describe: (spec) => {
        seen.push(spec);
        return ' An account. ';
      },
    });
    const versions: number[] = [];
    editor.subscribe(() => versions.push(editor.version));
    expect(await editor.describe()).toEqual({ ok: true, path: '/meta/description' });
    expect(seen).toEqual([account]);
    expect(editor.state).toMatchObject({ description: 'An account.', stale: false, replaces: [] });
    expect(editor.spec.meta).toMatchObject({ owner: 'billing' });
    expect(versions.length).toBe(3);
  });

  test('a spec edited while it was being described is out of date once the description arrives', async () => {
    let finish = (_: string) => {};
    const editor = createSpecEditor({ spec: written, describe: () => new Promise<string>((resolve) => (finish = resolve)) });
    const describing = editor.describe();
    expect(editor.pending).toBe('describe');
    editor.add('/fields', { key: 'age', decl: { type: 'int' } });
    finish('A name, required.');
    await describing;
    expect(editor.state).toMatchObject({ description: 'A name, required.', stale: true, replaces: ['name', 'age'] });
    expect(isDescriptionStale(editor.spec)).toBe(true);
  });
});

describe('the state', () => {
  test('is the same object until the editor changes, and a refusal is a change', () => {
    const editor = createSpecEditor({ spec: account });
    const before = editor.state;
    expect(editor.state).toBe(before);
    editor.add('/fields', { key: 'name' });
    expect(editor.state).not.toBe(before);
    expect(editor.state.spec).toBe(account);
    expect(editor.state.refused).toBeDefined();
  });

  test('a spec it is created with is kept even with errors, which it shows; an edit must leave none', () => {
    const broken = { fields: { size: { type: 'enum' }, name: { type: 'string' } } } as unknown as Spec;
    const editor = createSpecEditor({ spec: broken });
    expect(editor.faults).toMatchObject([{ path: '/fields/size/options', severity: 'error' }]);
    expect(editor.set('/fields/name/label', 'Name').ok).toBe(false);
    expect(editor.set('/fields/size/options', ['s', 'm']).ok).toBe(true);
    expect(editor.faults).toEqual([]);
  });

  test('uses the registry it is given for kinds and checks', () => {
    const registry = createRegistry({ presets: { Money: { type: 'int', min: 0 } } });
    const editor = createSpecEditor({ registry });
    expect(editor.add('/fields', { key: 'price', decl: { use: 'Money' } }).ok).toBe(true);
    expect(editor.uses).toContain('Money');
    expect(editor.node('/fields/price')).toMatchObject({ kind: 'int', use: 'Money' });
  });
});
