/**
 * Random specs, seeded: every kind, definitions that use each other (in rings too), groups with
 * random parents, renders that place random fields and groups, conditions, defaults, checks and
 * `$cel` over random pointers, translations of random texts, migrations over random paths, and
 * values that only sometimes fit (and say random versions). Many are invalid on purpose; the
 * checker must say so, and nothing may hang either way.
 */
import { createCel } from '#src/cel.ts';
import { createRegistry, type FieldDecl, type MigrationOp, type RenderNode, type Spec } from '#src/index.ts';
import { random } from './harness.ts';

/** The registry random specs are defined through: the core one, running `$cel`. */
const registry = createRegistry({ languages: [createCel()] });

type R = ReturnType<typeof random>;

const LEAVES = ['string', 'number', 'int', 'boolean', 'enum', 'date', 'bigint', 'url', 'regexp', 'bytes', 'json'] as const;
const PRESETS = ['percent', 'email', 'port', 'color', 'password'];
const CONTAINERS = ['stack', 'row', 'columns', 'collapsible', 'scroll', 'tabs'];
/** CEL over args `a` and `b`: some fit any type, some only some, some do not parse. */
const CEL = [
  'a',
  'a == b',
  'a != null',
  'size(a) > 0',
  'a > 1',
  'a + b',
  'a ? 1 : 2',
  "string(a) + 'x'",
  'has(a.x)',
  'a.exists(v, v == b)',
  'oops ((',
  '',
];
const CONTROLS = [
  'input',
  'textarea',
  'select',
  'radio',
  'segmented',
  'checkbox',
  'switch',
  'slider',
  'date',
  'color',
  'checks',
  'list',
  'entries',
  'variant',
  'fields',
];

export function randomSpec(seed: number): { spec: Spec; values: unknown } {
  const r = random(seed);
  const defNames = Array.from({ length: r.int(5) }, (_, i) => `D${i}`);
  const g = new Gen(r, defNames);
  const defs = Object.fromEntries(
    defNames.map((name) => [name, r.chance(0.15) ? { use: r.pick([...defNames, 'Nope']) } : g.field(1, true)]),
  );
  const fields = g.fields(0);
  const version = r.chance(0.3) ? 1 + r.int(4) : undefined;
  const spec: Spec = {
    fields,
    ...(defNames.length > 0 && { defs }),
    ...(r.chance(0.6) && { groups: g.groups(Object.keys(fields)) as Spec['groups'] }),
    ...(r.chance(0.4) && { layouts: { main: g.render(Object.keys(fields), 0), other: g.render(Object.keys(fields), 0) } }),
    ...(version !== undefined && { version }),
    ...(version !== undefined && r.chance(0.9) && { migrations: g.migrations(Object.keys(fields), version) }),
  };
  const values = g.value(spec.fields, 0) as Record<string, unknown>;
  if (r.chance(version === undefined ? 0.05 : 0.6)) values.$version = r.pick<unknown>([1, 1, 2, version ?? 1, (version ?? 1) + 1, 'x', 0]);
  if (r.chance(0.3)) Object.assign(spec, { locales: g.locales(spec) });
  return { spec: registry.define(spec), values };
}

class Gen {
  /** Keys in the scope being built, for pointers and renders to name. */
  private keys: string[] = [];
  private groupIds = ['g0', 'g1', 'g2'];

  readonly r: R;
  readonly defs: string[];
  constructor(r: R, defs: string[]) {
    this.r = r;
    this.defs = defs;
  }

  fields(depth: number): Record<string, FieldDecl> {
    const n = 1 + this.r.int(depth === 0 ? 7 : 4);
    const keys = Array.from({ length: n }, (_, i) => `${this.r.pick(['a', 'b', 'c', 'name', 'on', 'x'])}${i}`);
    const outer = this.keys;
    this.keys = keys;
    const out = Object.fromEntries(keys.map((k) => [k, this.field(depth + 1)]));
    this.keys = outer;
    return out;
  }

