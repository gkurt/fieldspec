/** The specs the homepage draws. Each is a real spec, run by the library as you edit it. */
import { define, FORMAT_VERSION, SCHEMA_URL, type Spec } from '#src/index.ts';

export const account = define({
  fields: {
    firstName: { type: 'string', group: 'name', placeholder: 'Ada' },
    lastName: { type: 'string', group: 'name', placeholder: 'Lovelace' },
    email: { use: 'email', required: true },
    plan: { type: 'enum', options: ['free', 'pro'], default: 'free', render: 'segmented' },
    discount: { use: 'percent', visible: { $state: 'plan', eq: 'pro' } },
  },
  groups: { name: { label: 'Name', render: 'row' } },
});

/** The hero's code, as the reader sees it. */
export const accountSource = `import { define, parse, type Infer } from "fieldspec";

const account = define({
  fields: {
    firstName: { type: "string", group: "name" },
    lastName: { type: "string", group: "name" },
    email: { use: "email", required: true },
    plan: { type: "enum", options: ["free", "pro"],
            default: "free", render: "segmented" },
    discount: { use: "percent",
                visible: { $state: "plan", eq: "pro" } },
  },
  groups: { name: { label: "Name", render: "row" } },
});

type Account = Infer<typeof account>;
const result = parse(account, json);`;

export const accountType = `type Account = {
  firstName: string;
  lastName: string;
  email: string;
  plan: "free" | "pro";
  discount: number;
}`;

export const shipping = define({
  fields: {
    delivery: {
      type: 'enum',
      render: 'segmented',
      default: 'ship',
      options: [
        { value: 'ship', label: 'Ship it' },
        { value: 'pickup', label: 'Pick up' },
      ],
    },
    address: {
      type: 'object',
      visible: { $state: 'delivery', eq: 'ship' },
      render: 'columns',
      fields: {
        street: { type: 'string' },
        country: { type: 'enum', options: ['NL', 'DE', 'US', 'JP'], default: 'NL' },
      },
    },
    express: {
      type: 'boolean',
      render: 'switch',
      label: 'Express delivery',
      visible: { $state: 'delivery', eq: 'ship' },
      enabled: { $state: 'address/country', in: ['NL', 'DE'] },
      hint: 'Within the EU only.',
    },
    gift: { type: 'boolean', render: 'switch', label: 'This is a gift' },
    note: {
      type: 'string',
      render: 'textarea',
      visible: { $state: 'gift', eq: true },
      label: { $template: 'A note for ${/address/street}' },
      required: { $state: 'gift', eq: true },
    },
  },
});

export const shippingSource = `"express": {
  "type": "boolean",
  "visible": { "$state": "delivery", "eq": "ship" },
  "enabled": { "$state": "address/country", "in": ["NL", "DE"] }
},
"note": {
  "type": "string",
  "visible": { "$state": "gift", "eq": true },
  "required": { "$state": "gift", "eq": true },
  "label": { "$template": "A note for \${/address/street}" }
}`;

export const settings = define({
  fields: {
    name: { type: 'string', group: 'profile', placeholder: 'Production' },
    region: { type: 'enum', options: ['eu-west', 'us-east', 'ap-south'], group: 'profile' },
    replicas: { type: 'int', min: 1, max: 12, default: 3, render: 'slider', group: 'scale' },
    autoscale: { type: 'boolean', render: 'switch', group: 'scale' },
    memory: { use: 'percent', default: 0.6, label: 'Memory limit', group: 'scale' },
    logLevel: { type: 'enum', options: ['debug', 'info', 'warn'], default: 'info', render: 'radio', group: 'ops' },
    retainDays: { type: 'int', min: 1, max: 90, default: 14, group: 'ops' },
  },
  groups: {
    profile: { label: 'Profile', render: 'row' },
    scale: { label: 'Scaling', render: { type: 'collapsible', props: { collapsed: false } } },
    ops: { label: 'Operations' },
  },
  layouts: {
    tabs: {
      type: 'tabs',
      children: [
        { type: 'stack', props: { title: 'Profile' }, children: [{ group: 'profile' }] },
        { type: 'stack', props: { title: 'Scaling' }, children: [{ field: 'replicas' }, { field: 'autoscale' }, { field: 'memory' }] },
        { type: 'stack', props: { title: 'Operations' }, children: [{ type: 'rest' }] },
      ],
    },
    columns: {
      type: 'columns',
      props: { count: 2 },
      children: [
        { type: 'stack', props: { title: 'Where' }, children: [{ field: 'name' }, { field: 'region' }, { field: 'logLevel' }] },
        { type: 'stack', props: { title: 'How much' }, children: [{ type: 'rest' }] },
      ],
    },
  },
});

