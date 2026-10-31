/**
 * For agents: a system prompt generated from the registry's own kinds, elements and presets, so
 * what an agent is told cannot drift from what is checked. Its JSON Schema is in schema.ts.
 */
import { isBuiltinName } from './names.ts';
import { PRESET_DESCRIPTIONS } from './presets.ts';
import { BASE_PROPS, coreRegistry, type Registry } from './registry.ts';
import { SCHEMA_URL } from './version.ts';

export { metaSchema } from './schema.ts';
import type { FunctionDecl } from './types.ts';

export interface PromptOptions {
  /** Extra rules, in plain language. */
  readonly customRules?: readonly string[];
  /** Functions the agent may call with `$computed`. */
  readonly functions?: { readonly [name: string]: FunctionDecl };
}

const json = (value: unknown) => JSON.stringify(value);

/** A system prompt that teaches an agent to write specs of this registry. */
export function prompt(registry: Registry = coreRegistry, options: PromptOptions = {}): string {
  const lines: string[] = [];
  const out = (...l: string[]) => lines.push(...l);
  out(
    '# Writing a fieldspec spec',
    '',
    'A spec is one JSON object that describes a set of values (settings, a form, a config) and how a form for them is laid out. Write JSON only.',
    '',
    '```json',
    '{ "$schema": "…", "title": "…", "fields": { "<key>": <field> }, "groups": { "<id>": <group> }, "defs": { "<Name>": <field> }, "layouts": { "<name>": <render> } }',
    '```',
    '',
    "Only `fields` is required. Keys are lowerCamelCase. Field order is display order; a field's `order` (lower first, 0 when absent) moves it.",
    '',
    `Start the spec with \`"$schema": "${SCHEMA_URL}"\`: it names the fieldspec version it is written for.`,
    '',
    '## Every field may have',
    '',
  );
  for (const [name, info] of Object.entries(BASE_PROPS)) out(`- \`${name}\`${info.required ? ' (required)' : ''}: ${info.description}`);
  out(
    '',
    'An absent value takes `default`, else the kind\'s zero ("", 0, false, the first option, empty collections). `optional: true` lets it stay absent. Defaults are written in the JSON form of the value.',
    '',
    '## Kinds (`type`)',
    '',
  );
  for (const kind of registry.kinds.values()) {
    out(`### ${kind.name}${kind.base ? ` (refines ${kind.base})` : ''}`, '', kind.description);
    const props = Object.entries(kind.props ?? {});
    if (props.length > 0) {
      out('');
      for (const [name, info] of props) out(`- \`${name}\`${info.required ? ' (required)' : ''}: ${info.description}`);
    }
    if (kind.example) out('', '```json', json(kind.example), '```');
    out('');
  }
  out(
    "## Conditions (`visible`, `enabled`, `required`, a check's `assert`, element `visible`)",
    '',
    '- `true` / `false`.',
    '- A leaf tests one value: `{ "$state": "/mode", "eq": "advanced" }`. Without an operator it tests truthiness. Operators: eq, neq, gt, gte, lt, lte, in (one per leaf). Add `"not": true` to invert.',
    '- `$state` pointers starting with `/` are absolute from the root of the values. Without `/` they are relative to the object the field is in: `"mode"` is a sibling, and each leading `../` climbs one level (`"../plan"` is a property of the parent object; inside an array item, the array index counts as a level). Prefer relative pointers inside `defs`.',
    '- Inside an array item, `{ "$item": "kind" }` reads the item\'s own field and `{ "$index": true }` its position.',
    '- An array means all hold: `[ {…}, {…} ]`. Use `{ "$or": [ … ] }` for any, `{ "$and": [ … ] }` to nest all inside an or.',
    '- Operands may be expressions: `{ "$state": "/end", "gt": { "$state": "/start" } }`.',
    '',
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
    '## Expressions (`default`, `label`, `description`, `hint`, `placeholder`, enum `options`, element props)',
    '',
    '- `{ "$state": "/path" }` reads a value. `{ "$template": "Hi ${/name}" }` interpolates.',
    '- `{ "$cond": <condition>, "$then": <expr>, "$else": <expr> }` chooses.',
    '- `{ "$computed": "name", "args": { "x": <expr> } }` calls a function the application provides. Call only functions listed below.',
  );
  for (const language of Object.values(registry.languages)) out(`- ${language.description}`);
  out(
    '',
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
    'Presets:',
    '',
  );
  for (const [name, preset] of Object.entries(registry.presets)) {
    const about = isBuiltinName(name)
      ? PRESET_DESCRIPTIONS[name as keyof typeof PRESET_DESCRIPTIONS]
      : (preset.description as string | undefined);
    out(`- \`${name}\`: ${about ? `${about} ` : ''}\`${json(preset)}\``);
  }
  out(
    '',
    '## Groups',
    '',
    'A group gathers fields for display; it does not change the shape of the values. A field joins with `"group": "<id>"`. A group may have `label`, `description`, `visible`, `render`, and a parent `group`. It draws where its first field would, as a titled `stack` unless `render` names another container.',
    '',
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
  for (const role of ['layout', 'part', 'control'] as const) {
    out(`${role === 'layout' ? 'Layout' : role === 'part' ? 'Field parts' : 'Controls'}:`, '');
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
  const functions = Object.entries(options.functions ?? {});
  out('## Functions', '');
  if (functions.length === 0) out('None are available: do not use `$computed`.');
  for (const [name, fn] of functions) {
    const args = Object.entries(fn.args ?? {})
      .map(([a, t]) => `${a}: ${t}`)
      .join(', ');
    out(`- \`${name}(${args})\`${fn.returns ? ` → ${fn.returns}` : ''}${fn.description ? `: ${fn.description}` : ''}`);
  }
  out(
    '',
    '## Example',
    '',
    '```json',
    JSON.stringify(EXAMPLE, null, 2),
    '```',
    '',
    '## Rules',
    '',
    '- Use only the kinds, properties and elements above. Unknown properties are errors.',
    "- An enum's `default` must be one of its options.",
    '- Keep labels short; put explanations in `description`.',
  );
  for (const rule of options.customRules ?? []) out(`- ${rule}`);
  return lines.join('\n');
}

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
