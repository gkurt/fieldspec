/** Several canvas nodes of different kinds, selected together and edited with one form: `commonFields`. */
import { useEffect, useMemo, useState } from 'react';
import { htmlRenderers } from '#examples/renderers/html.tsx';
import { commonFields, createForm, define } from '#src/index.ts';
import { FormView, useFormVersion } from '#src/react/index.tsx';

const place = {
  x: { type: 'int', min: 0, max: 300, group: 'at' },
  y: { type: 'int', min: 0, max: 180, group: 'at' },
} as const;
const look = {
  opacity: { use: 'percent', default: 1 },
  rotation: { type: 'int', min: -45, max: 45, unit: '°', render: 'slider' },
} as const;
const groups = { at: { label: 'Position', render: 'row' } } as const;

const textNode = define({
  fields: {
    ...place,
    ...look,
    text: { type: 'string' },
    color: { use: 'color' },
    size: { type: 'int', min: 10, max: 40, render: 'slider' },
  },
  groups,
});
const shapeNode = define({
  fields: { ...place, ...look, fill: { use: 'color' }, corner: { type: 'int', min: 0, max: 40, render: 'slider' } },
  groups,
});

interface Node {
  readonly name: string;
  readonly kind: 'text' | 'shape';
}
const NODES: readonly Node[] = [
  { name: 'Card', kind: 'shape' },
  { name: 'Dot', kind: 'shape' },
  { name: 'Title', kind: 'text' },
  { name: 'Caption', kind: 'text' },
];
const START: readonly Record<string, unknown>[] = [
  { x: 24, y: 28, opacity: 1, rotation: -4, fill: '#2563eb', corner: 16 },
  { x: 236, y: 110, opacity: 0.9, rotation: 0, fill: '#f59e0b', corner: 40 },
  { x: 48, y: 50, opacity: 1, rotation: -4, text: 'Quarterly report', color: '#ffffff', size: 22 },
  { x: 48, y: 88, opacity: 0.7, rotation: -4, text: 'Revenue by region', color: '#dbe5ff', size: 13 },
];
const specOf = (n: Node) => (n.kind === 'text' ? textNode : shapeNode);

export function Canvas() {
  const [values, setValues] = useState(START);
  const [selected, setSelected] = useState<readonly number[]>([0, 2]);

  // Summarized once per selection; edits are written back to each node, so a field stays
  // "Mixed" until it is edited.
  const { common, form } = useMemo(() => {
    const common = commonFields(
      selected.map((i) => specOf(NODES[i]!)),
      { values: selected.map((i) => values[i]) },
    );
    return { common, form: createForm(common.spec, { values: common.values, mixed: common.mixed }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  useFormVersion(form);
  // The form is an outside store: write its edits back into each selected node as they happen.
  useEffect(
    () =>
      form.subscribe(() =>
        setValues((all) => {
          const written = common.apply(
            form.values,
            selected.map((i) => all[i]),
          );
          return all.map((v, i) => (selected.includes(i) ? (written[selected.indexOf(i)] as Record<string, unknown>) : v));
        }),
      ),
    [form],
  );
  const toggle = (i: number) => setSelected((s) => (s.includes(i) ? s.filter((j) => j !== i) : [...s, i].sort((a, b) => a - b)));

  return (
    <div className="canvas-demo">
      <div>
        <div className="canvas" role="group" aria-label="Canvas: click nodes to select them">
          {NODES.map((n, i) => {
            const v = values[i]!;
            const style = {
              left: Number(v.x),
              top: Number(v.y),
              opacity: Number(v.opacity),
              transform: `rotate(${Number(v.rotation)}deg)`,
            };
            return (
              <button
                key={n.name}
                type="button"
                className={`node node-${n.kind}`}
                aria-pressed={selected.includes(i)}
                onClick={() => toggle(i)}
                style={
                  n.kind === 'shape'
                    ? {
                        ...style,
                        background: String(v.fill),
                        borderRadius: Number(v.corner),
                        width: i === 0 ? 260 : 64,
                        height: i === 0 ? 120 : 64,
                      }
                    : { ...style, fontSize: Number(v.size), color: String(v.color) }
                }
              >
                {n.kind === 'text' ? String(v.text) : <span className="sr-only">{n.name}</span>}
              </button>
            );
          })}
        </div>
        <p className="caption">
          Click to select. Selected: {selected.length > 0 ? selected.map((i) => NODES[i]!.name).join(', ') : 'nothing'}.
          {common.dropped.length > 0 && <> Left out: {[...new Set(common.dropped.map((d) => d.path.slice(1)))].join(', ')}.</>}
        </p>
      </div>
      <div className="card form-card" data-fieldspec="">
        {selected.length === 0 ? (
          <p className="caption">Select a node to edit it.</p>
        ) : (
          <FormView key={selected.join(',')} form={form} renderers={htmlRenderers} />
        )}
      </div>
    </div>
  );
}
