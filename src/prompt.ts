/**
 * For agents: a system prompt generated from the registry's own kinds, elements and presets, so
 * what an agent is told cannot drift from what is checked. Its JSON Schema is in schema.ts.
 */
import { isBuiltinName } from './names.ts';
import { PRESET_DESCRIPTIONS } from './presets.ts';
import { BASE_PROPS, coreRegistry, type Registry } from './registry.ts';
import { FORMAT_VERSION, SCHEMA_URL } from './version.ts';

export { metaSchema } from './schema.ts';
import type { FunctionDecl, Spec } from './types.ts';
/** A part of the format a prompt may teach beyond fields, kinds and presets. */
export type PromptTopic =
  /** Conditions: `visible`, `enabled` and a `required` that depends on other values. */
  | 'conditions'
  /** `checks`: rules a value must keep, often over other fields. Teaches conditions too. */
  | 'checks'
  /** Expressions and code: `$state`, `$template`, `$cond`, `$computed`, the registry's languages, and derived `value`s. */
  | 'expressions'
  /** `defs`: definitions of the spec's own, and ones that contain themselves. */
  | 'defs'
  /** `locales`: translations the spec carries. */
  | 'locales'
  /** `version` and `migrations`, for a spec whose values are already stored. */
  | 'migrations'
  /** Groups of fields. A form only. */
  | 'groups'
  /** Picking a field's control with `render`. A form only. */
  | 'controls'
  /** Layout elements, field parts and `layouts`. Teaches controls too. A form only. */
  | 'layout';

const TOPICS: readonly PromptTopic[] = [
  'conditions',
  'checks',
  'expressions',
  'defs',
  'locales',
  'migrations',
  'groups',
  'controls',
  'layout',
];
/** What a prompt for data never teaches: nothing draws the data. */
const DRAWN: readonly PromptTopic[] = ['groups', 'controls', 'layout', 'locales'];
const DEFAULT_TOPICS: { readonly [purpose in 'form' | 'data']: readonly PromptTopic[] } = {
  form: ['conditions', 'groups', 'controls'],
  data: [],
};

export interface PromptOptions {
  /**
   * What the spec is for. `"form"` (the default) is values people edit in a form the spec lays
   * out. `"data"` is the shape of data a program or a model sends and others read: no form is
   * drawn, so the prompt teaches no labels, groups, layouts or controls, and asks for a
   * description on every field, nesting instead of prefixed keys, and `required` and `optional`
   * that say what the sender must give and what it may not know.
   */
  readonly purpose?: 'form' | 'data';
  /**
   * The parts of the format to teach beyond fields, kinds and presets, since a prompt that
   * teaches everything is several times longer than most requests need. Default: for a form,
   * conditions, groups and controls; for data, none. `"all"` teaches everything the purpose can
   * use. A model writes only what it was taught, so name the topic a request calls for: `checks`
   * for a rule over several fields, `defs` for a shape that repeats or contains itself.
   */
  readonly topics?: readonly PromptTopic[] | 'all';
  /** Extra rules, in plain language. */
  readonly customRules?: readonly string[];
  /** Functions the agent may call with `$computed`. Giving any teaches expressions. */
  readonly functions?: { readonly [name: string]: FunctionDecl };
}

const json = (value: unknown) => JSON.stringify(value);

/** The base properties a topic teaches; the rest every prompt lists. */
const TOPIC_PROPS: { readonly [prop: string]: readonly PromptTopic[] } = {
  visible: ['conditions'],
  enabled: ['conditions'],
  checks: ['checks'],
  value: ['expressions'],
  group: ['groups'],
  render: ['controls', 'layout'],
};

