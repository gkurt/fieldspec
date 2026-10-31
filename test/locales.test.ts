import { describe, expect, test } from 'bun:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  checkSpec,
  checkTranslations,
  createForm,
  createRegistry,
  define,
  fallbacksOf,
  fromJSONSchema,
  localize,
  metaSchema,
  parse,
  prompt,
  registryOf,
  texts,
  toJSONSchema,
  type Infer,
  type Messages,
  type Spec,
} from '#src/index.ts';

const service = define({
  title: 'Service',
  fields: {
    name: { type: 'string', label: 'Service name', required: true },
    region: { type: 'enum', options: ['eu-west', { value: 'us-east', label: 'US East' }] },
    contact: { use: 'email' },
    replicas: { type: 'int', min: 1 },
    domain: {
      type: 'string',
      group: 'net',
      label: { $cond: { $state: 'name', eq: '' }, $then: 'Domain', $else: { $template: 'Domain for ${name}' } },
    },
    max: {
      type: 'int',
      optional: true,
      checks: [{ assert: { $state: 'max', gte: { $state: 'replicas' } }, message: 'Fewer than it starts with' }],
    },
    source: {
      type: 'variant',
      key: 'from',
      variants: { git: { fields: { repo: { type: 'string' } } }, image: { label: 'Image', fields: {} } },
    },
    probe: { use: 'Probe' },
    code: { type: 'string', hint: { $computed: 'hintFor', args: {} } },
  },
  groups: { net: { label: 'Network' } },
  defs: { Probe: { type: 'object', label: 'Probe', fields: { path: { type: 'string' } } } },
  layouts: { tabs: { type: 'tabs', children: [{ type: 'stack', props: { title: 'Main' }, children: [{ type: 'rest' }] }] } },
  locales: {
    de: {
      '/title': 'Dienst',
      '/fields/name/label': 'Dienstname',
      '/fields/region/options/0/label': 'Europa',
      '/fields/domain/label/$else/$template': 'Domain für ${name}',
      '/fields/max/checks/0/message': 'Weniger als zu Beginn',
      '/defs/Probe/label': 'Prüfung',
    },
    'de-AT': { '/fields/name/label': 'Dienstname (AT)' },
  },
});

describe('texts', () => {
  test('every string a spec shows, by pointer, with the ones it only implies', () => {
    expect(texts(service)).toEqual({
      '/title': 'Service',
      '/fields/name/label': 'Service name',
      '/fields/region/label': 'Region',
      '/fields/region/options/0/label': 'eu-west',
      '/fields/region/options/1/label': 'US East',
      '/fields/contact/label': 'Contact',
      '/fields/contact/placeholder': 'name@example.com',
      '/fields/replicas/label': 'Replicas',
      '/fields/domain/label/$then': 'Domain',
      '/fields/domain/label/$else/$template': 'Domain for ${name}',
      '/fields/max/label': 'Max',
      '/fields/max/checks/0/message': 'Fewer than it starts with',
      '/fields/source/label': 'Source',
      '/fields/source/variants/git/label': 'git',
      '/fields/source/variants/git/fields/repo/label': 'Repo',
      '/fields/source/variants/image/label': 'Image',
      '/fields/code/label': 'Code',
      '/groups/net/label': 'Network',
      '/defs/Probe/label': 'Probe',
      '/defs/Probe/fields/path/label': 'Path',
      '/layouts/tabs/children/0/props/title': 'Main',
    });
  });
});

describe('localize', () => {
  test('a locale the spec carries, falling back from region to language', () => {
    expect(localize<Spec>(service, 'de')).toMatchObject({
      title: 'Dienst',
      fields: {
        name: { label: 'Dienstname' },
        region: {
          options: [
            { value: 'eu-west', label: 'Europa' },
            { value: 'us-east', label: 'US East' },
          ],
        },
        domain: { label: { $cond: { $state: 'name', eq: '' }, $then: 'Domain', $else: { $template: 'Domain für ${name}' } } },
      },
      defs: { Probe: { label: 'Prüfung' } },
    });
    expect(localize<Spec>(service, 'de-AT')).toMatchObject({ title: 'Dienst', fields: { name: { label: 'Dienstname (AT)' } } });
    expect(fallbacksOf('zh-Hant-TW')).toEqual(['zh-Hant-TW', 'zh-Hant', 'zh']);
  });

  test('a table of your own, first wins; the spec is not changed', () => {
    const fixed = localize<Spec>(service, [{ '/fields/name/label': 'Name des Dienstes' }, 'de']);
    expect(fixed).toMatchObject({ title: 'Dienst', fields: { name: { label: 'Name des Dienstes' } } });
    expect(service.fields.name.label).toBe('Service name');
    expect(localize(service, 'fr')).toBe(service);
  });

  test('a string inside a text applies when its table comes before the one replacing the whole', () => {
    const whole = { '/fields/domain/label': 'Adresse' };
    const leaf = { '/fields/domain/label/$then': 'Domäne' };
    expect(localize<Spec>(service, [whole, leaf]).fields.domain?.label).toBe('Adresse');
    expect(localize<Spec>(service, [leaf, whole]).fields.domain?.label).toMatchObject({ $then: 'Domäne' });
  });

  test('only text: other pointers are ignored', () => {
    const out = localize(service, [{ '/fields/name/type': 'int', '/fields/nope/label': 'x' }]);
    expect(out.fields.name.type).toBe('string');
    expect(out.fields).not.toHaveProperty('nope');
  });

  test('keeps the registry, the functions and the type', () => {
    const registry = createRegistry({});
    const fns = { hintFor: () => 'h' };
    const spec = registry.define({ fields: { a: { type: 'int', hint: { $computed: 'hintFor' } } } }, { fns });
    const out = localize(spec, [{ '/fields/a/label': 'A!' }]);
    expect(registryOf(out)).toBe(registry);
    expect(createForm(out).field('/a')?.hint).toBe('h');
    const typed: Infer<typeof out> = { a: 1 };
    expect(typed.a).toBe(1);
  });
});

