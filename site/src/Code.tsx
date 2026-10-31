/** Code blocks with light syntax colouring for TypeScript and JSON. */
import type { ReactNode } from 'react';

const TOKENS =
  /(\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)(\s*:)?|\b(import|from|export|const|type|return|new|await|function|typeof)\b|\b(true|false|null|undefined)\b|(-?\b\d[\d_]*(?:\.\d+)?\b)|\b([A-Z][A-Za-z0-9]*)\b/g;

export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(TOKENS)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [whole, comment, string, colon, keyword, literal, number, name] = m;
    const k = out.length;
    if (comment) {
      out.push(
        <span key={k} className="t-comment">
          {comment}
        </span>,
      );
    } else if (string && colon) {
      out.push(
        <span key={k} className="t-key">
          {string}
        </span>,
        colon,
      );
    } else if (string) {
      out.push(
        <span key={k} className="t-string">
          {string}
        </span>,
      );
    } else if (keyword) {
      out.push(
        <span key={k} className="t-keyword">
          {keyword}
        </span>,
      );
    } else if (literal || number) {
      out.push(
        <span key={k} className="t-literal">
          {literal ?? number}
        </span>,
      );
    } else if (name) {
      out.push(
        <span key={k} className="t-name">
          {name}
        </span>,
      );
    } else {
      out.push(whole);
    }
    last = m.index + whole.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function Code({ code, label, className }: { code: string; label?: string; className?: string }) {
  return (
    <figure className={`code ${className ?? ''}`}>
      {label && <figcaption>{label}</figcaption>}
      <pre>
        <code>{highlight(code)}</code>
      </pre>
    </figure>
  );
}

/** A value as pretty JSON, coloured. Maps, Sets, Dates and bigints are shown as JSON would carry them. */
export function Json({ value, label, className }: { value: unknown; label?: string; className?: string }) {
  const text = JSON.stringify(
    value,
    (_, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : typeof v === 'bigint' ? String(v) : v),
    2,
  );
  return <Code code={text ?? 'undefined'} label={label} className={className} />;
}