/** A system prompt that teaches an agent to write specs of this registry. */
export function prompt(registry: Registry = coreRegistry, options: PromptOptions = {}): string {
  const data = options.purpose === 'data';
  const asked = options.topics === 'all' ? TOPICS : (options.topics ?? DEFAULT_TOPICS[data ? 'data' : 'form']);
  const topics = new Set(asked.filter((topic) => !data || !DRAWN.includes(topic)));
  if (topics.has('checks')) topics.add('conditions');
  if (topics.has('layout')) topics.add('controls');
  if (Object.keys(options.functions ?? {}).length > 0) topics.add('expressions');
  const has = (topic: PromptTopic) => topics.has(topic);
  const lines: string[] = [];
  const out = (...l: string[]) => lines.push(...l);
  const about = (name: string, preset: Registry['presets'][string]) =>
    isBuiltinName(name) ? PRESET_DESCRIPTIONS[name as keyof typeof PRESET_DESCRIPTIONS] : (preset.description as string | undefined);
  const shape = [
    '"$schema": "…"',
    '"fieldspec": 1',
    '"title": "…"',
    '"fields": { "<key>": <field> }',
    ...(has('groups') ? ['"groups": { "<id>": <group> }'] : []),
    ...(data || has('defs') ? ['"defs": { "<Name>": <field> }'] : []),
    ...(has('layout') ? ['"layouts": { "<name>": <render> }'] : []),
  ];
  out(
    '# Writing a fieldspec spec',
    '',
    data
      ? 'A spec is one JSON object that describes the shape of data: values a program or a model sends as JSON, and others read. Nothing draws it as a form. Write JSON only.'
      : 'A spec is one JSON object that describes a set of values (settings, a form, a config) and how a form for them is laid out. Write JSON only.',
    '',
    '```json',
    `{ ${shape.join(', ')} }`,
    '```',
    '',
    data
      ? 'Only `fields` is required. Keys are lowerCamelCase.'
      : "Only `fields` is required. Keys are lowerCamelCase. Field order is display order; a field's `order` (lower first, 0 when absent) moves it.",
    '',
    `Start the spec with \`"$schema": "${SCHEMA_URL}", "fieldspec": ${FORMAT_VERSION}\`: they name the fieldspec version and the version of the spec format it is written for.`,
    '',
    '## Every field may have',
    '',
  );
  if (data) {
    for (const [name, said] of Object.entries(DATA_PROPS)) out(`- \`${name}\`: ${said}`);
    if (has('checks')) out(`- \`checks\`: ${BASE_PROPS.checks!.description}`);
    if (has('expressions')) out(`- \`value\`: ${BASE_PROPS.value!.description}`);
    out(
      '',
      '## Given, unknown, or left to a default',
      '',
      'Decide for every field which of three it is:',
      '',
      '- The sender must always give it: `required: true`.',
      '- The sender may not know it, or it may not apply: `optional: true`, and the sender leaves it out. Never use a made-up value (an empty string, 0, false) to mean unknown.',
      '- Neither: an absent value takes `default`, else the kind\'s zero ("", 0, false, the first option, an empty list), which a reader cannot tell from one that was sent. So leave a field plain only where that zero or default is the right reading of silence.',
      '',
      "A field has `required` or `optional`, never both. The same holds at every depth: the fields of an object and of an array's items say it for themselves.",
      '',
      '## Shape',
      '',
      '- A thing with parts is an `object` with fields of its own. Never flatten its parts into keys with a shared prefix: not `reporterName` and `reporterEmail`, but `reporter` with `name` and `email`.',
      '- Several things of one shape are an `array` whose `items` is an `object`.',
      '- One of several shapes is a `variant`.',
      '- A shape used in more than one place goes under `defs` with a capitalized name, and a field takes it with `{ "use": "Address" }`, adding properties of its own beside it.',
      '',
    );
  } else {
    for (const [name, info] of Object.entries(BASE_PROPS)) {
      if (TOPIC_PROPS[name] && !TOPIC_PROPS[name].some(has)) continue;
      const said = name === 'required' && !has('conditions') ? '`true`: must be given and non-empty.' : info.description;
      out(`- \`${name}\`${info.required ? ' (required)' : ''}: ${said}`);
    }
    out(
      '',
      'An absent value takes `default`, else the kind\'s zero ("", 0, false, the first option, empty collections). `optional: true` lets it stay absent. Defaults are written in the JSON form of the value.' +
        (has('expressions')
          ? ' A field whose value follows from others (a total, a slug) takes `value` instead: an expression that decides it every time, so the field cannot be edited.'
          : ''),
      '',
    );
  }
  out('## Kinds (`type`)', '');
  for (const kind of registry.kinds.values()) {
    out(`### ${kind.name}${kind.base ? ` (refines ${kind.base})` : ''}`, '', (data && DATA_WORDS[kind.name]) || kind.description);
    const props = Object.entries(kind.props ?? {}).filter(([name]) => !data || !FORM_ONLY.includes(name));
    if (props.length > 0) {
      out('');
      for (const [name, info] of props)
        out(`- \`${name}\`${info.required ? ' (required)' : ''}: ${(data && DATA_WORDS[`${kind.name}.${name}`]) || info.description}`);
    }
    if (kind.example && !data) out('', '```json', json(kind.example), '```');
    out('');
  }
  if (has('conditions')) {
    out(
      data
        ? "## Conditions (`required`, a check's `assert`)"
        : "## Conditions (`visible`, `enabled`, `required`, a check's `assert`, element `visible`)",
      '',
      '- `true` / `false`.',
      '- A leaf tests one value: `{ "$state": "/mode", "eq": "advanced" }`. Without an operator it tests truthiness. Operators: eq, neq, gt, gte, lt, lte, in (one per leaf). Add `"not": true` to invert.',
      '- `$state` pointers starting with `/` are absolute from the root of the values. Without `/` they are relative to the object the field is in: `"mode"` is a sibling, and each leading `../` climbs one level (`"../plan"` is a property of the parent object; inside an array item, the array index counts as a level). Prefer relative pointers inside `defs`.',
      '- Inside an array item, `{ "$item": "kind" }` reads the item\'s own field and `{ "$index": true }` its position.',
      '- An array means all hold: `[ {…}, {…} ]`. Use `{ "$or": [ … ] }` for any, `{ "$and": [ … ] }` to nest all inside an or.',
      '- Operands may be expressions: `{ "$state": "/end", "gt": { "$state": "/start" } }`.',
      '',
    );
  }
  if (has('checks')) {
    out(
      '## Checks (`checks`)',
      '',
      'A field\'s `checks` are rules its value must keep beyond its kind\'s constraints, usually over other fields. Each is `{ "assert": <condition>, "message": <text> }`: the condition holds while the value is valid, and while it fails the field shows the message. Put a check on the field whose value is wrong, write the message for people, and prefer kind constraints (`min`, `pattern`, …) where they suffice. Checks run only on a present, otherwise valid value; a definition\'s checks hold wherever it is used.',
      '',
      '```json',
      json({
        end: {
          type: 'date',
          checks: [{ assert: { $state: 'end', gte: { $state: 'start' } }, message: 'Ends before it starts' }],
        },
      }),
      '```',
      '',
    );
  }
  if (has('expressions')) {
    out(
      '## Expressions (`default`, `value`, `label`, `description`, `hint`, `placeholder`, enum `options`, element props)',
      '',
      '- `{ "$state": "/path" }` reads a value. `{ "$template": "Hi ${/name}" }` interpolates.',
      '- `{ "$cond": <condition>, "$then": <expr>, "$else": <expr> }` chooses.',
      '- `{ "$computed": "name", "args": { "x": <expr> } }` calls a function the application provides. Call only functions listed below.',
    );
    for (const language of Object.values(registry.languages)) out(`- ${language.description}`);
    out('');
  }
  const presets = Object.entries(registry.presets).filter(([, preset]) => !data || preset.render === undefined);
  const shown = (preset: Registry['presets'][string]) =>
    data ? Object.fromEntries(Object.entries(preset).filter(([prop]) => !FORM_ONLY.includes(prop))) : preset;
  if (has('defs')) {
    out(
      '## Names',
      '',
      'Built-in kinds, elements and presets are lowercase. Everything the application or this spec defines is capitalized (`Gradient`, `Address`), so the two never collide. Name your `defs` that way.',
      '',
      '## Presets and definitions (`use`)',
      '',
      `A field may build on a named declaration instead of giving a \`type\`: \`{ "use": "percent", "label": "Opacity" }\`. Its own properties override the base's. Lowercase names are built-in presets; capitalized names are the spec's \`defs\`, then presets the application adds.`,
      '',
      'Put a declaration used in several places, or one that contains itself, under `defs`. A definition may use itself only through an array, set, record, map or optional field, so its value can end.',
      '',
      '```json',
      JSON.stringify({
        defs: { Node: { type: 'object', fields: { name: { type: 'string' }, children: { type: 'array', items: { use: 'Node' } } } } },
        fields: { tree: { use: 'Node', label: 'Tree' } },
      }),
      '```',
      '',
    );
  } else if (presets.length > 0) {
    out(
      '## Presets (`use`)',
      '',
      data
        ? 'A field may build on one of these instead of giving a `type`: `{ "use": "email", "description": "…" }`.'
        : 'A field may build on one of these instead of giving a `type`: `{ "use": "percent", "label": "Opacity" }`. Its own properties override the preset\'s.',
      '',
    );
  }
  if (has('defs') && presets.length > 0) out('Presets:', '');
  for (const [name, preset] of presets)
    out(`- \`${name}\`: ${about(name, preset) ? `${about(name, preset)} ` : ''}\`${json(shown(preset))}\``);
  if (has('defs') || presets.length > 0) out('');
  if (has('locales')) {
    out(
      '## Translations (`locales`)',
      '',
      'Write every text in one language. Add `locales` only when asked for translations: by locale tag, a table from JSON Pointers into this spec to the text in their place. A pointer leads to a text (`/fields/name/label`, `/fields/plan/options/0/label`, `/groups/net/label`, `/fields/end/checks/0/message`) or a string inside one (`/fields/domain/label/$template`, `…/$then`). A text the spec leaves out may be given too: a label made from the key, the label of a plain option. A translated template reads the same values as the original.',
      '',
      '```json',
      json({ locales: { de: { '/fields/name/label': 'Name', '/fields/plan/options/0/label': 'Kostenlos' } } }),
      '```',
      '',
    );
  }
  if (has('migrations')) {
    out(
      '## Versions and migrations (`version`, `migrations`)',
      '',
      'Only when changing a spec whose values are already stored. Adding a field with a `default` needs nothing, and a renamed key can keep its old name in `aliases`. For anything else, raise `version` and add the operations that bring old values forward, keyed by the version they reach: JSON Patch over the values as stored, where `*` stands for every item or key and `value` may be an expression, evaluated where the value goes. `add` sets a value, making it if it is not there; `replace` changes only one that is. A value that moves to a new key and changes on the way is an `add` at the new key, reading the old one, then a `remove` of the old. The values there are those of the earlier version, so code reads them as untyped JSON, where a whole number works as an int or a double, as the code needs (`timeout * 1000`).',
      '',
      '```json',
      json({
        version: 2,
        migrations: {
          '2': [
            { op: 'move', from: '/host', path: '/server/host' },
            {
              op: 'replace',
              path: '/timeout',
              value: { $cond: { $state: 'timeout', lt: 1000 }, $then: 1000, $else: { $state: 'timeout' } },
            },
          ],
        },
      }),
      '```',
      '',
    );
  }
  if (has('groups')) {
    out(
      '## Groups',
      '',
      'A group gathers fields for display; it does not change the shape of the values. A field joins with `"group": "<id>"`. A group may have `label`, `description`, `visible`, `render`, and a parent `group`. It draws where its first field would, as a titled `stack` unless `render` names another container.',
      '',
    );
  }
  if (has('layout')) {
    out(
      '## Rendering (`render`)',
      '',
      'Leave `render` out unless the presentation matters. Every `render` is an element name (`"row"`) or an element `{ "type": "collapsible", "props": { … }, "children": [ … ], "visible": <condition> }`.',
      '',
      '- On a field, a control element picks its control: `"render": "slider"`. A layout element arranges the field\'s parts (`label`, `control`, `help`, `errors`, or a control element), which name no field.',
      "- On an object field, a layout element arranges the object's fields.",
      '- On a group, a layout container holds its fields; the group\'s label becomes the container\'s `title`: `"render": { "type": "collapsible", "props": { "collapsed": true } }`.',
      '- A container without `children` is filled with what is in scope. With children, `{ "field": "x" }` places a field and `{ "group": "id" }` a group; what they do not place follows them, or goes where they put `rest`. Place each field once.',
      '- `layouts` holds named whole-form arrangements, for other views of the same fields.',
      '',
    );
  } else if (has('controls')) {
    out(
      '## Controls (`render`)',
      '',
      'Every field draws with the control of its kind. Give a field `render` only where another control suits it better: a control\'s name (`"render": "slider"`), or the control with its props (`"render": { "type": "textarea", "props": { "rows": 6 } }`).',
      '',
    );
  }
  for (const role of ['layout', 'part', 'control'] as const) {
    if (role === 'control' ? !has('controls') : !has('layout')) continue;
    if (has('layout')) out(`${role === 'layout' ? 'Layout' : role === 'part' ? 'Field parts' : 'Controls'}:`, '');
    for (const el of registry.elements.values()) {
      if (el.role !== role) continue;
      const props = Object.entries(el.props ?? {})
        .filter(([n]) => n !== 'field')
        .map(([n, i]) => `\`${n}\` (${i.description})`);
      const kinds = el.kinds ? ` Edits: ${el.kinds.join(', ')}.` : '';
      out(`- \`${el.name}\`: ${el.description}${kinds}${props.length > 0 ? ` Props: ${props.join(', ')}.` : ''}`);
    }
    out('');
  }
  if (has('expressions')) {
    const functions = Object.entries(options.functions ?? {});
    out('## Functions', '');
    if (functions.length === 0) out('None are available: do not use `$computed`.');
    for (const [name, fn] of functions) {
      const args = Object.entries(fn.args ?? {})
        .map(([a, t]) => `${a}: ${t}`)
        .join(', ');
      out(`- \`${name}(${args})\`${fn.returns ? ` → ${fn.returns}` : ''}${fn.description ? `: ${fn.description}` : ''}`);
    }
    out('');
  }
  out('## Example', '', '```json', JSON.stringify(data ? DATA_EXAMPLE : exampleFor(has), null, 2), '```', '', '## Rules', '');
  if (data)
    out('- Use only the kinds and properties above. Unknown properties are errors.', '- Every field, at every depth, has a `description`.');
  else out('- Use only the kinds, properties and elements above. Unknown properties are errors.');

  out("- An enum's `default` must be one of its options.");
  if (!data) out('- Keep labels short; put explanations in `description`.');
  for (const rule of options.customRules ?? []) out(`- ${rule}`);
  return lines.join('\n');
}

