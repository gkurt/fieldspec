/**
 * `fieldspec/js`: runs `$js`, the JavaScript expressions of a spec, sandboxed in QuickJS compiled
 * to WebAssembly (`@gkurt/quickjs-wasi`). It is an entry point of its own, so an application
 * that does not use it carries none of the engine.
 *
 * Code runs synchronously, in one VM per language, with a time, memory and stack limit on each
 * run. It reads only its `args`, which arrive as JSON, with dates, bigints, maps, sets, bytes and
 * regular expressions rebuilt on the other side; a URL arrives as its text. The VM's globals are
 * frozen, so one expression cannot change what another sees.
 */
import { EvalFlags, JSException, QuickJSInstance, type JSValueHandle, type QuickJS } from '@gkurt/quickjs-wasi';
import type { Language } from './expr.ts';

export interface JsOptions {
  /** The longest one run may take, in milliseconds. Default 50. */
  readonly timeout?: number;
  /** The most memory the VM may hold, in bytes. Default 16 MiB. */
  readonly memoryLimit?: number;
  /** The most stack recursion may use, in bytes. Default 256 KiB, which every host's main thread has room for. */
  readonly maxStackSize?: number;
}

/** A language that runs `$js`. Give it to a registry: `createRegistry({ languages: [js] })`. */
export interface JsLanguage extends Language {
  /** Frees the VM and its WebAssembly instance. */
  dispose(): void;
}

/** The engine, `@gkurt/quickjs-wasi/quickjs.wasm`: compiled, its bytes, or a response that fetches them. */
export type WasmSource = WebAssembly.Module | BufferSource | Response | PromiseLike<Response>;

/** Compiles the engine and makes a language of it. */
export async function loadJs(wasm: WasmSource, options?: JsOptions): Promise<JsLanguage> {
  return createJs(await compile(wasm), options);
}

/** A language from the engine already compiled, synchronously. */
export function createJs(wasm: WebAssembly.Module, options: JsOptions = {}): JsLanguage {
  const { timeout = 50, memoryLimit = 16 << 20, maxStackSize = 256 << 10 } = options;
  const instance = QuickJSInstance.createSync({ wasm });
  const compiled = new Map<string, JSValueHandle>();
  let deadline = Infinity;
  let vm: QuickJS | undefined;
  let wrap: JSValueHandle | undefined;

  const open = (): QuickJS => {
    if (vm) return vm;
    vm = instance.newVm({ memoryLimit, maxStackSize, interruptHandler: () => Date.now() > deadline });
    wrap = vm.evalCode(PRELUDE, 'fieldspec.js', EvalFlags.STRICT);
    return vm;
  };
  const close = () => {
    for (const fn of compiled.values()) fn.dispose();
    compiled.clear();
    wrap?.dispose();
    vm?.dispose();
    vm = wrap = undefined;
  };
  /** Runs `fn` within the time limit, and turns what the guest throws into an Error of its own. */
  const limited = <T>(fn: () => T): T => {
    deadline = Date.now() + timeout;
    try {
      return fn();
    } catch (error) {
      if (!(error instanceof JSException)) {
        // The host's stack overflowed, or the VM trapped: it is left unusable.
        close();
        throw new Error(`the code stopped the engine: ${(error as Error).message}`, { cause: error });
      }
      const message = error.message === 'interrupted' ? `ran past its ${timeout} ms limit` : `${error.name}: ${error.message}`;
      error.dispose();
      throw new Error(message, { cause: error });
    } finally {
      deadline = Infinity;
    }
  };
  const functionFor = (source: string, names: readonly string[]): JSValueHandle => {
    const key = `${names.join(',')}\n${source}`;
    const known = compiled.get(key);
    if (known) return known;
    const vm = open();
    const fn = limited(() => vm.evalCode(functionSource(source, names), 'spec.js', EvalFlags.STRICT));
    const wrapped = vm.callFunction(wrap!, vm.undefined, fn);
    fn.dispose();
    compiled.set(key, wrapped);
    return wrapped;
  };

  return {
    key: '$js',
    description:
      '`{ "$js": "<a JavaScript expression>", "args": { "x": <expr> } }` runs JavaScript in a sandbox, wherever an expression or the value a condition tests may go. ' +
      'Each arg is a variable of the code, and the code reads nothing else: pass what it needs as args (`{ "$state": … }`). Dates, bigints, maps and sets arrive as themselves. ' +
      'Prefer the expressions above, and use `$js` for what they cannot say: `{ "$js": "end >= start", "args": { "start": { "$state": "start" }, "end": { "$state": "end" } } }`.',
    check(source, names) {
      try {
        open()
          .evalCode(functionSource(source, [...names].sort()), 'spec.js', EvalFlags.STRICT | EvalFlags.COMPILE_ONLY)
          .dispose();
        return undefined;
      } catch (error) {
        if (!(error instanceof JSException)) throw error;
        const message = `${error.name}: ${error.message}`;
        error.dispose();
        return message;
      }
    },
    run(source, args) {
      const fn = functionFor(source, Object.keys(args).sort());
      const vm = open();
      const json = limited(() => {
        const input = vm.newString(JSON.stringify(args, replace));
        try {
          return vm.callFunction(fn, vm.undefined, input).consume((h) => (h.isString ? h.toString() : undefined));
        } finally {
          input.dispose();
        }
      });
      return json === undefined ? undefined : JSON.parse(json, revive);
    },
    dispose() {
      close();
      instance.dispose();
    },
  };
}

