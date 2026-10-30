/**
 * JSON Patch (RFC 6902) over values: how an agent, a server or another tab edits them. Paths
 * are JSON Pointers; `-` appends to an array. Patches never mutate: each returns a new tree.
 */
import { equal } from "./expr.ts";
import { getAt, parsePointer, setAt, splitPointer } from "./pointer.ts";

export type PatchOp =
  | { readonly op: "add"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "replace"; readonly path: string; readonly value: unknown }
  | { readonly op: "move"; readonly from: string; readonly path: string }
  | { readonly op: "copy"; readonly from: string; readonly path: string }
  | { readonly op: "test"; readonly path: string; readonly value: unknown };

export class PatchError extends Error {
  constructor(
    readonly index: number,
    readonly path: string,
    message: string,
  ) {
    super(`patch ${index} at ${path || "/"}: ${message}`);
  }
}

function exists(root: unknown, pointer: string): boolean {
  if (pointer === "") return true;
  const [parent, last] = splitPointer(pointer);
  const node = getAt(root, parent);
  if (Array.isArray(node)) return /^\d+$/.test(last) && Number(last) < node.length;
  if (node instanceof Map) return [...node.keys()].some((k) => String(k) === last);
  return typeof node === "object" && node !== null && Object.hasOwn(node, last);
}

function add(root: unknown, pointer: string, value: unknown, i: number): unknown {
  if (pointer === "") return value;
  const [parent, last] = splitPointer(pointer);
  const node = getAt(root, parent);
  if (Array.isArray(node)) {
    const index = last === "-" ? node.length : Number(last);
    if (!Number.isInteger(index) || index < 0 || index > node.length) throw new PatchError(i, pointer, "index out of range");
    const copy = node.slice();
    copy.splice(index, 0, value);
    return setAt(root, parent, copy);
  }
  if (node === undefined || node === null || typeof node !== "object") throw new PatchError(i, pointer, "the parent does not exist");
  return setAt(root, pointer, value);
}

function remove(root: unknown, pointer: string, i: number): unknown {
  if (!exists(root, pointer)) throw new PatchError(i, pointer, "nothing to remove");
  return setAt(root, pointer, undefined);
}

/** Apply a patch. Throws {@link PatchError} on the first operation that cannot apply. */
export function applyPatch(root: unknown, patch: readonly PatchOp[]): unknown {
  return patch.reduce<unknown>((tree, op, i) => {
    parsePointer(op.path);
    switch (op.op) {
      case "add":
        return add(tree, op.path, op.value, i);
      case "remove":
        return remove(tree, op.path, i);
      case "replace":
        if (!exists(tree, op.path)) throw new PatchError(i, op.path, "nothing to replace; use add");
        return setAt(tree, op.path, op.value);
      case "move": {
        if (op.path.startsWith(`${op.from}/`)) throw new PatchError(i, op.path, "cannot move a value into itself");
        const value = getAt(tree, op.from);
        return add(remove(tree, op.from, i), op.path, value, i);
      }
      case "copy":
        if (!exists(tree, op.from)) throw new PatchError(i, op.from, "nothing to copy");
        return add(tree, op.path, structuredClone(getAt(tree, op.from)), i);
      case "test":
        if (!equal(getAt(tree, op.path), op.value)) throw new PatchError(i, op.path, "test failed");
        return tree;
      default:
        throw new PatchError(i, (op as { path: string }).path, `unknown op "${(op as { op: string }).op}"`);
    }
  }, root);
}