/** The form example with only what the prompt taught. */
function exampleFor(has: (topic: PromptTopic) => boolean) {
  const drop = [...(has('conditions') ? [] : ['visible']), ...(has('groups') ? [] : ['group']), ...(has('controls') ? [] : ['render'])];
  const fields = Object.fromEntries(
    Object.entries(EXAMPLE.fields).map(([key, decl]) => [
      key,
      Object.fromEntries(Object.entries(decl).filter(([prop]) => !drop.includes(prop))),
    ]),
  );
  const { render, ...name } = EXAMPLE.groups.name;
  return { title: EXAMPLE.title, fields, ...(has('groups') && { groups: { name: has('layout') ? { ...name, render } : name } }) };
}

export interface DescribePromptOptions {
  /** The longest description to ask for, in characters. Default 300. */
  readonly maxLength?: number;
  /** Extra rules, in plain language. */
  readonly customRules?: readonly string[];
}

/**
 * A system prompt that asks a model for a spec's description: what a person would have typed
 * to ask for it, in a sentence or two. It says what the thing is and its notable parts, and
 * leaves the fields' kinds, limits and defaults to the spec, so it is something to read, not
 * something to write the same spec from. Send the spec with {@link describeMessage}.
 */
export function describePrompt(options: DescribePromptOptions = {}): string {
  const lines = [
    '# Describing a fieldspec spec',
    '',
    'You are given a fieldspec spec: one JSON object that describes a set of values (settings, a form, a config). Write what a person would have typed to ask for it: what the thing is, and its notable parts.',
    '',
    '## Rules',
    '',
    `- One or two sentences, under ${options.maxLength ?? 300} characters. Shorter is better.`,
    '- Name a field only where its name carries meaning the sentence needs. Do not go through the fields one by one.',
    '- Never list kinds, which fields are required, options, limits or defaults.',
    '- Plain words: no JSON, no lists, no headings, no code. Do not mention fieldspec or the spec itself.',
    ...(options.customRules ?? []).map((rule) => `- ${rule}`),
    '- Reply with the description alone.',
  ];
  return lines.join('\n');
}

