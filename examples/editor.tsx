import type { Edit, SpecEditor, SpecFields, SpecNode, SpecProp } from 'fieldspec';
import { useSpecEditorState } from 'fieldspec/react';
/**
 * fieldspec's spec editor in plain HTML: the description a spec is written from, its fields as
 * rows that nest (an object's fields, a list's items, a variant's variants), and its JSON. An
 * example to copy and restyle, like the renderer sets beside it; `editorStyles` is its look, all
 * `fse-*` classes. The editor holds the state and checks every edit; this only draws.
 *
 * `<SpecEditorView editor={useSpecEditor({ spec, generate, describe })} generate describe />`,
 * with `<style>{editorStyles}</style>` once.
 */
import { useState, type ReactNode } from 'react';

/** What the properties under "More" are drawn from; the rest have rows and lists of their own. */
const STRUCTURE = new Set(['items', 'values', 'keys', 'fields', 'variants', 'groups']);
const MORE = ['description', 'hint', 'placeholder', 'default'];

/** A text box that keeps what is typed until it is left or Enter is pressed, then commits it. */
function Draft(props: { value: string; commit: (text: string) => Edit; label: string; className?: string; placeholder?: string }) {
  const [draft, setDraft] = useState({ text: props.value, of: props.value });
  // A value changed elsewhere, or an edit that was refused, shows what the spec says again.
  if (draft.of !== props.value) setDraft({ text: props.value, of: props.value });
  const text = draft.text;
  const setText = (next: string) => setDraft({ text: next, of: props.value });
  const commit = () => {
    if (text !== props.value && !props.commit(text).ok) setText(props.value);
  };
  return (
    <input
      className={props.className}
      aria-label={props.label}
      placeholder={props.placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

const typesOf = (prop: SpecProp) => (Array.isArray(prop.schema.type) ? prop.schema.type : [prop.schema.type]);

/** One property of a declaration: a checkbox, a number or text box by its schema, else JSON. */
function Prop({ editor, path, prop }: { editor: SpecEditor; path: string; prop: SpecProp }) {
  const at = `${path}/${prop.name}`;
  const types = typesOf(prop);
  const label = `${prop.name} of ${path}`;
  if (types.includes('boolean') && types.length === 1) {
    return (
      <label className="fse-prop" title={prop.description}>
        <input type="checkbox" checked={prop.value === true} onChange={(e) => editor.set(at, e.target.checked || undefined)} />
        {prop.name}
      </label>
    );
  }
  const plain = prop.value === undefined || typeof prop.value === 'string';
  const asText = (types.includes('string') && types.length === 1) || (prop.schema.$ref === '#/$defs/text' && plain);
  const shown = prop.value === undefined ? '' : typeof prop.value === 'string' && asText ? prop.value : JSON.stringify(prop.value);
  const commit = (text: string) => {
    if (text.trim() === '') return editor.set(at, undefined);
    if (asText) return editor.set(at, text);
    let value: unknown = text;
    try {
      value = JSON.parse(text);
    } catch {
      // Not JSON: taken as the text it is.
    }
    return editor.set(at, value);
  };
  const inherited = prop.inherited === undefined ? undefined : JSON.stringify(prop.inherited);
  return (
    <label className="fse-prop" title={prop.description}>
      {prop.name}
      <Draft label={label} value={shown} commit={commit} placeholder={inherited} />
    </label>
  );
}

function Row({ editor, node, index }: { editor: SpecEditor; node: SpecNode; index: number }) {
  const [more, setMore] = useState(false);
  const keyed = node.slot === 'field' || node.slot === 'def';
  const props = editor.props(node.path).filter((p) => !STRUCTURE.has(p.name) && (p.own || MORE.includes(p.name)));
  const faults = editor.faultsAt(node.path).filter((f) => f.path === node.path || !f.path.slice(node.path.length + 1).includes('/'));
  return (
    <li className="fse-row">
      <div className="fse-line">
        {keyed ? (
          <Draft className="fse-key" label={`Key of ${node.path}`} value={node.key} commit={(key) => editor.rename(node.path, key)} />
        ) : (
          <span className="fse-key">{node.key}</span>
        )}
        <select aria-label={`Kind of ${node.path}`} value={node.kind} onChange={(e) => editor.setKind(node.path, e.target.value)}>
          {editor.kinds.map((kind) => (
            <option key={kind}>{kind}</option>
          ))}
        </select>
        {node.use !== undefined && <span className="fse-use">uses {node.use}</span>}
        <Draft
          label={`Label of ${node.path}`}
          placeholder={node.label}
          value={typeof node.decl.label === 'string' ? node.decl.label : ''}
          commit={(text) => editor.set(`${node.path}/label`, text === '' ? undefined : text)}
        />
        <label>
          <input
            type="checkbox"
            aria-label={`${node.path} is required`}
            checked={node.required}
            onChange={(e) => editor.set(`${node.path}/required`, e.target.checked || undefined)}
          />
          Required
        </label>
        <label>
          <input
            type="checkbox"
            aria-label={`${node.path} is optional`}
            checked={node.optional}
            onChange={(e) => editor.set(`${node.path}/optional`, e.target.checked || undefined)}
          />
          Optional
        </label>
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)}>
          More
        </button>
        {keyed && (
          <>
            <button
              type="button"
              aria-label={`Move ${node.path} up`}
              disabled={index === 0}
              onClick={() => editor.move(node.path, index - 1)}
            >
              ↑
            </button>
            <button type="button" aria-label={`Move ${node.path} down`} onClick={() => editor.move(node.path, index + 1)}>
              ↓
            </button>
            <button type="button" aria-label={`Remove ${node.path}`} onClick={() => editor.remove(node.path)}>
              ×
            </button>
          </>
        )}
      </div>
      {more && (
        <div className="fse-props">
          {props.map((prop) => (
            <Prop key={prop.name} editor={editor} path={node.path} prop={prop} />
          ))}
        </div>
      )}
      {faults.map((fault) => (
        <p key={fault.path + fault.message} className={`fse-fault fse-${fault.severity}`}>
          {fault.path.slice(node.path.length + 1) || 'This field'}: {fault.message}
        </p>
      ))}
      {node.fields && <Fields editor={editor} fields={node.fields} />}
      {[node.keys, node.items, node.values].map(
        (inner) =>
          inner && (
            <ul key={inner.path} className="fse-fields">
              <Row editor={editor} node={inner} index={0} />
            </ul>
          ),
      )}
      {node.variants && (
        <div className="fse-variants">
          {node.variants.map((variant) => (
            <fieldset key={variant.path}>
              <legend>
                <Draft label={`Name of ${variant.path}`} value={variant.name} commit={(name) => editor.rename(variant.path, name)} />
                <button type="button" aria-label={`Remove ${variant.path}`} onClick={() => editor.remove(variant.path)}>
                  ×
                </button>
              </legend>
              <Fields editor={editor} fields={variant.fields} />
            </fieldset>
          ))}
          <button type="button" onClick={() => editor.add(`${node.path}/variants`)}>
            Add a variant
          </button>
        </div>
      )}
    </li>
  );
}

function Fields({ editor, fields, add = 'Add a field' }: { editor: SpecEditor; fields: SpecFields; add?: string }) {
  return (
    <ul className="fse-fields">
      {fields.nodes.map((node, index) => (
        <Row key={node.path} editor={editor} node={node} index={index} />
      ))}
      <li>
        <button type="button" onClick={() => editor.add(fields.path)}>
          {add}
        </button>
      </li>
    </ul>
  );
}

/** The spec's JSON, edited as text and applied when asked. */
function JsonWay({ editor }: { editor: SpecEditor }) {
  const { version } = useSpecEditorState(editor);
  const [draft, setDraft] = useState(() => ({ text: editor.json(), version }));
  // A spec changed another way is shown anew, unless the text was refused and is being fixed.
  if (draft.version !== version) setDraft({ text: editor.refused ? draft.text : editor.json(), version });
  const text = draft.text;
  const setText = (next: string) => setDraft({ text: next, version });
  return (
    <details className="fse-json">
      <summary>JSON</summary>
      <textarea aria-label="The spec as JSON" rows={14} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" onClick={() => editor.applyJson(text)}>
        Apply
      </button>
    </details>
  );
}

export interface SpecEditorViewProps {
  readonly editor: SpecEditor;
  /** The editor was given `generate`: offer to write the spec from the description. */
  readonly generate?: boolean;
  /** The editor was given `describe`: offer to write the description from the spec. */
  readonly describe?: boolean;
  /** Asked before a generate replaces fields no description wrote. Default: `window.confirm`. */
  readonly confirm?: (keys: readonly string[]) => boolean;
  readonly children?: ReactNode;
}

export function SpecEditorView({ editor, generate, describe, confirm, children }: SpecEditorViewProps) {
  const state = useSpecEditorState(editor);
  const ask = confirm ?? ((keys) => window.confirm(`Write the spec again from the description? It replaces ${keys.join(', ')}.`));
  const busy = state.pending !== undefined;
  return (
    <div className="fse">
      <label className="fse-description">
        Description
        <textarea
          rows={3}
          placeholder="What the values are for and which ones there are, in plain words"
          value={state.description}
          onChange={(e) => editor.setDescription(e.target.value)}
        />
      </label>
      <div className="fse-line">
        {generate && (
          <button
            type="button"
            disabled={busy || state.description.trim() === ''}
            onClick={() => {
              if (state.replaces.length === 0 || ask(state.replaces)) void editor.generate();
            }}
          >
            {state.pending === 'generate' ? 'Writing…' : 'Write the fields from it'}
          </button>
        )}
        {describe && (
          <button type="button" disabled={busy || state.fields.nodes.length === 0} onClick={() => void editor.describe()}>
            {state.pending === 'describe' ? 'Describing…' : 'Describe the fields'}
          </button>
        )}
        {state.stale && <span className="fse-stale">The description is out of date.</span>}
      </div>
      <Fields editor={editor} fields={state.fields} />
      {state.defs.nodes.length > 0 && (
        <>
          <h4>Definitions</h4>
          <Fields editor={editor} fields={state.defs} add="Add a definition" />
        </>
      )}
      {state.refused && (
        <div role="alert" className="fse-refused">
          <p>Not applied:</p>
          {state.refused.parse !== undefined && <p className="fse-fault fse-error">{state.refused.parse}</p>}
          {state.refused.faults.map((fault) => (
            <p key={fault.path + fault.message} className="fse-fault fse-error">
              {fault.path || '/'}: {fault.message}
            </p>
          ))}
        </div>
      )}
      <JsonWay editor={editor} />
      {children}
    </div>
  );
}

export const editorStyles = `
.fse { display: flex; flex-direction: column; gap: 12px; font: inherit; }
.fse-description { display: flex; flex-direction: column; gap: 4px; }
.fse textarea { font: inherit; width: 100%; box-sizing: border-box; }
.fse-json textarea { font-family: ui-monospace, monospace; font-size: 12px; }
.fse-fields { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.fse-row > .fse-fields, .fse-variants { margin: 6px 0 0 16px; padding-left: 12px; border-left: 2px solid color-mix(in srgb, currentColor 15%, transparent); }
.fse-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fse-line input:not([type='checkbox']) { width: 7em; min-width: 0; }
.fse-line .fse-key { width: 7em; font-family: ui-monospace, monospace; }
.fse-line button { padding: 0 6px; }
.fse-use { opacity: 0.7; font-size: 12px; }
.fse-props { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; margin: 6px 0 0 16px; }
.fse-prop { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.fse-prop:has(input[type='checkbox']) { flex-direction: row; align-items: center; gap: 6px; }
.fse-variants { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.fse-variants fieldset { width: 100%; box-sizing: border-box; }
.fse-fault { margin: 2px 0 0; font-size: 12px; }
.fse-error { color: #b42318; }
.fse-warning { color: #93570a; }
.fse-stale { font-size: 12px; color: #93570a; }
.fse-refused p { margin: 0; }
`;