  field(depth: number, _inDef = false): FieldDecl {
    const r = this.r;
    const base: Record<string, unknown> = {};
    if (r.chance(0.2)) base.optional = true;
    if (r.chance(0.15)) base.visible = this.condition(0);
    if (r.chance(0.1)) base.enabled = this.condition(0);
    if (r.chance(0.1)) base.required = this.condition(0);
    if (r.chance(0.2)) base.group = r.pick([...this.groupIds, 'nope']);
    if (r.chance(0.15))
      base.label = r.pick<unknown>(['Label', { $template: `\${${this.pointer()}} and \${${this.pointer()}}` }, this.cel()]);
    if (r.chance(0.1))
      base.default = r.pick<unknown>([{ $state: this.pointer() }, this.cel(), r.pick<unknown>([0, '', 'x', true, [], {}, null])]);
    if (r.chance(0.15)) base.checks = this.checks();

    const roll = r.next();
    if (this.defs.length > 0 && (roll < 0.15 || (depth > 3 && roll < 0.5))) return { ...base, use: r.pick(this.defs) };
    if (roll < 0.2) return { ...base, use: r.pick(PRESETS) };
    if (depth > 3 || roll < 0.6) {
      const type = r.pick(LEAVES);
      const decl: Record<string, unknown> = { ...base, type };
      if (type === 'enum') {
        decl.options = r.chance(0.8)
          ? r.pick([
              ['a', 'b'],
              [1, 2, 3],
              [{ value: 'x', label: 'X', visible: this.condition(0) }, 'y'],
            ])
          : { $state: this.pointer() };
      }
      if (type === 'int' || type === 'number') Object.assign(decl, r.chance(0.3) ? { min: 0, max: 10 } : {});
      if (type === 'string' && r.chance(0.2)) decl.pattern = '^[a-z]*$';
      if (r.chance(0.3)) decl.render = r.pick(CONTROLS);
      return decl as FieldDecl;
    }
    const container = r.pick(['array', 'set', 'record', 'map', 'object', 'object', 'variant']);
    switch (container) {
      case 'array':
      case 'set':
        return {
          ...base,
          type: container,
          items: this.field(depth + 1),
          ...(r.chance(0.2) && { render: r.pick(['list', 'checks']) }),
        };
      case 'record':
        return { ...base, type: 'record', values: this.field(depth + 1) };
      case 'map':
        return { ...base, type: 'map', keys: { type: r.pick(['string', 'int']) }, values: this.field(depth + 1) };
      case 'object': {
        const fields = this.fields(depth);
        return {
          ...base,
          type: 'object',
          fields,
          ...(r.chance(0.3) && { groups: this.groups(Object.keys(fields)) }),
          ...(r.chance(0.3) && { render: this.render(Object.keys(fields), 0) }),
          ...(r.chance(0.2) && { unknown: r.pick(['error', 'strip', 'keep']) }),
        };
      }
      default:
        return {
          ...base,
          type: 'variant',
          key: r.pick(['kind', 'type', 'a0']),
          variants: Object.fromEntries(
            ['one', 'two', 'three'].slice(0, 1 + r.int(3)).map((n) => [n, { label: n, fields: this.fields(depth) }]),
          ),
        };
    }
  }

  groups(keys: string[]): Record<string, unknown> {
    const r = this.r;
    return Object.fromEntries(
      this.groupIds.map((id) => [
        id,
        {
          label: id.toUpperCase(),
          ...(r.chance(0.3) && { group: r.pick([...this.groupIds, 'nope']) }),
          ...(r.chance(0.3) && { visible: this.condition(0) }),
          ...(r.chance(0.5) && { render: r.chance(0.5) ? r.pick(CONTAINERS) : this.render(keys, 1) }),
        },
      ]),
    );
  }