/** What a describer's message leaves out of the spec: the format's own keys and the application's notes. */
const UNDESCRIBED = ['$schema', 'fieldspec', 'meta'];

/**
 * The user message that goes with {@link describePrompt}: the spec as JSON, in its own order,
 * without `$schema`, `fieldspec` and `meta`, so the description a spec carries is never
 * described back.
 */
export function describeMessage(spec: Spec): string {
  return `The spec:\n${JSON.stringify(Object.fromEntries(Object.entries(spec).filter(([key]) => !UNDESCRIBED.includes(key))))}`;
}
/** What a field of data says of itself, in the words a sender and a reader need. */
const DATA_PROPS: { readonly [prop: string]: string } = {
  type: BASE_PROPS.type!.description,
  use: BASE_PROPS.use!.description,
  description: 'What the value holds, in one sentence a model writing or reading the data can act on, with its unit or format.',
  required: '`true`: the sender must always give it, and not empty.',
  optional: '`true`: the value may be absent, which says it is unknown or does not apply.',
  default: 'The value when absent, where one is right without being said.',
  examples: 'Sample values.',
};

/** What only a form reads of a kind: left out of a prompt for data. */
const FORM_ONLY = [
  'label',
  'render',
  'patternMessage',
  'suggestions',
  'step',
  'unit',
  'accept',
  'namedBy',
  'groups',
  'placeholder',
  'hint',
];