export const collections = define({
  fields: {
    webhooks: {
      type: 'array',
      default: [
        { url: 'https://hooks.example.com/billing', events: 'billing' },
        { url: 'https://hooks.example.com/audit', events: 'all' },
      ],
      items: {
        type: 'object',
        render: 'row',
        fields: {
          url: { type: 'url', label: 'URL', protocols: ['https:'] },
          events: { type: 'enum', options: ['all', 'billing'], render: 'segmented' },
        },
      },
    },
    headers: { type: 'record', values: { type: 'string' }, default: { Accept: 'application/json', 'X-Team': 'core' } },
    notify: {
      type: 'set',
      items: {
        type: 'enum',
        options: [
          { value: 'billing', label: 'Billing' },
          { value: 'security', label: 'Security' },
          { value: 'product', label: 'Product' },
        ],
      },
      render: 'checks',
    },
    auth: {
      type: 'variant',
      key: 'method',
      variants: {
        password: { label: 'Password', fields: { minLength: { type: 'int', min: 8, max: 64, default: 12 } } },
        sso: { label: 'Single sign-on', fields: { issuer: { type: 'url', protocols: ['https:'] } } },
      },
    },
  },
});

export const menu = define({
  fields: { menu: { use: 'Entry', label: 'Navigation' } },
  defs: {
    Entry: {
      type: 'object',
      fields: {
        label: { type: 'string', required: true, group: 'head' },
        kind: {
          type: 'enum',
          options: [
            { value: 'link', label: 'Link' },
            { value: 'folder', label: 'Folder' },
          ],
          default: 'link',
          render: 'segmented',
          group: 'head',
        },
        url: { type: 'url', label: 'URL', optional: true, visible: { $state: 'kind', eq: 'link' } },
        children: { type: 'array', label: 'Entries', items: { use: 'Entry' }, visible: { $state: 'kind', eq: 'folder' } },
      },
      groups: { head: { render: 'row' } },
    },
  },
});

export const menuValues = {
  menu: {
    label: 'Docs',
    kind: 'folder',
    children: [
      { label: 'Guide', kind: 'link', url: 'https://example.com/guide' },
      { label: 'Reference', kind: 'folder', children: [{ label: 'API', kind: 'link', url: 'https://example.com/api' }] },
    ],
  },
};

export const menuSource = `"defs": {
  "Entry": {
    "type": "object",
    "fields": {
      "label": { "type": "string", "required": true },
      "kind": { "type": "enum", "options": ["link", "folder"] },
      "url": { "type": "url",
               "visible": { "$state": "kind", "eq": "link" } },
      "children": { "type": "array",
                    "items": { "use": "Entry" } }
    }
  }
},
"fields": { "menu": { "use": "Entry" } }`;

/** What the playground starts from. */
export const PLAYGROUND: Record<string, Spec> = {
  'Sign-up': {
    $schema: SCHEMA_URL,
    fieldspec: FORMAT_VERSION,
    title: 'Sign up',
    fields: {
      email: { use: 'email', required: true },
      password: {
        use: 'password',
        required: true,
        hint: 'At least 12 characters.',
        checks: [{ assert: { $state: 'password', neq: { $state: 'email' } }, message: 'Must differ from your email' }],
      },
      team: { type: 'boolean', render: 'switch', label: 'Signing up a team' },
      seats: { type: 'int', min: 2, max: 50, default: 5, render: 'slider', visible: { $state: 'team', eq: true } },
      interests: { type: 'set', items: { type: 'enum', options: ['design', 'code', 'ops'] }, render: 'checks' },
    },
  },
  'Broken on purpose': {
    fields: {
      name: { type: 'strng', label: 'Name' },
      opacity: { use: 'percnt' },
      size: { type: 'int', min: 10, max: 2, render: 'sliderr' },
      color: { type: 'string', group: 'look', visible: { $state: '../../theme', eq: 'dark' } },
      mode: { type: 'enum', options: ['a', 'b', 'a'], default: 'c' },
    },
    defs: { Node: { type: 'object', fields: { next: { use: 'Node' } } } },
  },
  Recursive: {
    fields: { root: { use: 'Folder' } },
    defs: {
      Folder: {
        type: 'object',
        fields: {
          name: { type: 'string' },
          shared: { type: 'boolean', render: 'switch' },
          folders: { type: 'array', items: { use: 'Folder' } },
        },
      },
    },
  },
};
