import { describe, expect, test } from 'bun:test';
import { checkSpec, createForm, define, layout, parse, walk, type Infer, type LayoutNode } from '#src/index.ts';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>() => {};

const shape = (node: LayoutNode): unknown => {
  const kids = [...node.children, ...(node.inner ? [node.inner] : []), ...(node.fragment ? [node.fragment] : [])];
  const label = node.field !== undefined ? `${node.type}:${node.field}` : node.type;
  return kids.length === 0 ? label : { [label]: kids.map(shape) };
};

const find = (tree: LayoutNode, field: string) => [...walk(tree)].find((n) => n.type === 'field' && n.field === field)!;

describe('presets', () => {
  const spec = define({
    fields: {
      opacity: { use: 'percent', label: 'Opacity', step: 0.01 },
      email: { use: 'email', required: true },
      secret: { use: 'password', optional: true },
      port: { use: 'port', default: 8080 },
      accent: { use: 'color' },
    },
  });

  test("a field takes its base's kind and settings, with its own laid over", () => {
    const form = createForm(spec);
    const opacity = form.field('/opacity')!;
    expect(opacity.decl).toMatchObject({ type: 'number', min: 0, max: 1, step: 0.01, label: 'Opacity' });
    expect(form.values).toMatchObject({ opacity: 0, port: 8080, accent: '#000000' });
    expect(parse(spec, { email: 'x', port: 70000 }).issues.map((i) => `${i.path} ${i.code}`)).toEqual(['/email format', '/port max']);
    assertType<Equal<Infer<typeof spec>, { opacity: number; email: string; port: number; accent: string; secret?: string }>>();
  });

  test("a preset's render comes along: percent is a slider showing a percentage", () => {
    const tree = layout(spec);
    expect(find(tree, 'opacity').control).toEqual({ type: 'slider', props: { format: 'percent' }, explicit: true });
    expect(find(tree, 'secret').control).toEqual({ type: 'input', props: { secret: true }, explicit: true });
    expect(find(tree, 'port').control).toEqual({ type: 'input', props: {} });
  });

  test('checks name what is wrong with a use', () => {
    const messages = checkSpec({
      fields: {
        a: { use: 'percnt' },
        b: { use: 'percent', type: 'int' },
        c: { use: 'percent', stepp: 2 },
      },
    }).map((f) => `${f.path}: ${f.message}`);
    expect(messages).toContainEqual(expect.stringContaining('/fields/a/use: "percnt" is not a built-in preset. Did you mean "percent"?'));
    expect(messages).toContain('/fields/b/type: a field with `use` takes its kind from the base; leave `type` out');
    expect(messages).toContainEqual(expect.stringContaining('/fields/c/stepp: is not a property of a number field. Did you mean "step"?'));
  });
});

