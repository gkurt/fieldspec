/**
 * Names a spec refers to: kinds, elements, presets and definitions. Built-in names start
 * lowercase (`string`, `slider`, `percent`); names an application or a spec defines start
 * uppercase (`Gradient`, `BrandPicker`, `Entry`), optionally prefixed by a namespace of the
 * same form (`Acme.Money`). So a built-in added later never collides with yours, and a spec's
 * capitalized names are exactly what it needs beyond the library.
 */

export const BUILTIN_NAME = /^[a-z][A-Za-z0-9]*$/;
export const USER_NAME = /^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)*$/;

export const isBuiltinName = (name: string) => BUILTIN_NAME.test(name);
export const isUserName = (name: string) => USER_NAME.test(name);

/** The nearest valid user name: `entry` → `Entry`, `my-thing` → `MyThing`. */
export function toUserName(name: string): string {
  const words = name.split(/[^A-Za-z0-9.]+/).filter(Boolean);
  const joined = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const segments = joined
    .split('.')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  const out = segments.join('.');
  return /^[A-Z]/.test(out) ? out : `X${out}`;
}

/** Throws unless an application-defined name is capitalized. */
export function assertUserName(what: string, name: string) {
  if (!isUserName(name)) {
    throw new Error(
      `${what} "${name}" must start with an uppercase letter (e.g. "${toUserName(name)}"): lowercase names are reserved for built-ins`,
    );
  }
}
