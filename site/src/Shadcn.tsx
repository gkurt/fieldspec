import { shadcnRenderers } from '#examples/renderers/shadcn.tsx';
/** A form drawn with shadcn/ui, beside the values it edits. */
import { define } from '#src/index.ts';
import { FormView, useForm, useFormState } from '#src/react/index.tsx';
import { Json } from './Code.tsx';
import './shadcn.css';

export const deploySpec = define({
  fields: {
    project: {
      type: 'string',
      default: 'fieldspec-site',
      required: true,
      pattern: '^[a-z0-9-]+$',
      patternMessage: 'Use lowercase letters, digits and dashes',
      description: 'Lowercase letters, digits and dashes.',
    },
    framework: { type: 'string', suggestions: ['Astro', 'Next.js', 'Remix', 'SvelteKit', 'Vite'], default: 'Vite' },
    region: {
      type: 'enum',
      options: [
        { value: 'fra1', label: 'Frankfurt' },
        { value: 'iad1', label: 'Washington, D.C.' },
        { value: 'sfo1', label: 'San Francisco' },
        { value: 'hnd1', label: 'Tokyo' },
      ],
      default: 'fra1',
    },
    plan: { type: 'enum', options: ['hobby', 'pro', 'team'], default: 'pro', render: 'segmented' },
    instances: { type: 'int', min: 1, max: 16, default: 2, render: 'slider', group: 'scale' },
    memory: { type: 'int', min: 128, max: 4096, default: 1024, unit: 'MB', group: 'scale' },
    branch: { type: 'enum', options: ['main', 'release'], default: 'main', render: 'radio', label: 'Production branch' },
    launch: { type: 'date', default: '2026-11-20', label: 'Launch on' },
    previews: { type: 'boolean', default: true, render: 'switch', label: 'Deploy previews', description: 'One for each pull request.' },
    notify: {
      type: 'set',
      items: {
        type: 'enum',
        options: [
          { value: 'email', label: 'Email' },
          { value: 'slack', label: 'Slack' },
          { value: 'webhook', label: 'Webhook' },
        ],
      },
      default: ['email'],
      label: 'Notify by',
    },
    domains: {
      type: 'array',
      namedBy: 'host',
      render: { type: 'accordion', props: { open: 'first', addLabel: 'Add a domain' } },
      items: {
        type: 'object',
        fields: {
          host: { type: 'string', placeholder: 'example.com' },
          redirect: { type: 'boolean', label: 'Redirect www to it', render: 'switch' },
        },
      },
      default: [
        { host: 'fieldspec.dev', redirect: true },
        { host: 'docs.fieldspec.dev', redirect: false },
      ],
      group: 'advanced',
    },
    env: {
      type: 'record',
      values: { type: 'string' },
      default: { NODE_ENV: 'production', API_URL: 'https://api.fieldspec.dev' },
      label: 'Environment',
      group: 'advanced',
    },
    accent: {
      use: 'color',
      default: '#2456e6',
      render: { type: 'color', props: { swatches: ['#2456e6', '#1a7f4b', '#a3348f', '#b4520a'] } },
      group: 'advanced',
    },
  },
  groups: {
    scale: { label: 'Scale', render: 'row' },
    advanced: { label: 'Advanced', render: { type: 'collapsible', props: { collapsed: false } } },
  },
});

export const deploySource = `import { FormView } from "fieldspec/react";
// copied from fieldspec's examples/renderers, its ui/ folder being your components/ui
import { shadcnRenderers } from "./renderers/shadcn";

<FormView form={form} renderers={shadcnRenderers} />`;

export function ShadcnDemo() {
  const form = useForm(deploySpec);
  const { json } = useFormState(form);
  return (
    <div className="aria-demo">
      <figure>
        <figcaption>examples/renderers/shadcn</figcaption>
        <div className="card form-card shadcn-host">
          <FormView form={form} renderers={shadcnRenderers} />
        </div>
      </figure>
      <figure>
        <figcaption>form.json()</figcaption>
        <Json value={json} className="aria-json" />
      </figure>
    </div>
  );
}
