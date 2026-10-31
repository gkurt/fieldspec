import { LANGUAGE_KEYS } from './expr.ts';
import type { JsonSchema, PropInfo } from './kinds.ts';
import { USER_NAME } from './names.ts';
/**
 * The JSON Schema of specs, generated from a registry's kinds, elements and presets so
 * it cannot drift from what the checker accepts. The core registry's is published with the
 * package (`schema/spec.json`, versioned like it) and is open: it also accepts any capitalized
 * kind or element, so specs of every extended registry validate against it. A registry's own
 * schema is closed, naming exactly its vocabulary; give that one to structured outputs.
 *
 * The schema checks shape; `checkSpec` checks meaning (references, conditions, defaults).
 */
import { BASE_PROPS, coreRegistry, type Registry } from './registry.ts';
import { SCHEMA_URL, VERSION } from './version.ts';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

export interface MetaSchemaOptions {
  /** The schema's `$id`. The core registry's defaults to {@link SCHEMA_URL}. */
  readonly id?: string;
  /** Accept capitalized kinds and elements the registry does not list. Default: for the core registry only. */
  readonly open?: boolean;
}

function propsSchema(props: { readonly [prop: string]: PropInfo }): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).map(([name, info]) => [name, { ...info.schema, description: info.description }]));
}

