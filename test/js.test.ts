import { afterAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { checkSpec, createForm, createRegistry, define, metaSchema, parse, prompt, validate, type Spec } from '#src/index.ts';
import { createJs, loadJs } from '#src/js.ts';

const wasm = await readFile(new URL(import.meta.resolve('@gkurt/quickjs-wasi/quickjs.wasm')));
const js = await loadJs(wasm);
const registry = createRegistry({ languages: [js] });
afterAll(() => js.dispose());

const booking = registry.define({
  fields: {
    start: { type: 'date' },
    end: { type: 'date', default: { $js: 'new Date(start.getTime() + 7 * 864e5)', args: { start: { $state: 'start' } } } },
    nights: {
      type: 'int',
      label: {
        $js: '`Nights (${Math.round((end - start) / 864e5)} booked)`',
        args: { start: { $state: 'start' }, end: { $state: 'end' } },
      },
    },
    late: { type: 'boolean', visible: { $js: 'end.getUTCHours() >= 20', args: { end: { $state: 'end' } } } },
  },
});

describe('$js', () => {
  test('defaults, labels and conditions run the code over their args', () => {
    const form = createForm(booking, { values: { start: '2026-03-01T00:00:00.000Z' } });
    expect(form.values.end).toEqual(new Date('2026-03-08T00:00:00.000Z'));
    expect(form.field('/nights')?.label).toBe('Nights (7 booked)');
    expect(form.field('/late')?.visible).toBe(false);
    form.set('/end', new Date('2026-03-08T21:00:00.000Z'));
    expect(form.field('/late')?.visible).toBe(true);
  });

  test('a condition compares what the code gives', () => {
    const spec = registry.define({
      fields: {
        tags: { type: 'set', items: { type: 'string' } },
        note: { type: 'string', required: { $js: 'tags.size', args: { tags: { $state: 'tags' } }, gte: 2 } },
      },
    });
    expect(parse(spec, { tags: ['a'] }).ok).toBe(true);
    expect(parse(spec, { tags: ['a', 'b'] }).issues.map((i) => i.path)).toEqual(['/note']);
  });

  test('maps, sets, bigints and bytes cross both ways', () => {
    const args = { m: new Map([[1, 'a']]), s: new Set(['x']), n: 21n, b: new Uint8Array([1, 2]) };
    expect(js.run('[new Map([...m, [2, "b"]]), new Set([...s, "y"]), n * 2n, b.length]', args)).toEqual([
      new Map([
        [1, 'a'],
        [2, 'b'],
      ]),
      new Set(['x', 'y']),
      42n,
      2,
    ]);
    expect(js.run('u', { u: new URL('https://example.com/a') })).toBe('https://example.com/a');
    expect(js.run('undefined', {})).toBeUndefined();
  });

  test('code that fails is a condition issue, and a form treats it as holding', () => {
    const spec = registry.define({
      fields: { a: { type: 'string', visible: { $js: 'nope.length', args: {} } } },
    });
    expect(validate(spec, { a: '' })).toEqual([{ path: '/a', code: 'condition', message: 'ReferenceError: nope is not defined' }]);
    expect(createForm(spec).field('/a')?.visible).toBe(true);
  });

  test('a run that loops past its limit stops, and the VM goes on', () => {
    const quick = createJs(new WebAssembly.Module(wasm), { timeout: 20 });
    expect(() => quick.run('(() => { for (;;); })()', {})).toThrow('ran past its 20 ms limit');
    expect(() => quick.run('(function f() { return f(); })()', {})).toThrow('RangeError: Maximum call stack size exceeded');
    expect(quick.run('1 + 1', {})).toBe(2);
    quick.dispose();
  });

  test('one expression cannot change what another sees', () => {
    expect(() => js.run('globalThis.leak = 1', {})).toThrow('TypeError');
    expect(() => js.run('Array.prototype.sum = 1', {})).toThrow('TypeError');
    expect(js.run('typeof globalThis.leak + typeof [].sum', {})).toBe('undefinedundefined');
  });
});

describe('checking $js', () => {
  const faults = (spec: Spec, r = registry) => checkSpec(spec, { registry: r }).map((f) => `${f.path}: ${f.message}`);

  test('syntax errors, argument names and pointers in args', () => {
    expect(
      faults({
        fields: {
          a: { type: 'string' },
          b: { type: 'string', visible: { $js: 'a +', args: { a: { $state: 'a' } } } },
          c: { type: 'string', label: { $js: 'x', args: { 'not-a-name': 1, x: { $state: 'nope' } } } },
          d: { type: 'string', default: { $js: 'class', args: { class: 1 } } as never },
        },
      }),
    ).toEqual([
      "/fields/b/visible/$js: SyntaxError: unexpected token in expression: ')'",
      expect.stringMatching(/^\/fields\/c\/label\/args\/x\/\$state: "nope" does not lead to a field/),
      '/fields/c/label/args/not-a-name: names a variable of the code: letters, digits, _ and $',
      '/fields/d/default/$js: SyntaxError: invalid destructuring target',
    ]);
  });

  test('a registry with no engine for $js faults where it is used', () => {
    expect(faults({ fields: { a: { type: 'string', visible: { $js: 'true' } } } }, createRegistry())).toEqual([
      '/fields/a/visible/$js: needs an engine for $js: give the registry one (fieldspec/js runs $js)',
    ]);
    expect(() => createForm(define({ fields: { a: { type: 'string', default: { $js: '"x"' } } } })).values).not.toThrow();
  });

  test('agents hear of $js only from a registry that runs it', () => {
    expect(prompt(registry)).toContain('"$js"');
    expect(prompt()).not.toContain('$js');
    expect(JSON.stringify(metaSchema(registry))).toContain('"$js"');
    expect(JSON.stringify(metaSchema(createRegistry()))).not.toContain('$js');
    expect(JSON.stringify(metaSchema())).toContain('"$js"');
  });
});