async function compile(wasm: WasmSource): Promise<WebAssembly.Module> {
  if (wasm instanceof WebAssembly.Module) return wasm;
  const source = await wasm;
  return WebAssembly.compile(
    typeof Response !== 'undefined' && source instanceof Response ? await source.arrayBuffer() : (source as BufferSource),
  );
}

/** The code as a function of its args. The script is strict, so it cannot make globals. */
const functionSource = (source: string, names: readonly string[]) => `(function ({ ${names.join(', ')} }) {\nreturn (\n${source}\n);\n})`;

// Values cross as JSON, with what JSON cannot hold tagged by a key no spec writes.
const TAG = '\u0000';

function replace(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const v = this[key];
  if (v instanceof Date) return { [TAG]: 'date', v: v.getTime() };
  if (typeof v === 'bigint') return { [TAG]: 'bigint', v: String(v) };
  if (v instanceof Map) return { [TAG]: 'map', v: [...v] };
  if (v instanceof Set) return { [TAG]: 'set', v: [...v] };
  if (v instanceof Uint8Array) return { [TAG]: 'bytes', v: [...v] };
  if (v instanceof RegExp) return { [TAG]: 'regexp', v: v.source, flags: v.flags };
  if (v instanceof URL) return v.href;
  return value;
}

function revive(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || !(TAG in value)) return value;
  const { [TAG]: tag, v, flags } = value as { [TAG]: string; v: unknown; flags?: string };
  switch (tag) {
    case 'date':
      return new Date((v as number | null) ?? Number.NaN);
    case 'bigint':
      return BigInt(v as string);
    case 'map':
      return new Map(v as [unknown, unknown][]);
    case 'set':
      return new Set(v as unknown[]);
    case 'bytes':
      return new Uint8Array(v as number[]);
    case 'regexp':
      return new RegExp(v as string, flags);
    default:
      return value;
  }
}

/** The guest's half: the same encoding, a `wrap` that runs code over it, and the globals frozen. */
const PRELUDE = `(() => {
  const { parse, stringify } = JSON;
  const TAG = '\\u0000';
  const replace = function (key, value) {
    const v = this[key];
    if (v instanceof Date) return { [TAG]: 'date', v: v.getTime() };
    if (typeof v === 'bigint') return { [TAG]: 'bigint', v: String(v) };
    if (v instanceof Map) return { [TAG]: 'map', v: [...v] };
    if (v instanceof Set) return { [TAG]: 'set', v: [...v] };
    if (v instanceof Uint8Array) return { [TAG]: 'bytes', v: [...v] };
    if (v instanceof RegExp) return { [TAG]: 'regexp', v: v.source, flags: v.flags };
    return value;
  };
  const revive = (key, value) => {
    if (value === null || typeof value !== 'object' || !(TAG in value)) return value;
    const v = value.v;
    switch (value[TAG]) {
      case 'date': return new Date(v ?? NaN);
      case 'bigint': return BigInt(v);
      case 'map': return new Map(v);
      case 'set': return new Set(v);
      case 'bytes': return new Uint8Array(v);
      case 'regexp': return new RegExp(v, value.flags);
      default: return value;
    }
  };
  const wrap = (fn) => (json) => stringify(fn(parse(json, revive)), replace);
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    const v = globalThis[name];
    if (typeof v === 'function' || (typeof v === 'object' && v !== null)) {
      Object.freeze(v);
      if (typeof v === 'function' && v.prototype) Object.freeze(v.prototype);
    }
  }
  Object.freeze(globalThis);
  return wrap;
})()`;
