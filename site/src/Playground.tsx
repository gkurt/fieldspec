/** Edit a spec as JSON: the checker, the form and the values follow as you type. */
import { Component, useMemo, useState, type ReactNode } from 'react';
import { htmlRenderers } from '#examples/renderers/html.tsx';
import { checkSpec, createForm, type Fault, type Form, type Spec } from '#src/index.ts';
import { FormView, useFormState } from '#src/react/index.tsx';
import { Json } from './Code.tsx';
import { PLAYGROUND } from './specs.ts';

const text = (spec: Spec) => JSON.stringify(spec, null, 2);

export function Playground() {
  const [preset, setPreset] = useState('Sign-up');
  const [source, setSource] = useState(() => text(PLAYGROUND['Sign-up']!));
  const parsed = useMemo((): { spec?: Spec; error?: string } => {
    try {
      return { spec: JSON.parse(source) as Spec };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [source]);
  const faults = useMemo(() => (parsed.spec ? checkSpec(parsed.spec) : []), [parsed.spec]);
  const form = useMemo((): Form | undefined => {
    if (!parsed.spec) return undefined;
    try {
      return createForm(parsed.spec);
    } catch {
      return undefined;
    }
  }, [parsed.spec]);
  const errors = faults.filter((f) => f.severity === 'error').length;

  return (
    <div className="playground">
      <div className="pg-editor card">
        <div className="pg-bar">
          <div className="seg" role="group" aria-label="Example">
            {Object.keys(PLAYGROUND).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={preset === name}
                onClick={() => {
                  setPreset(name);
                  setSource(text(PLAYGROUND[name]!));
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <span className={`badge ${parsed.error || errors > 0 ? 'bad' : 'good'}`}>
            {parsed.error
              ? 'Not JSON'
              : errors > 0
                ? `${errors} error${errors === 1 ? '' : 's'}`
                : faults.length > 0
                  ? `${faults.length} warning${faults.length === 1 ? '' : 's'}`
                  : 'Valid spec'}
          </span>
        </div>
        <textarea aria-label="Spec JSON" spellCheck={false} value={source} onChange={(e) => setSource(e.target.value)} />
        <Faults faults={faults} error={parsed.error} />
      </div>
      <div className="pg-out">
        <div className="card form-card" data-fieldspec="">
          {form ? (
            <Boundary key={source}>
              <Live form={form} />
            </Boundary>
          ) : (
            <p className="caption">Fix the JSON to see the form.</p>
          )}
        </div>
        {form && <Values form={form} />}
      </div>
    </div>
  );
}

function Faults({ faults, error }: { faults: readonly Fault[]; error?: string }) {
  if (error) {
    return (
      <ul className="faults">
        <li className="error">
          <code>JSON</code> {error}
        </li>
      </ul>
    );
  }
  if (faults.length === 0) return <p className="faults-none">The checker has nothing to say.</p>;
  return (
    <ul className="faults" aria-label="What the checker says">
      {faults.map((f) => (
        <li key={`${f.path}:${f.message}`} className={f.severity}>
          <code>{f.path || '/'}</code> {f.message}
        </li>
      ))}
    </ul>
  );
}

function Live({ form }: { form: Form }) {
  return <FormView form={form} renderers={htmlRenderers} />;
}

function Values({ form }: { form: Form }) {
  const { json, issues } = useFormState(form);
  return (
    <Json
      value={{ values: json, issues: issues.map((i) => `${i.path}: ${i.message}`) }}
      label="form.json() and form.issues"
      className="pg-values"
    />
  );
}

/** A spec halfway through being typed may not draw; that is shown, not thrown. */
class Boundary extends Component<{ children: ReactNode }, { error?: string }> {
  override state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  override render() {
    return this.state.error ? <p className="caption">Cannot draw this yet: {this.state.error}</p> : this.props.children;
  }
}
