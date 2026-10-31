/**
 * An extension registry for design tools: a `Gradient` kind with a structured value and its own
 * `GradientPicker` control, a `Swatch` preset, and a lint rule for compact settings panels.
 * Everything here is capitalized: lowercase names belong to the library.
 */
import { createRegistry, defineElement, defineKind, type Rule } from '#src/index.ts';

export interface GradientValue {
  from: string;
  to: string;
  stops?: { color: string; at: number }[];
  angle: number;
  shape: 'linear' | 'radial' | 'conic';
}

const isColor = (v: unknown) => typeof v === 'string' && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);

export const Gradient = defineKind<GradientValue>()({
  name: 'Gradient',
  description: 'A ramp of colours: two ends, optional stops between, an angle and a shape.',
  control: 'GradientPicker',
  example: { type: 'Gradient', label: 'Backdrop', default: { from: '#000000', to: '#ffffff', angle: 90, shape: 'linear' } },
  zero: () => ({ from: '#000000', to: '#ffffff', stops: [], angle: 0, shape: 'linear' }),
  check(value, _, ctx) {
    const g = value as Partial<GradientValue> | null;
    if (!g || typeof g !== 'object') return ctx.issue('type', 'must be a gradient');
    if (!isColor(g.from) || !isColor(g.to)) ctx.issue('color', 'needs colours at both ends');
    if (typeof g.angle !== 'number') ctx.issue('angle', 'needs an angle in degrees');
    if (!['linear', 'radial', 'conic'].includes(String(g.shape))) ctx.issue('shape', 'must be linear, radial or conic');
    for (const stop of g.stops ?? []) if (!(stop.at >= 0 && stop.at <= 1)) ctx.issue('stop', 'stops sit between 0 and 1');
  },
  jsonSchema: () => ({
    type: 'object',
    properties: {
      from: { type: 'string' },
      to: { type: 'string' },
      angle: { type: 'number' },
      shape: { enum: ['linear', 'radial', 'conic'] },
      stops: { type: 'array', items: { type: 'object', properties: { color: { type: 'string' }, at: { type: 'number' } } } },
    },
    required: ['from', 'to', 'angle', 'shape'],
  }),
});

export const GradientPicker = defineElement({
  name: 'GradientPicker',
  role: 'control',
  description: 'Two colour ends and an angle, with a preview.',
  props: {
    field: { schema: { type: 'string' }, description: 'A field in scope.' },
    angle: { schema: { type: 'boolean' }, description: 'Whether the angle can be changed. Default true.' },
  },
  kinds: ['Gradient'],
});

/** A colour from the brand palette, as a preset: the built-in `color` preset, constrained. */
export const presets = {
  Swatch: {
    use: 'color',
    default: '#3b82f6',
    render: { type: 'color', props: { swatches: ['#3b82f6', '#9333ea', '#16a34a', '#f97316'] } },
  },
} as const;

/** A compact panel draws every field at once, so it keeps them few and their keys tidy. */
export function compactPanel(maxFields = 24): Rule {
  return (spec, report) => {
    if (Object.keys(spec.fields).length > maxFields)
      report('/fields', `at most ${maxFields} fields, since a panel has to draw all of them`);
    for (const [key, decl] of Object.entries(spec.fields)) {
      const at = `/fields/${key}`;
      if (!/^[a-z][A-Za-z0-9]{0,31}$/.test(key)) report(at, 'must start with a lowercase letter and hold only letters and digits');
      if (typeof decl.label === 'string' && decl.label.length > 40)
        report(`${at}/label`, 'at most 40 characters, since it sits in a panel');
    }
  };
}

export const design = createRegistry({ kinds: [Gradient], elements: [GradientPicker], presets, rules: [compactPanel()] });
