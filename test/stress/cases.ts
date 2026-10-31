/**
 * Specs written to find endless loops and blow-ups: definitions that use themselves every way
 * the format allows (and ways it does not), groups and renders that refer to themselves,
 * defaults that read each other, very deep and very wide specs, and deep values.
 */
import type { FieldDecl, Spec } from '#src/index.ts';

export interface Case {
  readonly name: string;
  readonly spec: Spec;
  readonly values?: unknown;
  /** Whether the checker must accept it, reject it, or either. */
  readonly expect?: 'valid' | 'invalid';
  /** A spec whose drawing is huge on purpose: walks of its layout are stopped, not failed. */
  readonly huge?: boolean;
}

/** `n` objects nested inline, each one level deeper. */
function nested(n: number, leaf: FieldDecl = { type: 'string' }): FieldDecl {
  let decl = leaf;
  for (let i = 0; i < n; i++) decl = { type: 'object', fields: { a: decl } };
  return decl;
}

/** A value `n` levels deep down `key`. */
function deepValue(n: number, key: string, leaf: unknown = {}): unknown {
  let v = leaf;
  for (let i = 0; i < n; i++) v = { [key]: v };
  return v;
}

/** Definitions D0…Dn, each using the next twice: a chain whose paths double at each step. */
function diamonds(n: number, optional: boolean): Spec['defs'] {
  const defs: Record<string, FieldDecl> = {};
  for (let i = 0; i < n; i++) {
    const next = i + 1 < n ? { use: `D${i + 1}` } : { type: 'string' };
    defs[`D${i}`] = {
      type: 'object',
      fields: { l: { ...next, ...(optional && { optional: true }) }, r: { ...next, ...(optional && { optional: true }) } },
    } as FieldDecl;
  }
  return defs;
}

const tree: Spec['defs'] = {
  Tree: { type: 'object', fields: { name: { type: 'string' }, children: { type: 'array', items: { use: 'Tree' } } } },
};

