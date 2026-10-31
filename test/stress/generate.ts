/**
 * Random specs, seeded: every kind, definitions that use each other (in rings too), groups with
 * random parents, renders that place random fields and groups, conditions and defaults over
 * random pointers, and values that only sometimes fit. Many are invalid on purpose; the
 * checker must say so, and nothing may hang either way.
 */
import type { FieldDecl, RenderNode, Spec } from '#src/index.ts';
import { random } from './harness.ts';

type R = ReturnType<typeof random>;

const LEAVES = ['string', 'number', 'int', 'boolean', 'enum', 'date', 'bigint', 'url', 'regexp', 'bytes', 'json'] as const;
const PRESETS = ['percent', 'email', 'port', 'color', 'password'];
const CONTAINERS = ['stack', 'row', 'columns', 'collapsible', 'scroll', 'tabs'];
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
  const spec: Spec = {
    fields,
    ...(defNames.length > 0 && { defs }),
    ...(r.chance(0.6) && { groups: g.groups(Object.keys(fields)) as Spec['groups'] }),
    ...(r.chance(0.4) && { layouts: { main: g.render(Object.keys(fields), 0), other: g.render(Object.keys(fields), 0) } }),
  };
  return { spec, values: g.value(spec.fields, 0) };
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
    if (r.chance(0.15)) base.label = r.chance(0.5) ? 'Label' : { $template: `\${${this.pointer()}} and \${${this.pointer()}}` };
    if (r.chance(0.1)) base.default = r.chance(0.5) ? { $state: this.pointer() } : r.pick<unknown>([0, '', 'x', true, [], {}, null]);

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