  render(keys: string[], depth: number): RenderNode {
    const r = this.r;
    const roll = r.next();
    if (depth > 2 || roll < 0.3) {
      return r.pick<RenderNode>([
        { field: r.pick([...keys, 'nope', `${r.pick(keys)}/x`]) },
        { group: r.pick([...this.groupIds, 'nope']) },
        { type: 'rest' },
        { type: 'text', props: { text: 'Hi' } },
        'divider',
        { type: 'errors', props: { fields: keys.slice(0, 2) } },
        { type: 'label', props: { field: r.pick(keys) } },
        { type: r.pick(CONTROLS), props: { field: r.pick(keys) } },
      ]);
    }
    const type = r.pick(CONTAINERS);
    return {
      type,
      ...(r.chance(0.3) && { props: { title: 'T', ...(type === 'scroll' && { maxHeight: r.pick([100, '10rem', 'bad']) }) } }),
      ...(r.chance(0.2) && { visible: this.condition(0) }),
      ...(r.chance(0.85) && { children: Array.from({ length: r.int(4) }, () => this.render(keys, depth + 1)) }),
    } as RenderNode;
  }

  /** A `$cel` expression over two random pointers, or a broken one. */
  cel(): unknown {
    const r = this.r;
    const args = r.chance(0.9)
      ? { a: { $state: this.pointer() }, b: r.pick<unknown>([{ $state: this.pointer() }, 1, 'x', null]) }
      : undefined;
    return { $cel: r.pick(CEL), ...(args && { args }) };
  }

  checks(): unknown {
    const r = this.r;
    return Array.from({ length: 1 + r.int(3) }, () => ({
      assert: this.condition(0),
      message: r.pick<unknown>(['Bad', { $template: `Not \${${this.pointer()}}` }, this.cel(), 3]),
      ...(r.chance(0.2) && { code: r.pick<unknown>(['custom', 'min', '']) }),
    }));
  }

  /**
   * Migrations to `version` over the top-level keys and keys that are gone: moves, copies,
   * removes, adds and replaces, with `*` and expression values. Sometimes keyed past the version.
   */
  migrations(keys: string[], version: number): Record<string, MigrationOp[]> {
    const r = this.r;
    const path = () => {
      const key = r.pick([...keys, 'old', 'gone']);
      return r.pick([`/${key}`, `/${key}/*`, `/${key}/*/a0`, `/${key}/x`, '/*', `/${key}/-`, `/${key}/0`, '', 'bad']);
    };
    const value = () => r.pick<unknown>([1, 'x', null, [], {}, { $state: this.pointer() }, { $state: `../${r.pick(keys)}` }, this.cel()]);
    const op = (): MigrationOp => {
      switch (r.int(6)) {
        case 0:
          return { op: 'move', from: path(), path: path() };
        case 1:
          return { op: 'copy', from: path(), path: path() };
        case 2:
          return { op: 'remove', path: path() };
        case 3:
          return { op: 'replace', path: path(), value: value() } as MigrationOp;
        case 4:
          return { op: 'add', path: path(), value: value() } as MigrationOp;
        default:
          return r.pick<unknown>([{ op: 'test', path: path() }, { op: 'move', path: path() }, 'move']) as MigrationOp;
      }
    };
    const out: Record<string, MigrationOp[]> = {};
    for (let v = 2; v <= version + (r.chance(0.1) ? 1 : 0); v++) out[String(v)] = Array.from({ length: r.int(4) }, op);
    if (r.chance(0.05)) out.x = [op()];
    return out;
  }