describe('render', () => {
  test('on a field: a control element picks the control', () => {
    const tree = layout(define({ fields: { plan: { type: 'enum', options: ['a', 'b'], render: 'segmented' }, on: { type: 'boolean' } } }));
    expect(find(tree, 'plan').control?.type).toBe('segmented');
    expect(find(tree, 'on').control?.type).toBe('checkbox');
  });

  test('on a field: a layout arranges its parts, which name no field', () => {
    const tree = layout(
      define({ fields: { size: { type: 'int', render: { type: 'row', children: ['label', { type: 'slider' }, 'errors'] } } } }),
    );
    expect(shape(find(tree, 'size'))).toEqual({ 'field:size': [{ row: ['label:size', 'slider:size', 'errors:size'] }] });
    const filled = layout(define({ fields: { size: { type: 'int', render: 'row' } } }));
    expect(shape(find(filled, 'size'))).toEqual({ 'field:size': [{ row: ['label:size', 'control:size', 'help:size', 'errors:size'] }] });
  });

  test("on a group: the container, titled by the group's label", () => {
    const tree = layout(
      define({
        fields: { a: { type: 'string', group: 'look' }, b: { type: 'string', group: 'look' } },
        groups: { look: { label: 'Look', render: { type: 'collapsible', props: { collapsed: true } } } },
      }),
    );
    const look = tree.children[0]!;
    expect(look.type).toBe('collapsible');
    expect(look.props).toEqual({ collapsed: true, title: 'Look' });
    expect(look.children.map((n) => n.field)).toEqual(['a', 'b']);
    const plain = layout(define({ fields: { a: { type: 'string', group: 'g' } }, groups: { g: { label: 'G' } } }));
    expect(plain.children[0]).toMatchObject({ type: 'stack', props: { title: 'G' } });
  });

  test('scroll: a box no taller than maxHeight, scrolling past it', () => {
    const spec = define({
      fields: { a: { type: 'string', group: 'log' }, b: { type: 'string', group: 'log' } },
      groups: { log: { label: 'Log', render: { type: 'scroll', props: { maxHeight: '16rem' } } } },
    });
    expect(layout(spec).children[0]).toMatchObject({ type: 'scroll', props: { maxHeight: '16rem', title: 'Log' } });
    expect(checkSpec(spec)).toEqual([]);
    expect(checkSpec({ fields: {}, layouts: { v: { type: 'scroll', props: { maxHeight: 240 } } } })).toEqual([]);
    const tall = checkSpec({ fields: {}, layouts: { v: { type: 'scroll', props: { maxHeight: 'tall' } } } });
    expect(tall.map((f) => `${f.path}: ${f.message}`)).toEqual([
      String.raw`/layouts/v/props/maxHeight: must be a number or match ^\d+(\.\d+)?(px|rem|em|vh|%)$`,
    ]);
  });

  test('a group placed inside itself is refused, and its fields still drawn', () => {
    const own = { fields: { a: { type: 'string', group: 'g' } }, groups: { g: { render: { type: 'stack', children: [{ group: 'g' }] } } } };
    expect(checkSpec(own).map((f) => `${f.path}: ${f.message}`)).toEqual([
      '/groups/g/render/children/0/group: "g" is not a subgroup of this group',
    ]);
    const tree = layout(own);
    expect([...walk(tree)].filter((n) => n.type === 'text').map((n) => n.props.text)).toEqual(['Group "g" is placed inside itself']);
    expect([...walk(tree)].filter((n) => n.type === 'field').map((n) => n.field)).toEqual(['a']);
    // Groups nested in a cycle, one of whose renders places another: drawn once round, then refused.
    const ring = {
      fields: { a: { type: 'string', group: 'g0' }, b: { type: 'string', group: 'g1' } },
      groups: { g0: { group: 'g2' }, g1: { group: 'g0' }, g2: { group: 'g1', render: { type: 'stack', children: [{ group: 'g0' }] } } },
    };
    expect(checkSpec(ring).filter((f) => f.message === 'groups nest in a cycle')).toHaveLength(3);
    expect(
      [...walk(layout(ring))].some(
        (n) => n.type === 'text' && typeof n.props.text === 'string' && n.props.text.endsWith('is placed inside itself'),
      ),
    ).toBe(true);
  });

  test('groups nested hundreds deep are laid out quickly', () => {
    const n = 400;
    const groups = Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`g${i}`, { label: `G${i}`, ...(i > 0 && { group: `g${i - 1}` }) }]),
    );
    const fields = Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, { type: 'string', group: `g${i}` }]));
    const start = performance.now();
    const nodes = [...walk(layout({ fields, groups }))];
    expect(performance.now() - start).toBeLessThan(2000);
    expect(nodes.filter((node) => node.type === 'field')).toHaveLength(n);
  });

  test('on an object: a layout arranges its fields', () => {
    const tree = layout(
      define({
        fields: {
          size: { type: 'object', fields: { w: { type: 'int' }, h: { type: 'int' } }, render: { type: 'columns', props: { count: 2 } } },
        },
      }),
    );
    expect(shape(find(tree, 'size').inner!)).toEqual({ columns: ['field:w', 'field:h'] });
  });

  test('order moves a field among its siblings; equal ones keep declaration order', () => {
    const spec = define({
      fields: {
        '2': { type: 'string' },
        notes: { type: 'string', order: 1 },
        name: { type: 'string', order: -1 },
        city: { type: 'string', group: 'where' },
        zip: { type: 'string', group: 'where', order: -2 },
        tags: { type: 'object', fields: { b: { type: 'string' }, a: { type: 'string', order: -1 } } },
      },
      groups: { where: { label: 'Where' } },
    });
    // The group draws where its first field (zip, now first) does, holding its fields in order.
    const tree = layout(spec);
    expect(tree.children.map((n) => n.field ?? `group:${n.group}`)).toEqual(['group:where', 'name', '2', 'tags', 'notes']);
    expect([...walk(tree.children[0]!)].filter((n) => n.type === 'field').map((n) => n.field)).toEqual(['zip', 'city']);
    expect(shape(find(tree, 'tags').inner!)).toEqual({ stack: ['field:a', 'field:b'] });
    // A fragment's rest follows the order too; the values keep their own.
    const view = layout(define({ ...spec, layouts: { v: { type: 'stack', children: [{ field: 'notes' }] } } }), 'v');
    expect([...walk(view)].filter((n) => n.type === 'field' && n.field! in spec.fields).map((n) => n.field)).toEqual([
      'notes',
      'zip',
      'city',
      'name',
      '2',
      'tags',
    ]);
    expect(Object.keys(createForm(spec).values)).toEqual(['2', 'notes', 'name', 'city', 'zip', 'tags']);
    expect(checkSpec({ fields: { a: { type: 'string', order: 'first' } } }).map((f) => `${f.path}: ${f.message}`)).toEqual([
      '/fields/a/order: must be a number; lower draws first',
    ]);
  });

  test("the checker knows each element's props and which kinds a control edits", () => {
    const messages = checkSpec({
      fields: {
        a: { type: 'string', group: 'g', render: 'slider' },
        b: { type: 'number', render: { type: 'slider', props: { format: 'percentage', colour: 1 } } },
        c: { type: 'string', render: { type: 'row', children: [{ type: 'label', props: { field: 'a' } }] } },
      },
      groups: {
        g: { label: 'G', render: { type: 'collapsible', props: { collapsed: 'yes' } } },
        h: { render: 'slider' },
      },
    }).map((f) => `${f.path}: ${f.message}`);
    expect(messages).toContain('/fields/a/render: slider edits number, int fields; this is a string field');
    expect(messages).toContain('/fields/b/render/props/format: must be one of "number", "percent"');
    expect(messages).toContainEqual(expect.stringContaining('/fields/b/render/props/colour: is not a prop of slider.'));
    expect(messages).toContain("/fields/c/render/children/0/props: a field's own render draws only its own parts; leave `field` out");
    expect(messages).toContain('/groups/g/render/props/collapsed: must be a boolean');
    expect(messages).toContainEqual(expect.stringContaining("/groups/h/render: a group's render is a container its fields go in"));
  });

  test('unknown names point at the naming rule', () => {
    const messages = checkSpec({ fields: { a: { type: 'string', render: 'Slider' }, b: { type: 'string', render: 'sliderr' } } }).map(
      (f) => `${f.path}: ${f.message}`,
    );
    expect(messages).toContain('/fields/a/render/type: "Slider" is not an element this registry adds. Did you mean "slider"?');
    expect(messages).toContainEqual(
      expect.stringContaining('/fields/b/render/type: "sliderr" is not a built-in element. Did you mean "slider"?'),
    );
  });
});