export const CASES: Case[] = [
  // ── Definitions ──────────────────────────────────────────────────────────────────────────
  { name: 'a definition that is itself', spec: { fields: { x: { use: 'A' } }, defs: { A: { use: 'A' } } }, expect: 'invalid' },
  {
    name: 'definitions naming each other',
    spec: { fields: { x: { use: 'A' } }, defs: { A: { use: 'B' }, B: { use: 'C' }, C: { use: 'A' } } },
    expect: 'invalid',
  },
  { name: 'an unknown definition', spec: { fields: { x: { use: 'Nope' }, y: { use: 'nope' } } }, expect: 'invalid' },
  {
    name: 'an object that requires itself',
    spec: { fields: { x: { use: 'Node' } }, defs: { Node: { type: 'object', fields: { next: { use: 'Node' } } } } },
    expect: 'invalid',
  },
  {
    name: 'two objects requiring each other',
    spec: {
      fields: { x: { use: 'A' } },
      defs: { A: { type: 'object', fields: { b: { use: 'B' } } }, B: { type: 'object', fields: { a: { use: 'A' } } } },
    },
    expect: 'invalid',
  },
  {
    name: 'a variant whose first variant requires itself',
    spec: {
      fields: { x: { use: 'V' } },
      defs: { V: { type: 'variant', key: 'kind', variants: { more: { fields: { next: { use: 'V' } } }, end: { fields: {} } } } },
    },
    expect: 'invalid',
  },
  {
    name: 'recursion through every container',
    spec: {
      fields: { root: { use: 'R' } },
      defs: {
        R: {
          type: 'object',
          fields: {
            list: { type: 'array', items: { use: 'R' } },
            set: { type: 'set', items: { use: 'R' } },
            record: { type: 'record', values: { use: 'R' } },
            map: { type: 'map', keys: { type: 'string' }, values: { use: 'R' } },
            maybe: { use: 'R', optional: true },
            withDefault: { use: 'R', default: {} },
            either: { type: 'variant', key: 'k', variants: { leaf: { fields: {} }, branch: { fields: { r: { use: 'R' } } } } },
          },
        },
      },
    },
    values: {
      root: {
        list: [{ list: [{}], record: { a: { maybe: {} } } }],
        map: { k: { either: { k: 'branch', r: { either: { k: 'leaf' } } } } },
        maybe: { maybe: { maybe: {} } },
      },
    },
    expect: 'valid',
  },
  {
    name: 'mutual recursion through lists',
    spec: {
      fields: { a: { use: 'A' } },
      defs: {
        A: { type: 'object', fields: { bs: { type: 'array', items: { use: 'B' } } } },
        B: {
          type: 'object',
          fields: { as: { type: 'array', items: { use: 'A' } }, label: { type: 'string', default: { $template: '${../../../label}!' } } },
        },
      },
    },
    values: { a: { bs: [{ as: [{ bs: [{}] }] }] } },
    expect: 'valid',
  },
  // React commits recursively, one call per element, so a form some hundreds of levels deep overflows React itself.
  {
    name: 'a tree 120 levels deep in its values',
    spec: { fields: { t: { use: 'Tree' } }, defs: tree },
    values: { t: deepTree(120) },
    expect: 'valid',
  },
  {
    name: 'an optional chain 400 deep in its values',
    spec: {
      fields: { n: { use: 'N' } },
      defs: { N: { type: 'object', fields: { next: { use: 'N', optional: true }, v: { type: 'int', default: 1 } } } },
    },
    values: { n: deepValue(400, 'next') },
    expect: 'valid',
  },
  // Drawn whole, these are 2^40 fields: json-render output stops at its limit, and a walk is stopped by its caller.
  { name: 'doubling definitions, optional', spec: { fields: { x: { use: 'D0' } }, defs: diamonds(40, true) }, expect: 'valid', huge: true },
  {
    name: 'doubling definitions, required',
    spec: { fields: { x: { use: 'D0', optional: true } }, defs: diamonds(40, false) },
    expect: 'valid',
    huge: true,
  },
  {
    name: 'a recursive definition in every spec, differing',
    spec: { fields: { t: { use: 'Tree' }, u: { use: 'Tree', label: 'U' } }, defs: tree },
    values: { t: { children: [{ name: 'a' }] } },
    expect: 'valid',
  },

  // ── Groups and renders ───────────────────────────────────────────────────────────────────
  { name: 'a group in itself', spec: { fields: { a: { type: 'string', group: 'g' } }, groups: { g: { group: 'g' } } }, expect: 'invalid' },
  {
    name: 'groups nested in a cycle',
    spec: { fields: { a: { type: 'string', group: 'g' } }, groups: { g: { group: 'h' }, h: { group: 'i' }, i: { group: 'g' } } },
    expect: 'invalid',
  },
  {
    name: 'a group whose render places itself',
    spec: { fields: { a: { type: 'string', group: 'g' } }, groups: { g: { render: { type: 'stack', children: [{ group: 'g' }] } } } },
  },
  {
    name: 'two groups whose renders place each other',
    spec: {
      fields: { a: { type: 'string', group: 'g' }, b: { type: 'string', group: 'h' } },
      groups: {
        g: { render: { type: 'row', children: [{ group: 'h' }, { type: 'rest' }] } },
        h: { render: { type: 'row', children: [{ type: 'group', props: { group: 'g' } }] } },
      },
    },
  },
  {
    name: 'a layout placing a field and group many times',
    spec: {
      fields: { a: { type: 'string', group: 'g' }, b: { type: 'int' } },
      groups: { g: { label: 'G' } },
      layouts: {
        v: {
          type: 'stack',
          children: [
            { field: 'a' },
            { field: 'a' },
            { group: 'g' },
            { group: 'g' },
            { type: 'rest' },
            { type: 'rest' },
            { type: 'row', children: [{ type: 'rest' }] },
          ],
        },
      },
    },
  },
  {
    name: 'a field whose render tries to place fields',
    spec: {
      fields: {
        a: {
          type: 'string',
          render: { type: 'row', children: [{ field: 'a' }, { group: 'g' }, { type: 'field', props: { field: 'a' } }, 'rest'] },
        },
      },
      groups: { g: {} },
    },
    expect: 'invalid',
  },
  {
    name: 'an object whose render places its own fields by deep pointer',
    spec: {
      fields: {
        o: {
          type: 'object',
          fields: { p: { type: 'object', fields: { q: { type: 'string' } } } },
          render: { type: 'columns', children: [{ field: 'p/q' }, { field: 'p/q/r' }, { field: '../o' }, { field: '' }] },
        },
      },
    },
  },
  {
    name: 'a recursive definition with a render of its own',
    spec: {
      fields: { t: { use: 'Tree' } },
      defs: {
        Tree: {
          type: 'object',
          render: { type: 'collapsible', children: [{ field: 'name' }, { field: 'children' }] },
          fields: { name: { type: 'string' }, children: { type: 'array', items: { use: 'Tree' }, render: 'list' } },
        },
      },
    },
    values: { t: { children: [{ children: [{ children: [] }] }] } },
    expect: 'valid',
  },
  { name: 'every built-in layout element at once', spec: everyElement(), expect: 'valid' },

  // ── Expressions ──────────────────────────────────────────────────────────────────────────
  {
    name: 'defaults that read each other',
    spec: {
      fields: {
        a: { type: 'string', default: { $state: 'b' } },
        b: { type: 'string', default: { $state: 'a' } },
        c: { type: 'string', default: { $template: '${a}${b}${c}' } },
      },
    },
  },
  {
    name: 'a default that reads itself inside its object',
    spec: { fields: { o: { type: 'object', default: { $state: 'o' }, fields: { x: { type: 'int', default: { $state: '../o/x' } } } } } },
  },
  {
    name: 'conditions that read the field they are on',
    spec: {
      fields: {
        a: { type: 'boolean', visible: { $state: 'a' }, enabled: { $state: 'a', eq: false }, required: { $state: 'a' } },
        b: {
          type: 'enum',
          options: { $state: '/b' },
          default: { $cond: { $state: 'b' }, $then: { $state: 'a' }, $else: { $template: '${b}' } },
        },
      },
    },
  },
  {
    name: 'pointers that escape the root',
    spec: {
      fields: {
        a: {
          type: 'string',
          default: { $state: '../../../../x' },
          visible: { $state: '../../..', not: true },
          label: { $template: '${../../../a}${/a/b/c}${~}' },
        },
      },
    },
  },
  {
    name: 'conditions nested 500 deep',
    spec: { fields: { a: { type: 'boolean', visible: nestedCondition(500) as never } } },
  },

  // ── Size ─────────────────────────────────────────────────────────────────────────────────
  { name: 'objects nested 150 deep inline', spec: { fields: { x: nested(150) } }, expect: 'valid' },
  {
    name: '3000 fields',
    spec: {
      fields: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`f${i}`, { type: 'string', group: `g${i % 30}` }])),
      groups: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`g${i}`, { label: `G${i}` }])),
    },
    expect: 'valid',
  },
  // Laid out 400 deep in render.test.ts; drawn, the same React limit as deep values applies.
  { name: 'groups chained 150 deep', spec: chainedGroups(150), expect: 'valid' },
  {
    name: 'a list with 500 items',
    spec: {
      fields: {
        items: {
          type: 'array',
          items: { type: 'object', fields: { a: { type: 'string' }, b: { type: 'int', visible: { $item: 'a', eq: 'x' } } } },
        },
      },
    },
    values: { items: Array.from({ length: 500 }, (_, i) => ({ a: i % 2 === 1 ? 'x' : 'y', b: i })) },
    expect: 'valid',
  },
  {
    name: 'unknown keys with long names',
    spec: { fields: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`field${i}`, { type: 'string' }])) },
    values: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`x${'y'.repeat(200)}${i}`, i])),
  },
];