  /** Translations of texts the spec has, implies and lacks, some of them expressions, in tags good and bad. */
  locales(spec: Spec): Record<string, Record<string, unknown>> {
    const r = this.r;
    const keys = Object.keys(spec.fields);
    const pointers = () => {
      const key = r.pick([...keys, 'nope']);
      return r.pick([
        `/fields/${key}/label`,
        `/fields/${key}/description`,
        `/fields/${key}/hint`,
        `/fields/${key}/label/$template`,
        `/fields/${key}/options/0/label`,
        `/fields/${key}/checks/0/message`,
        `/fields/${key}/fields/a0/label`,
        `/fields/${key}/items/label`,
        `/fields/${key}/type`,
        `/groups/${r.pick(this.groupIds)}/label`,
        '/title',
        '',
        'nope',
      ]);
    };
    const table = () =>
      Object.fromEntries(
        Array.from({ length: r.int(6) }, () => [
          pointers(),
          r.pick<unknown>(['Übersetzt', '', { $template: `\${${this.pointer()}} übersetzt` }, this.cel(), 3, null]),
        ]),
      );
    return Object.fromEntries(r.pick([['de'], ['de', 'de-AT'], ['pt-BR', 'fr'], ['bad tag'], []]).map((tag) => [tag, table()]));
  }

  pointer(): string {
    const r = this.r;
    const key = this.keys.length > 0 ? r.pick(this.keys) : 'x';
    return r.pick([key, `/${key}`, `../${key}`, `../../${key}`, `${key}/a0`, '', '/', '~x/~1']);
  }

  condition(depth: number): unknown {
    const r = this.r;
    const roll = r.next();
    if (depth < 3 && roll < 0.2) return { [r.pick(['$and', '$or'])]: [this.condition(depth + 1), this.condition(depth + 1)] };
    if (roll < 0.25) return r.chance(0.5);
    if (roll < 0.35) return this.cel();
    const source = r.pick<unknown>([{ $state: this.pointer() }, { $state: this.pointer() }, { $item: '' }, { $index: true }]) as Record<
      string,
      unknown
    >;
    if (r.chance(0.6))
      source[r.pick(['eq', 'neq', 'gt', 'lt', 'in'])] = r.pick<unknown>(['a', 1, true, ['a', 1], { $state: this.pointer() }]);
    if (r.chance(0.1)) source.not = true;
    return source;
  }

  /** A value for these fields: mostly fitting, sometimes not. */
  value(fields: Record<string, FieldDecl>, depth: number): unknown {
    const r = this.r;
    const out: Record<string, unknown> = {};
    for (const [key, decl] of Object.entries(fields)) if (r.chance(0.7)) out[key] = this.valueOf(decl, depth + 1);
    if (r.chance(0.1)) out.extra = 1;
    return out;
  }

  private valueOf(decl: FieldDecl, depth: number): unknown {
    const r = this.r;
    if (r.chance(0.08) || depth > 6) return r.pick<unknown>([null, 'x', 3, [], {}, true]);
    switch (decl.type) {
      case 'string':
        return 's';
      case 'number':
      case 'int':
        return r.int(20);
      case 'boolean':
        return r.chance(0.5);
      case 'enum':
        return r.pick(['a', 1, 'x', 'nope']);
      case 'date':
        return '2024-02-03';
      case 'bigint':
        return '12';
      case 'url':
        return 'https://example.com';
      case 'array':
      case 'set':
        return Array.from({ length: r.int(4) }, () => this.valueOf((decl as { items: FieldDecl }).items, depth + 1));
      case 'record':
        return Object.fromEntries(
          Array.from({ length: r.int(3) }, (_, i) => [`k${i}`, this.valueOf((decl as { values: FieldDecl }).values, depth + 1)]),
        );
      case 'map':
        return Array.from({ length: r.int(3) }, (_, i) => [i, this.valueOf((decl as { values: FieldDecl }).values, depth + 1)]);
      case 'object':
        return this.value((decl as { fields: Record<string, FieldDecl> }).fields, depth);
      case 'variant': {
        const v = decl as { key: string; variants: Record<string, { fields: Record<string, FieldDecl> }> };
        const name = r.pick(Object.keys(v.variants));
        return { ...(this.value(v.variants[name]!.fields, depth) as object), [v.key]: name };
      }
      case undefined:
      default:
        return r.chance(0.5) ? {} : { a0: 's', b1: [{}] };
    }
  }
}
