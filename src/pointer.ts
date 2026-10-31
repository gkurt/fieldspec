/** JSON Pointers (RFC 6901), over values that may hold Maps and Sets as well as JSON. */

export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`not a JSON Pointer: "${pointer}"`);
  return pointer.slice(1).split('/').map(unescapeSegment);
}

export function formatPointer(segments: readonly (string | number)[]): string {
  return segments.map((s) => `/${escapeSegment(String(s))}`).join('');
}

export function joinPointer(base: string, ...segments: (string | number)[]): string {
  return base + formatPointer(segments);
}

export function escapeSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapeSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Resolve a pointer written in a spec against a scope: `/a` is absolute, `a/b` is relative to
 * `base`, `""` is `base` itself.
 */
export function resolvePointer(ref: string, base: string): string {
  if (ref.startsWith('/')) return ref;
  let at = base;
  let rest = ref;
  for (;;) {
    if (rest === '..' || rest.startsWith('../')) {
      at = at.slice(0, Math.max(0, at.lastIndexOf('/')));
      rest = rest.slice(3);
    } else if (rest === '.' || rest.startsWith('./')) {
      rest = rest.slice(2);
    } else {
      break;
    }
  }
  return rest === '' ? at : `${at}/${rest}`;
}

/** The same climb over static segments, for checking pointers against declarations. */
export function resolveSegments(ref: string, base: readonly string[]): string[] {
  if (ref.startsWith('/')) return ref.slice(1).split('/').map(unescapeSegment);
  const at = [...base];
  let rest = ref;
  for (;;) {
    if (rest === '..' || rest.startsWith('../')) {
      at.pop();
      rest = rest.slice(3);
    } else if (rest === '.' || rest.startsWith('./')) {
      rest = rest.slice(2);
    } else {
      break;
    }
  }
  return rest === '' ? at : [...at, ...rest.split('/').map(unescapeSegment)];
}

export function getAt(root: unknown, pointer: string): unknown {
  let node = root;
  for (const segment of parsePointer(pointer)) {
    node = child(node, segment);
    if (node === undefined) return undefined;
  }
  return node;
}

/** One step into a value: a key of an object or map, or an index of an array. */
export function child(node: unknown, segment: string): unknown {
  if (node instanceof Map) {
    if (node.has(segment)) return node.get(segment);
    for (const [key, value] of node) if (String(key) === segment) return value;
    return undefined;
  }
  if (Array.isArray(node)) return node[Number(segment)];
  if (node && typeof node === 'object') return (node as Record<string, unknown>)[segment];
  return undefined;
}

/**
 * A copy of `root` with `value` at `pointer`, sharing every untouched branch. `undefined`
 * removes. `-` appends to an array.
 */
export function setAt(root: unknown, pointer: string, value: unknown): unknown {
  return setSegments(root, parsePointer(pointer), value);
}

function setSegments(node: unknown, segments: readonly string[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments as [string, ...string[]];
  if (Array.isArray(node)) {
    const copy = node.slice();
    const index = head === '-' ? copy.length : Number(head);
    const next = setSegments(copy[index], rest, value);
    if (next === undefined && rest.length === 0) copy.splice(index, 1);
    else copy[index] = next;
    return copy;
  }
  if (node instanceof Map) {
    const copy = new Map(node);
    let key: unknown = head;
    for (const k of copy.keys()) if (String(k) === head) key = k;
    const next = setSegments(copy.get(key), rest, value);
    if (next === undefined) copy.delete(key);
    else copy.set(key, next);
    return copy;
  }
  const copy: Record<string, unknown> = node && typeof node === 'object' ? { ...node } : {};
  const next = setSegments(copy[head], rest, value);
  if (next === undefined) delete copy[head];
  else copy[head] = next;
  return copy;
}

/** The pointer one level up, and the last segment. */
export function splitPointer(pointer: string): [parent: string, last: string] {
  const at = pointer.lastIndexOf('/');
  return [pointer.slice(0, at), unescapeSegment(pointer.slice(at + 1))];
}