/** A JSON Schema every valid spec of this registry satisfies. */
export function metaSchema(registry: Registry = coreRegistry, options: MetaSchemaOptions = {}): JsonSchema {
  const open = options.open ?? registry === coreRegistry;
  const id = options.id ?? (registry === coreRegistry ? SCHEMA_URL : undefined);
  const userName = { type: 'string', pattern: USER_NAME.source };
  const { type: _type, use: useProp, ...base } = BASE_PROPS;

  const kinds: unknown[] = [...registry.kinds.values()].map((kind) => {
    const own: Record<string, PropInfo> = {};
    const seen = new Set<string>();
    for (let k: typeof kind | undefined = kind; k && !seen.has(k.name); k = k.base ? registry.kinds.get(k.base) : undefined) {
      seen.add(k.name);
      Object.assign(own, k.props ?? {});
    }
    return {
      type: 'object',
      title: kind.name,
      description: kind.description,
      properties: { type: { const: kind.name }, ...propsSchema(base), ...propsSchema(own) },
      required: [
        'type',
        ...Object.entries(own)
          .filter(([, i]) => i.required)
          .map(([n]) => n),
      ],
      additionalProperties: false,
    };
  });
  // A field built on a preset or definition may override anything its base's kind takes.
  kinds.push({
    type: 'object',
    title: 'use',
    description: "Builds on a preset or definition; its own properties override the base's.",
    properties: { use: { type: 'string', description: useProp!.description }, ...propsSchema(base) },
    required: ['use'],
    not: { required: ['type'] },
  });
  if (open) {
    kinds.push({
      type: 'object',
      title: 'extension kind',
      description: 'A kind an extended registry adds. Its name is capitalized.',
      properties: { type: { ...userName, description: 'The kind.' }, ...propsSchema(base) },
      required: ['type'],
    });
  }

  const elements: unknown[] = [...registry.elements.values()].map((el) => ({
    type: 'object',
    title: el.name,
    description: `${el.description}${el.kinds ? ` Edits ${el.kinds.join(', ')} fields.` : ''}`,
    properties: {
      type: { const: el.name },
      props: { type: 'object', properties: propsSchema(el.props ?? {}), additionalProperties: false },
      ...(el.children && { children: { type: 'array', items: { $ref: '#/$defs/render' } } }),
      visible: { $ref: '#/$defs/condition' },
    },
    required: ['type'],
    additionalProperties: false,
  }));
  if (open) {
    elements.push({
      type: 'object',
      title: 'extension element',
      description: 'An element an extended registry adds. Its name is capitalized.',
      properties: {
        type: userName,
        props: { type: 'object', additionalProperties: { $ref: '#/$defs/expr' } },
        children: { type: 'array', items: { $ref: '#/$defs/render' } },
        visible: { $ref: '#/$defs/condition' },
      },
      required: ['type'],
      additionalProperties: false,
    });
  }

  // Code is part of the open schema, which extended registries share, and of a closed one that runs it.
  const languages = LANGUAGE_KEYS.filter((key) => open || registry.languages[key] !== undefined);
  const code = Object.fromEntries(languages.map((key) => [key, { type: 'string' }]));
  const leaf = {
    type: 'object',
    properties: {
      $state: { type: 'string' },
      $item: { type: 'string' },
      $index: { const: true },
      $computed: { type: 'string' },
      ...code,
      args: { type: 'object', additionalProperties: { $ref: '#/$defs/expr' } },
      eq: { $ref: '#/$defs/expr' },
      neq: { $ref: '#/$defs/expr' },
      gt: { $ref: '#/$defs/expr' },
      gte: { $ref: '#/$defs/expr' },
      lt: { $ref: '#/$defs/expr' },
      lte: { $ref: '#/$defs/expr' },
      in: { $ref: '#/$defs/expr' },
      not: { const: true },
    },
    oneOf: ['$state', '$item', '$index', '$computed', ...languages].map((key) => ({ required: [key] })),
    additionalProperties: false,
  };
  const only = (key: string, schema: unknown) => ({
    type: 'object',
    properties: { [key]: schema },
    required: [key],
    additionalProperties: false,
  });
  const elementNames = [{ enum: [...registry.elements.keys()] }, ...(open ? [userName] : [])];

  return {
    $schema: DIALECT,
    ...(id && { $id: id }),
    title: `fieldspec spec ${VERSION}`,
    description:
      'A fieldspec spec: the fields of a config or form, their kinds, constraints, defaults and conditions, and how a form for them is drawn. ' +
      'Built-in names are lowercase; names an application or a spec defines are capitalized.',
    type: 'object',
    properties: {
      $schema: { type: 'string', description: "This schema's URL, which names the version the spec is written for." },
      title: { $ref: '#/$defs/text' },
      description: { $ref: '#/$defs/text' },
      fields: { type: 'object', description: 'The fields, in display order.', additionalProperties: { $ref: '#/$defs/field' } },
      groups: { type: 'object', description: 'Groups fields may join, for display.', additionalProperties: { $ref: '#/$defs/group' } },
      defs: {
        type: 'object',
        description: 'Named declarations fields build on with `use`. Names are capitalized.',
        propertyNames: { pattern: USER_NAME.source },
        additionalProperties: { $ref: '#/$defs/field' },
      },
      layouts: { type: 'object', description: 'Named arrangements of the whole form.', additionalProperties: { $ref: '#/$defs/render' } },
      functions: {
        type: 'object',
        description: 'Functions `$computed` may call, implemented by the application.',
        additionalProperties: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            args: { type: 'object', additionalProperties: { type: 'string' } },
            returns: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    required: ['fields'],
    additionalProperties: false,
    $defs: {
      field: { anyOf: kinds },
      group: {
        type: 'object',
        properties: {
          label: { $ref: '#/$defs/text' },
          description: { $ref: '#/$defs/text' },
          render: { $ref: '#/$defs/render' },
          visible: { $ref: '#/$defs/condition' },
          group: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: {
        anyOf: [...elementNames, only('field', { type: 'string' }), only('group', { type: 'string' }), { anyOf: elements }],
      },
      condition: {
        anyOf: [
          { type: 'boolean' },
          { type: 'array', items: { $ref: '#/$defs/condition' } },
          only('$and', { type: 'array', items: { $ref: '#/$defs/condition' } }),
          only('$or', { type: 'array', items: { $ref: '#/$defs/condition' } }),
          leaf,
        ],
      },
      check: {
        type: 'object',
        description: 'A rule the value must keep: `assert` holds while it is valid; while it fails, the field shows `message`.',
        properties: {
          assert: { $ref: '#/$defs/condition' },
          message: { $ref: '#/$defs/text' },
          code: { type: 'string', description: 'The issue\'s code. Default "check".' },
        },
        required: ['assert', 'message'],
        additionalProperties: false,
      },
      expr: {
        anyOf: [
          { type: ['string', 'number', 'boolean', 'null'] },
          { type: 'array', items: { $ref: '#/$defs/expr' } },
          only('$state', { type: 'string' }),
          only('$item', { type: 'string' }),
          only('$index', { const: true }),
          {
            type: 'object',
            properties: { $computed: { type: 'string' }, args: { type: 'object', additionalProperties: { $ref: '#/$defs/expr' } } },
            required: ['$computed'],
            additionalProperties: false,
          },
          ...languages.map((key) => ({
            type: 'object',
            properties: { [key]: { type: 'string' }, args: { type: 'object', additionalProperties: { $ref: '#/$defs/expr' } } },
            required: [key],
            additionalProperties: false,
          })),
          {
            type: 'object',
            properties: { $cond: { $ref: '#/$defs/condition' }, $then: { $ref: '#/$defs/expr' }, $else: { $ref: '#/$defs/expr' } },
            required: ['$cond', '$then', '$else'],
            additionalProperties: false,
          },
          only('$template', { type: 'string' }),
          { type: 'object', additionalProperties: { $ref: '#/$defs/expr' } },
        ],
      },
      text: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/expr' }] },
    },
  };
}
