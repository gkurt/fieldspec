/** A spec's `meta`, the description kept there, and the fingerprint that says whether the two still match. */
import { describe, expect, test } from 'bun:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  checkSpec,
  commonFields,
  createForm,
  descriptionOf,
  encode,
  fingerprint,
  fromJSONSchema,
  isDescriptionStale,
  localize,
  metaSchema,
  migrate,
  parse,
  stampDescription,
  toJSONSchema,
  withDescription,
  type Spec,
} from '#src/index.ts';

const plain: Spec = {
  fields: {
    name: { type: 'string', required: true },
    seats: { type: 'int', min: 1, default: 1 },
  },
};
const text = 'A name, required, and a number of seats, at least 1 and 1 by default.';
const described = withDescription(plain, text);

describe('meta', () => {
  test('the checker takes meta, with a description and keys of the application', () => {
    expect(checkSpec({ ...described, meta: { ...described.meta, owner: 'billing', tags: ['a'] } })).toEqual([]);
  });

  test('the checker reports a meta or a description of the wrong shape, at its path', () => {
    expect(checkSpec({ ...plain, meta: 'notes' }).map((f) => f.path)).toEqual(['/meta']);
    expect(checkSpec({ ...plain, meta: { description: 'A name.' } }).map((f) => f.path)).toEqual(['/meta/description']);
    expect(checkSpec({ ...plain, meta: { description: { of: 'x' } } }).map((f) => f.path)).toEqual(['/meta/description/text']);
    expect(checkSpec({ ...plain, meta: { description: { text: 'A name.', by: 'me' } } }).map((f) => f.path)).toEqual([
      '/meta/description/by',
    ]);
  });

  test('the published schema takes meta', () => {
    const validate = new Ajv2020({ strict: false }).compile(metaSchema());
    expect(validate(described)).toBe(true);
    expect(validate({ ...plain, meta: { description: { of: 'x' } } })).toBe(false);
  });

  test('values mean the same with and without meta', () => {
    const input = { name: 'Ada' };
    expect(parse(described, input)).toEqual(parse(plain, input));
    expect(encode(described, { name: 'Ada', seats: 2 })).toEqual(encode(plain, { name: 'Ada', seats: 2 }));
    expect(createForm(described, { values: input }).json()).toEqual(createForm(plain, { values: input }).json());
    expect(createForm(described).layout()).toEqual(createForm(plain).layout());
  });

  test('migrations run the same with meta', () => {
    const versioned: Spec = { ...plain, version: 2, migrations: { '2': [{ op: 'move', from: '/title', path: '/name' }] } };
    const stored = { title: 'Ada' };
    expect(migrate(withDescription(versioned, text), stored)).toEqual(migrate(versioned, stored));
  });

  test('JSON Schema carries meta as x-meta and gives it back', () => {
    const schema = toJSONSchema(described);
    expect(schema['x-meta']).toEqual(described.meta);
    const { 'x-meta': _, ...bare } = schema;
    expect(bare).toEqual(toJSONSchema(plain));
    expect(fromJSONSchema(schema).meta).toEqual(described.meta);
    expect(fingerprint(fromJSONSchema(schema))).toBe(fingerprint(fromJSONSchema(toJSONSchema(plain))));
  });

  test('a translated spec keeps its meta, and the fields several specs share have none', () => {
    const localized = localize({ ...described, locales: { de: { '/fields/name/label': 'Name' } } }, 'de');
    expect(localized.meta).toEqual(described.meta);
    expect(commonFields([described, described]).spec.meta).toBeUndefined();
  });
});

