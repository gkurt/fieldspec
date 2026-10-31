import { useEffect, useMemo, useState } from 'react';
import { commonFields, createForm, decode, define, encode, SCHEMA_URL, type Spec } from '#src/index.ts';
import { FormView, useFormVersion } from '#src/react/index.tsx';
import { JsonTree } from './JsonTree.tsx';

// Three kinds of canvas node, each with its own spec. Selecting several edits what they share.

const position = {
  x: { type: 'int', label: 'X', group: 'position' },
  y: { type: 'int', label: 'Y', group: 'position' },
} as const;
const groups = { position: { label: 'Position', render: 'row' } } as const;
const look = {
  opacity: { use: 'percent', default: 1 },
  rotation: { type: 'int', min: -180, max: 180, unit: '°', render: 'slider' },
  locked: { type: 'boolean', render: 'switch' },
} as const;
const drop = { label: 'Drop', fields: { blur: { type: 'number', min: 0, max: 64, render: 'slider' }, color: { use: 'color' } } } as const;

const textNode = define({
  $schema: SCHEMA_URL,
  fields: {
    ...position,
    ...look,
    text: { type: 'string', render: 'textarea' },
    font: { type: 'enum', options: ['sans', 'serif', 'mono'], render: 'segmented' },
    size: { type: 'int', min: 8, max: 96, default: 16 },
    shadow: { type: 'variant', key: 'kind', variants: { none: { label: 'None', fields: {} }, drop } },
  },
  groups,
});

const shapeNode = define({
  $schema: SCHEMA_URL,
  fields: {
    ...position,
    ...look,
    fill: { use: 'color' },
    corner: { type: 'int', min: 0, max: 64, render: 'slider' },
    shadow: {
      type: 'variant',
      key: 'kind',
      variants: {
        none: { label: 'None', fields: {} },
        drop: { ...drop, fields: { ...drop.fields, blur: { type: 'number', min: 0, max: 24, render: 'slider' } } },
        glow: { label: 'Glow', fields: { radius: { type: 'number', min: 0 } } },
      },
    },
  },
  groups,
});

const imageNode = define({
  $schema: SCHEMA_URL,
  fields: {
    ...position,
    ...look,
    src: { type: 'url', protocols: ['https:'] },
    fit: { type: 'enum', options: ['cover', 'contain'], render: 'segmented' },
    corner: { type: 'int', min: 0, max: 32, render: 'slider' },
    shadow: { type: 'variant', key: 'kind', variants: { none: { label: 'None', fields: {} }, drop } },
  },
  groups,
});

interface CanvasNode {
  readonly name: string;
  readonly spec: Spec;
  readonly values: unknown;
}

const NODES: readonly CanvasNode[] = [
  {
    name: 'Title',
    spec: textNode,
    values: { x: 40, y: 32, opacity: 1, rotation: 0, text: 'Quarterly report', font: 'serif', size: 32, shadow: { kind: 'none' } },
  },
  {
    name: 'Card',
    spec: shapeNode,
    values: { x: 24, y: 96, opacity: 0.9, rotation: 0, fill: '#3b82f6', corner: 12, shadow: { kind: 'drop', blur: 12, color: '#000000' } },
  },
  {
    name: 'Logo',
    spec: imageNode,
    values: {
      x: 40,
      y: 112,
      opacity: 1,
      rotation: -8,
      src: 'https://example.com/logo.png',
      fit: 'contain',
      corner: 12,
      shadow: { kind: 'drop', blur: 6, color: '#000000' },
    },
  },
  {
    name: 'Caption',
    spec: textNode,
    values: {
      x: 40,
      y: 220,
      opacity: 0.7,
      rotation: 0,
      text: 'Revenue by region',
      font: 'sans',
      size: 14,
      locked: true,
      shadow: { kind: 'none' },
    },
  },
];

const OUTPUTS = ['Common spec', 'Mixed and dropped', 'Node values'] as const;

export function Selection() {
  const [nodes, setNodes] = useState<readonly unknown[]>(() => NODES.map((n) => decode(n.spec, n.values)));
  const [selected, setSelected] = useState<readonly number[]>([1, 2]);
  const [match, setMatch] = useState<'all' | 'some'>('all');
  const [output, setOutput] = useState<(typeof OUTPUTS)[number]>('Common spec');

  // Summarized once per selection: edits are written back without re-summarizing, so a field
  // stays mixed until it is edited.
  const { common, form } = useMemo(() => {
    const common = commonFields(
      selected.map((i) => NODES[i]!.spec),
      { values: selected.map((i) => nodes[i]), match },
    );
    return { common, form: createForm(common.spec, { values: common.values, mixed: common.mixed }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, match]);
  useFormVersion(form);

  // The form is an outside store: write its edits back into each selected node as they happen.
  useEffect(
    () =>
      form.subscribe(() =>
        setNodes((all) => {
          const written = common.apply(
            form.values,
            selected.map((i) => all[i]),
          );
          return all.map((v, i) => (selected.includes(i) ? written[selected.indexOf(i)] : v));
        }),
      ),
    [form],
  );

  const toggle = (i: number) => setSelected((s) => (s.includes(i) ? s.filter((j) => j !== i) : [...s, i].sort((a, b) => a - b)));

  return (
    <div className="split">
      <section className="pane" data-fieldspec="">
        <div className="chips" role="group" aria-label="Selection">
          {NODES.map((n, i) => (
            <label key={n.name} className="chip" data-on={selected.includes(i) ? '' : undefined}>
              <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} /> {n.name}
              <small>{n.spec === textNode ? 'text' : n.spec === shapeNode ? 'shape' : 'image'}</small>
            </label>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Match">
          <button type="button" aria-pressed={match === 'all'} onClick={() => setMatch('all')}>
            Fields all share
          </button>
          <button type="button" aria-pressed={match === 'some'} onClick={() => setMatch('some')}>
            Fields any has
          </button>
        </div>
        {selected.length === 0 ? <p className="status">Select a node.</p> : <FormView key={`${selected.join(',')}:${match}`} form={form} />}
      </section>
      <section className="pane output">
        <div role="tablist">
          {OUTPUTS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={output === t} onClick={() => setOutput(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="output-body">
          {output === 'Common spec' && <JsonTree key="spec" value={common.spec} />}
          {output === 'Mixed and dropped' && (
            <JsonTree key="mixed" value={{ mixed: common.mixed, dropped: common.dropped, sources: common.sources }} depth={2} />
          )}
          {output === 'Node values' && (
            <JsonTree key="values" value={Object.fromEntries(NODES.map((n, i) => [n.name, encode(n.spec, nodes[i])]))} depth={2} />
          )}
        </div>
      </section>
    </div>
  );
}

export const selectionStyles = `
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); cursor: pointer; }
.chip[data-on] { background: color-mix(in srgb, #3b82f6 16%, transparent); border-color: #3b82f6; }
.chip small { opacity: 0.6; }
.chips button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; color: inherit; cursor: pointer; }
.chips button[aria-pressed="true"] { background: color-mix(in srgb, currentColor 12%, transparent); }
`;