describe('forms and issues', () => {
  test('a form in a locale shows its text', () => {
    const form = createForm(service, { locale: 'de', values: { replicas: 3, max: 2 } });
    expect(form.locale).toBe('de');
    expect(form.field('/name')?.label).toBe('Dienstname');
    expect(form.field('/region')?.options?.map((o) => o.label)).toEqual(['Europa', 'US East']);
    expect(form.field('/max')?.issues.map((i) => i.message)).toEqual(['Weniger als zu Beginn']);
  });

  const german: Messages = (issue) => {
    switch (issue.code) {
      case 'required':
        return 'ist erforderlich';
      case 'min':
        return `muss mindestens ${String(issue.params.min)} sein`;
      default:
        return undefined;
    }
  };

  test("the library's own messages carry params, and `messages` says them another way", () => {
    const result = parse(service, { replicas: 0, max: 0 }, { messages: german });
    expect(result.issues).toEqual([
      { path: '/name', code: 'required', message: 'ist erforderlich', params: {} },
      { path: '/replicas', code: 'min', message: 'muss mindestens 1 sein', params: { min: 1 } },
    ]);
    const form = createForm(service, { values: { replicas: 3, max: 2 }, messages: german });
    expect(form.field('/max')?.issues).toEqual([{ path: '/max', code: 'check', message: 'Fewer than it starts with' }]);
  });

  test('a message the spec writes has no params', () => {
    const spec = define({ fields: { slug: { type: 'string', pattern: '[a-z]+', patternMessage: 'Lowercase only' } } });
    expect(parse(spec, { slug: 'A' }).issues).toEqual([{ path: '/slug', code: 'pattern', message: 'Lowercase only' }]);
    const named = define({ fields: { slug: { type: 'string', pattern: '[a-z]+' } } });
    expect(parse(named, { slug: 'A' }).issues[0]!.params).toEqual({ pattern: '[a-z]+', name: 'slug' });
  });
});

describe('checking translations', () => {
  test("a spec's locales are checked with it", () => {
    expect(checkSpec(service).filter((f) => f.severity === 'error')).toEqual([]);
    const faults = checkSpec({
      fields: { name: { type: 'string', label: { $template: 'Name of ${kind}' } }, kind: { type: 'string' } },
      locales: {
        de: {
          '/fields/nmae/label': 'Name',
          '/fields/name/type': 'x',
          '/fields/name/label/$template': 'Name von ${kind} und ${other}',
        },
        'not a tag': {},
        fr: { '/fields/kind/label': 5 },
      },
    });
    expect(faults.map((f) => [f.path, f.severity])).toEqual([
      ['/locales/de/~1fields~1nmae~1label', 'error'],
      ['/locales/de/~1fields~1name~1type', 'error'],
      ['/locales/de/~1fields~1name~1label~1$template', 'error'],
      ['/locales/de', 'warning'],
      ['/locales/not a tag', 'error'],
      ['/locales/not a tag', 'warning'],
      ['/locales/fr/~1fields~1kind~1label', 'error'],
      ['/locales/fr', 'warning'],
    ]);
    expect(faults[0]!.message).toContain('Did you mean "/fields/name/label"?');
    expect(faults[2]!.message).toContain('reads "other"');
    expect(faults[3]!.message).toContain('leaves 1 of 2 texts as written: /fields/kind/label');
  });

  test('a table of your own, and fallbacks covering what it leaves', () => {
    expect(checkTranslations(service, service.locales['de-AT'], { fallbacks: [service.locales.de] }).map((f) => f.message)).toEqual([
      expect.stringContaining('leaves 15 of 21 texts as written'),
    ]);
    expect(checkTranslations(service, [], { at: '/x' })).toEqual([
      { path: '/x', message: 'must be an object from JSON Pointers into the spec to the text in their place', severity: 'error' },
    ]);
  });

  test('the meta-schema, JSON Schema and the prompt know them', () => {
    const valid = new Ajv2020({ strict: false }).compile(metaSchema());
    expect(valid(service)).toBe(true);
    expect(valid({ fields: {}, locales: { de: { 'fields/a/label': 'x' } } })).toBe(false);
    expect(fromJSONSchema(toJSONSchema(service)).locales).toEqual(service.locales);
    expect(prompt()).toContain('## Translations (`locales`)');
  });
});