/** Core kinds and properties whose own words speak of a form, said for data: by kind, or by kind and property. */
const DATA_WORDS: { readonly [name: string]: string } = {
  enum: 'One of a fixed list of options: plain values, or `{ "value": …, "description": "…" }` where an option needs explaining.',
  'enum.options': 'The choices.',
  set: 'Distinct items of one declaration. JSON form: an array.',
  'string.format': 'A known shape: email, uri, uuid, hostname, ipv4, color.',
  'object.fields': 'The fields.',
};
const DATA_EXAMPLE = {
  title: 'Order',
  fields: {
    id: { type: 'string', description: 'The order number as the shop prints it, like "A-10422".', required: true },
    status: {
      type: 'enum',
      options: ['open', 'paid', 'shipped', 'cancelled'],
      description: 'Where the order stands now.',
      required: true,
    },
    customer: {
      type: 'object',
      description: 'Who placed the order.',
      required: true,
      fields: {
        name: { type: 'string', description: "The customer's full name.", required: true },
        email: { use: 'email', description: 'Where receipts are sent; absent when the customer gave none.', optional: true },
      },
    },
    lines: {
      type: 'array',
      description: 'What was ordered, one entry per product.',
      required: true,
      items: {
        type: 'object',
        fields: {
          sku: { type: 'string', description: 'The product code.', required: true },
          quantity: { type: 'int', min: 1, description: 'How many units.', required: true },
          unitPrice: { type: 'number', min: 0, description: 'The price of one unit, in euros.', required: true },
        },
      },
    },
    giftWrap: { type: 'boolean', description: 'Whether the order is gift-wrapped; false when nothing is said.' },
    shippedAt: { type: 'date', time: true, description: 'When the parcel left the warehouse; absent until it has.', optional: true },
  },
};

const EXAMPLE = {
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
    seats: { type: 'int', min: 1, max: 100, default: 1, render: 'slider', visible: { $state: 'plan', eq: 'pro' } },
    discount: { use: 'percent', visible: { $state: 'plan', eq: 'pro' } },
  },
  groups: { name: { label: 'Name', render: 'row' } },
};