describe('fingerprint', () => {
  test('is the same for the same spec, whatever the order of its keys', () => {
    const reordered: Spec = {
      fields: {
        seats: { default: 1, min: 1, type: 'int' },
        name: { required: true, type: 'string' },
      },
    };
    expect(fingerprint(plain)).toBe(fingerprint(structuredClone(plain)));
    expect(fingerprint(reordered)).toBe(fingerprint(plain));
  });

  test('leaves out meta and $schema', () => {
    expect(fingerprint(described)).toBe(fingerprint(plain));
    expect(fingerprint({ ...plain, meta: { owner: 'billing' } })).toBe(fingerprint(plain));
    expect(fingerprint({ $schema: 'https://unpkg.com/fieldspec@0.1.0/schema/spec.json', ...plain })).toBe(fingerprint(plain));
  });

  test('changes with anything else of the spec', () => {
    const prints = [
      plain,
      { ...plain, title: 'Team' },
      { ...plain, fieldspec: 1 },
      { fields: { ...plain.fields, name: { type: 'string' } } },
      { fields: { ...plain.fields, seats: { type: 'int', min: 2, default: 2 } } },
      { fields: { ...plain.fields, name: { type: 'string', required: true, meta: { column: 'a' } } } },
      { fields: { name: plain.fields.name } },
    ].map(fingerprint);
    expect(new Set(prints).size).toBe(prints.length);
  });

  test('keeps the order of a list, which is part of what a spec says', () => {
    const options = (list: string[]): Spec => ({ fields: { size: { type: 'enum', options: list } } });
    expect(fingerprint(options(['s', 'm']))).not.toBe(fingerprint(options(['m', 's'])));
  });

  test('takes anything, so a store that holds no spec yet has a fingerprint too', () => {
    expect(fingerprint(null)).toBe(fingerprint(undefined));
    expect(fingerprint(null)).not.toBe(fingerprint({ fields: {} }));
  });
});

describe('a description', () => {
  test('a spec without one has none and is never out of date', () => {
    expect(descriptionOf(plain)).toBeUndefined();
    expect(isDescriptionStale(plain)).toBe(false);
    expect(isDescriptionStale(null)).toBe(false);
    expect(descriptionOf({ ...plain, meta: { owner: 'billing' } })).toBeUndefined();
  });

  test('a text is stamped with the spec it is kept with, and stays in step until the spec changes', () => {
    expect(descriptionOf(described)).toEqual({ text, of: fingerprint(plain) });
    expect(isDescriptionStale(described)).toBe(false);
    const edited: Spec = { ...described, fields: { ...described.fields, plan: { type: 'enum', options: ['free', 'pro'] } } };
    expect(isDescriptionStale(edited)).toBe(true);
    const { plan: _, ...fields } = edited.fields;
    expect(isDescriptionStale({ ...edited, fields })).toBe(false);
  });

  test('one that names no spec yet is not out of date, and stamping gives it the spec', () => {
    const unstamped: Spec = { ...plain, meta: { description: { text } } };
    expect(isDescriptionStale(unstamped)).toBe(false);
    expect(stampDescription(unstamped, { text })).toEqual({ text, of: fingerprint(plain) });
    expect(stampDescription(plain, text)).toEqual({ text, of: fingerprint(plain) });
  });

  test('one that names a spec keeps it when stamped, so it stays out of date with a changed spec', () => {
    const other = { text, of: fingerprint({ fields: {} }) };
    expect(stampDescription(plain, other)).toBe(other);
    expect(isDescriptionStale(plain, other)).toBe(true);
    expect(isDescriptionStale(withDescription(plain, other))).toBe(true);
  });

  test('an empty stamp matches no spec: a text typed since, that wrote nothing yet', () => {
    expect(isDescriptionStale(withDescription(plain, { text, of: '' }))).toBe(true);
  });

  test('withDescription keeps the rest of meta and removes an empty one', () => {
    const owned: Spec = { ...plain, meta: { owner: 'billing' } };
    expect(withDescription(owned, text).meta).toEqual({ owner: 'billing', description: { text, of: fingerprint(plain) } });
    expect(withDescription(withDescription(owned, text), undefined)).toEqual(owned);
    expect(withDescription(described, undefined)).toEqual(plain);
    expect('meta' in withDescription(described, undefined)).toBe(false);
  });
});
