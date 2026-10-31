/** A collapsible JSON viewer: objects and arrays fold, each remembering whether it is open. */
import { createContext, use, useState, type ReactNode } from 'react';

interface TreeOptions {
  /** Levels open at first. */
  readonly depth: number;
}

const Options = createContext<TreeOptions>({ depth: 2 });

export function JsonTree({ value, depth = 2 }: { value: unknown; depth?: number }) {
  const [generation, setGeneration] = useState(0);
  const [openTo, setOpenTo] = useState(depth);
  const [copied, setCopied] = useState(false);
  const reset = (to: number) => {
    setOpenTo(to);
    setGeneration((g) => g + 1);
  };
  const copy = async () => {
    await navigator.clipboard?.writeText(JSON.stringify(value, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="json-tree">
      <div className="json-toolbar">
        <button type="button" onClick={() => reset(Number.POSITIVE_INFINITY)}>
          Expand all
        </button>
        <button type="button" onClick={() => reset(1)}>
          Collapse all
        </button>
        <button type="button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <Options.Provider value={{ depth: openTo }}>
        <div className="json-body" role="tree" key={generation}>
          <Entry name={undefined} value={value} level={0} last />
        </div>
      </Options.Provider>
    </div>
  );
}

function Entry({ name, value, level, last }: { name: string | number | undefined; value: unknown; level: number; last: boolean }) {
  const { depth } = use(Options);
  const [open, setOpen] = useState(level < depth);
  const comma = last ? '' : ',';
  const key = name === undefined ? null : typeof name === 'number' ? null : <span className="json-key">{JSON.stringify(name)}: </span>;

  if (value === null || typeof value !== 'object') {
    return (
      <div className="json-line" role="treeitem" style={{ paddingLeft: indent(level) }}>
        {key}
        <Scalar value={value} />
        {comma}
      </div>
    );
  }

  const entries: [string | number, unknown][] = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  const [openMark, closeMark] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) {
    return (
      <div className="json-line" role="treeitem" style={{ paddingLeft: indent(level) }}>
        {key}
        <span className="json-punct">
          {openMark}
          {closeMark}
        </span>
        {comma}
      </div>
    );
  }
  const summary = Array.isArray(value)
    ? `${entries.length} item${entries.length === 1 ? '' : 's'}`
    : `${entries.length} key${entries.length === 1 ? '' : 's'}`;
  return (
    <div role="treeitem" aria-expanded={open}>
      <button type="button" className="json-line json-toggle" style={{ paddingLeft: indent(level) }} onClick={() => setOpen(!open)}>
        <span className="json-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        {key}
        <span className="json-punct">{openMark}</span>
        {!open && (
          <>
            <span className="json-summary"> {summary} </span>
            <span className="json-punct">{closeMark}</span>
            {comma}
          </>
        )}
      </button>
      {open && (
        <div role="group" className="json-children">
          {entries.map(([k, v], i) => (
            <Entry key={k} name={k} value={v} level={level + 1} last={i === entries.length - 1} />
          ))}
          <div className="json-line" style={{ paddingLeft: indent(level) }}>
            <span className="json-punct">{closeMark}</span>
            {comma}
          </div>
        </div>
      )}
    </div>
  );
}

function Scalar({ value }: { value: unknown }): ReactNode {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === 'string') return <span className="json-string">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="json-number">{value}</span>;
  if (typeof value === 'boolean') return <span className="json-boolean">{String(value)}</span>;
  // What is left has no JSON form: undefined, a bigint, a symbol or a function.
  if (typeof value === 'undefined' || typeof value === 'bigint' || typeof value === 'symbol')
    return <span className="json-null">{String(value)}</span>;
  return <span className="json-null">{typeof value === 'function' ? value.toString() : JSON.stringify(value)}</span>;
}

const indent = (level: number) => `calc(${level} * 1.25em + 1.1em)`;

export const jsonTreeStyles = `
.json-tree { font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.json-toolbar { display: flex; gap: 4px; margin-bottom: 8px; }
.json-tree .json-toolbar button { font: 12px system-ui, sans-serif; padding: 2px 8px; }
.json-body { overflow: auto; max-height: 72vh; }
.json-line { display: block; white-space: pre-wrap; word-break: break-word; position: relative; }
.json-tree button.json-toggle { all: unset; display: block; width: 100%; box-sizing: border-box; cursor: pointer; border-radius: 4px; position: relative; }
.json-tree button.json-toggle:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
.json-tree button.json-toggle:focus-visible { outline: 2px solid #3b82f6; }
.json-caret { position: absolute; margin-left: -1.1em; width: 1em; text-align: center; opacity: 0.6; }
.json-children { border-left: 1px solid color-mix(in srgb, currentColor 12%, transparent); margin-left: 0.4em; }
.json-key { color: var(--json-key); }
.json-string { color: var(--json-string); }
.json-number { color: var(--json-number); }
.json-boolean { color: var(--json-boolean); }
.json-null { color: var(--json-null); }
.json-punct { opacity: 0.6; }
.json-summary { opacity: 0.55; font-style: italic; }
:root { --json-key: #7c3aed; --json-string: #15803d; --json-number: #1d4ed8; --json-boolean: #b45309; --json-null: #6b7280; }
@media (prefers-color-scheme: dark) {
  :root { --json-key: #c4b5fd; --json-string: #86efac; --json-number: #93c5fd; --json-boolean: #fcd34d; --json-null: #9ca3af; }
}
`;