function deepTree(n: number): unknown {
  let t: unknown = { name: 'leaf', children: [] };
  for (let i = 0; i < n; i++) t = { name: `n${i}`, children: [t] };
  return t;
}

function nestedCondition(n: number): unknown {
  let c: unknown = { $state: '/a' };
  for (let i = 0; i < n; i++) c = i % 2 === 1 ? { $and: [c, true] } : { $or: [c, false] };
  return c;
}

function chainedGroups(n: number): Spec {
  const groups: Record<string, { group?: string; label: string }> = {};
  for (let i = 0; i < n; i++) groups[`g${i}`] = { label: `G${i}`, ...(i > 0 && { group: `g${i - 1}` }) };
  return { fields: Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, { type: 'string', group: `g${i}` }])), groups };
}

function everyElement(): Spec {
  return {
    fields: {
      a: { type: 'string', group: 'g', render: { type: 'row', children: ['label', 'control', 'help', 'errors'] } },
      b: { type: 'int', render: 'slider' },
      c: { type: 'enum', options: ['x', 'y'], render: 'segmented' },
      d: { type: 'set', items: { type: 'enum', options: ['x', 'y'] }, render: 'checks' },
      e: { type: 'boolean', render: 'switch' },
    },
    groups: { g: { label: 'G', render: { type: 'scroll', props: { maxHeight: 100 } } } },
    layouts: {
      all: {
        type: 'tabs',
        children: [
          {
            type: 'collapsible',
            props: { title: 'One', collapsed: true },
            children: [{ field: 'a' }, { type: 'divider' }, { type: 'text', props: { text: 'hi' } }],
          },
          {
            type: 'columns',
            props: { title: 'Two', count: 3 },
            children: [{ type: 'errors', props: { fields: ['a', 'b'] } }, { type: 'rest' }],
          },
          { type: 'scroll', props: { title: 'Three' }, children: [{ group: 'g' }] },
        ],
      },
    },
  };
}
