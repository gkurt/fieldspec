/**
 * The serialized format. Everything here is plain JSON: a spec can be stored, sent over the
 * wire, written by an agent, and diffed. Behaviour that cannot be JSON (callbacks) is referred
 * to by name through `$computed` and supplied at runtime as a function table.
 */

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

// ── Expressions ────────────────────────────────────────────────────────────────────────────

/**
 * Reads a value. `"/a/b"` is a JSON Pointer from the root of the values. Without the leading
 * slash it is relative to the object the field sits in: `"b"` is a sibling, `"b/c"` reaches
 * into one, and each leading `"../"` climbs one segment of the pointer (an array index is a
 * segment), so `"../name"` is a property of the parent object. Relative pointers keep a
 * definition reusable wherever it is placed.
 */
export interface StateRef {
  readonly $state: string;
}

/** Inside an array item: a pointer relative to the item (`""` is the item itself). */
export interface ItemRef {
  readonly $item: string;
}

/** Inside an array item: the item's index. */
export interface IndexRef {
  readonly $index: true;
}

/** Calls a function from the runtime function table by name. */
export interface ComputedRef {
  readonly $computed: string;
  readonly args?: { readonly [name: string]: Expr };
}

/**
 * A CEL (Common Expression Language) expression, run by the registry's engine (`fieldspec/cel`).
 * It reads only its `args`, each a variable: `{ "$cel": "end >= start", "args": { "start": { "$state": "start" }, … } }`.
 */
export interface CelExpr {
  readonly $cel: string;
  readonly args?: { readonly [name: string]: Expr };
}

/**
 * A JavaScript expression, run sandboxed by the registry's engine (`fieldspec/js`). It reads only
 * its `args`, each a variable: `{ "$js": "end >= start", "args": { "start": { "$state": "start" }, … } }`.
 */
export interface JsExpr {
  readonly $js: string;
  readonly args?: { readonly [name: string]: Expr };
}

export interface CondExpr {
  readonly $cond: Condition;
  readonly $then: Expr;
  readonly $else: Expr;
}

/** String interpolation: `"Hello ${/user/name}"`. Pointers follow {@link StateRef}'s rules. */
export interface TemplateExpr {
  readonly $template: string;
}

export type Expr = Json | StateRef | ItemRef | IndexRef | ComputedRef | CelExpr | JsExpr | CondExpr | TemplateExpr;

/** Text shown to people: a literal or an expression that yields one. */
export type Text = string | TemplateExpr | CondExpr | ComputedRef | CelExpr | JsExpr | StateRef;

// ── Conditions (json-render's grammar, plus `in`) ─────────────────────────────────────────

export type ComparisonOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';

export interface Comparison {
  readonly eq?: Expr;
  readonly neq?: Expr;
  readonly gt?: Expr;
  readonly gte?: Expr;
  readonly lt?: Expr;
  readonly lte?: Expr;
  readonly in?: Expr;
  /** Inverts the leaf. */
  readonly not?: true;
}

/** A value source, optionally compared. Without an operator, it is tested for truthiness. */
export type ConditionLeaf = (StateRef | ItemRef | IndexRef | ComputedRef | CelExpr | JsExpr) & Comparison;

/** `true`/`false`, a leaf, an array (all must hold), `$and`, or `$or`. */
export type Condition =
  | boolean
  | ConditionLeaf
  | readonly Condition[]
  | { readonly $and: readonly Condition[] }
  | { readonly $or: readonly Condition[] };

// ── Rendering ─────────────────────────────────────────────────────────────────────────────

/** An element of the catalog, by name: `"row"`, `"slider"`, `"BrandPicker"`. Short for `{ "type": name }`. */
export type ElementName = string;

/** An element of the catalog with its props: `{ "type": "collapsible", "props": { "collapsed": true } }`. */
export interface RenderElement {
  readonly type: string;
  readonly props?: { readonly [name: string]: Expr };
  readonly children?: readonly RenderNode[];
  readonly visible?: Condition;
}

/** `{ "field": "firstName" }` is short for `{ "type": "field", "props": { "field": "firstName" } }`. */
export interface FieldShorthand {
  readonly field: string;
}

/** `{ "group": "name" }` places a whole group, rendered as it would be on its own. */
export interface GroupShorthand {
  readonly group: string;
}

/**
 * What `render` takes, wherever it sits. On a field, a control element picks its control and a
 * layout element arranges its parts (or, on an object, its fields); on a group, a layout element
 * is its container; in `layouts`, it arranges the whole form. A container without `children`
 * is filled with what is in scope.
 */
export type RenderNode = ElementName | RenderElement | FieldShorthand | GroupShorthand;

// ── Fields ────────────────────────────────────────────────────────────────────────────────

/** What every field may say, whatever its kind. */
export interface FieldBase {
  readonly type: string;
  /** Builds on a preset or definition; see {@link UseField}. Not together with `type`. */
  readonly use?: string;
  readonly label?: Text;
  readonly description?: Text;
  /** A short line under the control. */
  readonly hint?: Text;
  readonly placeholder?: Text;
  readonly examples?: readonly Json[];
  /** Other keys this field is read from, for renamed settings and forgiving input. */
  readonly aliases?: readonly string[];
  /** `true`, or the replacement to point people to. */
  readonly deprecated?: boolean | string;
  /** Used when the value is absent. May be an expression over other values. */
  readonly default?: Expr;
  /**
   * What the value always is: usually an expression over other values, computed again as they
   * change. The field cannot be edited, and a value given for it is replaced. Where `default`
   * fills an absent value, `value` decides every value.
   */
  readonly value?: Expr;
  /** The value may be absent. Otherwise an absent value takes the default or the kind's zero. */
  readonly optional?: boolean;
  readonly readOnly?: boolean;
  /** Not shown, and not validated, while false. */
  readonly visible?: Condition;
  readonly enabled?: Condition;
  /** Must be non-empty (not absent, null, "", or an empty collection) while true and visible. */
  readonly required?: Condition;
  /**
   * Rules the value must keep beyond its kind's own, often over other fields: each `assert`
   * holds while the value is valid. They run on a value that is present and otherwise valid.
   */
  readonly checks?: readonly Check[];
  /** The id of a group in the same scope. */
  readonly group?: string;
  /**
   * Where the field draws among its siblings: lower first. Fields without one count as 0, and
   * equal ones keep the order they are declared in. It moves the field, not its value.
   */
  readonly order?: number;
  /** How this field draws: a control element, or a layout of its parts (or, for an object, of its fields). */
  readonly render?: RenderNode;
  /** Anything else, for the application. Never interpreted. */
  readonly meta?: { readonly [key: string]: Json };
}

export interface StringField extends FieldBase {
  readonly type: 'string';
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  /** Shown when the value does not match `pattern`, in place of "This isn't a valid slug". */
  readonly patternMessage?: string;
  readonly format?: 'email' | 'uri' | 'uuid' | 'hostname' | 'ipv4' | 'color' | (string & {});
  /** Values to offer as it is typed, any other still allowed: a list of strings, or an expression giving one. */
  readonly suggestions?: Expr;
}

export interface NumberField extends FieldBase {
  readonly type: 'number' | 'int';
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
}

export interface BooleanField extends FieldBase {
  readonly type: 'boolean';
}

export type OptionValue = string | number | boolean;

export interface EnumOption {
  readonly value: OptionValue;
  readonly label?: Text;
  readonly description?: Text;
  readonly visible?: Condition;
}

export interface EnumField extends FieldBase {
  readonly type: 'enum';
  /** Values, `{ value, label }` objects, or an expression that yields either. */
  readonly options: readonly (OptionValue | EnumOption)[] | ComputedRef | StateRef;
}

export interface DateField extends FieldBase {
  readonly type: 'date';
  /** ISO 8601. */
  readonly min?: string;
  readonly max?: string;
  /** Whether the time of day matters. */
  readonly time?: boolean;
}

export interface BigIntField extends FieldBase {
  readonly type: 'bigint';
  /** Decimal strings, since JSON numbers cannot hold every bigint. */
  readonly min?: string;
  readonly max?: string;
}

export interface UrlField extends FieldBase {
  readonly type: 'url';
  /** Allowed protocols with the colon, e.g. `["https:"]`. */
  readonly protocols?: readonly string[];
}

export interface RegExpField extends FieldBase {
  readonly type: 'regexp';
}

export interface BytesField extends FieldBase {
  readonly type: 'bytes';
  readonly maxBytes?: number;
  /** MIME types a renderer may filter a picker by. */
  readonly accept?: readonly string[];
}

export interface JsonField extends FieldBase {
  readonly type: 'json';
}

export interface ArrayField<F = FieldDecl> extends FieldBase {
  readonly type: 'array';
  readonly items: F;
  readonly minItems?: number;
  readonly maxItems?: number;
  /**
   * What names each item where its position (or key) would: a pointer into the item (`"name"`,
   * or `""` for the item itself), or a text expression evaluated in the item's scope. Shown as
   * the item's label.
   */
  readonly namedBy?: Text;
}

export interface SetField<F = FieldDecl> extends FieldBase {
  readonly type: 'set';
  readonly items: F;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface RecordField<F = FieldDecl> extends FieldBase {
  readonly type: 'record';
  readonly values: F;
  /** A regular expression every key must match. */
  readonly keyPattern?: string;
  /**
   * What names each item where its position (or key) would: a pointer into the item (`"name"`,
   * or `""` for the item itself), or a text expression evaluated in the item's scope. Shown as
   * the item's label.
   */
  readonly namedBy?: Text;
}

export interface MapField<F = FieldDecl> extends FieldBase {
  readonly type: 'map';
  readonly keys: F;
  readonly values: F;
  /**
   * What names each item where its position (or key) would: a pointer into the item (`"name"`,
   * or `""` for the item itself), or a text expression evaluated in the item's scope. Shown as
   * the item's label.
   */
  readonly namedBy?: Text;
}

export interface ObjectField<F = FieldDecl> extends FieldBase {
  readonly type: 'object';
  readonly fields: { readonly [key: string]: F };
  readonly groups?: { readonly [id: string]: GroupDecl };
  /** What to do with keys no field claims: report them (default), drop them, or keep them. */
  readonly unknown?: 'error' | 'strip' | 'keep';
}

export interface Variant<F = FieldDecl> {
  readonly label?: Text;
  readonly description?: Text;
  readonly fields: { readonly [key: string]: F };
  readonly groups?: { readonly [id: string]: GroupDecl };
}

/** A discriminated union: the `key` field says which variant's fields apply. */
export interface VariantField<F = FieldDecl> extends FieldBase {
  readonly type: 'variant';
  readonly key: string;
  readonly variants: { readonly [name: string]: Variant<F> };
}

/**
 * A field built on a named declaration: a built-in preset (`percent`), a preset the registry adds
 * (`Money`), or a definition in the spec's `defs` (`Address`). Its own properties override the
 * base's; it takes its kind from the base, so it has no `type`. A definition may use itself,
 * through an array, set, record, map or optional field.
 */
export interface UseField extends Omit<FieldBase, 'type'> {
  readonly use: string;
  readonly type?: undefined;
  readonly [prop: string]: unknown;
}

export type CoreField =
  | StringField
  | NumberField
  | BooleanField
  | EnumField
  | DateField
  | BigIntField
  | UrlField
  | RegExpField
  | BytesField
  | JsonField
  | ArrayField
  | SetField
  | RecordField
  | MapField
  | ObjectField
  | VariantField;

/** Any field: a core one, one of an extension kind (whose own properties are its business), or one built on a named declaration. */
export type FieldDecl = CoreField | UseField | (FieldBase & { readonly [prop: string]: unknown });

/** A field with its `use` followed: what every walker works with. */
export type Resolved = Exclude<FieldDecl, UseField>;

/**
 * A rule a field's value must keep: `{ "assert": { "$cel": "end >= start", "args": { … } }, "message": "Ends before it starts" }`.
 * The condition is evaluated where the field's `visible` is; while it fails, the field has an
 * issue saying `message`.
 */
export interface Check {
  readonly assert: Condition;
  readonly message: Text;
  /** The issue's code, for applications that tell checks apart. Default `"check"`. */
  readonly code?: string;
}

export interface GroupDecl {
  readonly label?: Text;
  readonly description?: Text;
  /** The group's container, e.g. `"row"` or `{ "type": "collapsible", "props": { "collapsed": true } }`. Its label fills the container's `title`. */
  readonly render?: RenderNode;
  readonly visible?: Condition;
  /** A parent group in the same scope. */
  readonly group?: string;
}

/** A declared function, so agents and checkers know what `$computed` may call. */
export interface FunctionDecl {
  readonly description?: string;
  readonly args?: { readonly [name: string]: string };
  readonly returns?: string;
}

export interface Spec {
  readonly $schema?: string;
  readonly title?: Text;
  readonly description?: Text;
  readonly fields: { readonly [key: string]: FieldDecl };
  readonly groups?: { readonly [id: string]: GroupDecl };
  /** Named declarations fields build on with `use`, recursively if need be. Names are capitalized. */
  readonly defs?: { readonly [name: string]: FieldDecl };
  /** Named alternative arrangements of the whole form. */
  readonly layouts?: { readonly [name: string]: RenderNode };
  readonly functions?: { readonly [name: string]: FunctionDecl };
  /** Translations the spec carries, by locale (`"de"`, `"pt-BR"`); see {@link Translations}. */
  readonly locales?: { readonly [locale: string]: Translations };
  /** Which version of its values the spec describes: a whole number from 1. Values `encode` writes carry it as `$version`. */
  readonly version?: number;
  /**
   * How values written for an earlier version are brought forward, by the version each list of
   * operations reaches: `{ "2": [ … ], "3": [ … ] }`. See {@link MigrationOp}.
   */
  readonly migrations?: { readonly [version: string]: readonly MigrationOp[] };
}

/**
 * One step of a migration: a JSON Patch operation over values as stored (JSON). In `path` and
 * `from`, `*` stands for every item or key at its level, and a target's `*`s take what its
 * source's stood for, in order. `value` may be an expression, evaluated where the target sits
 * (`{ "$state": "timeout" }` is a sibling). What an operation does not find, it leaves be.
 */
export type MigrationOp =
  | { readonly op: 'add'; readonly path: string; readonly value: Expr }
  | { readonly op: 'replace'; readonly path: string; readonly value: Expr }
  | { readonly op: 'remove'; readonly path: string }
  | { readonly op: 'move'; readonly from: string; readonly path: string }
  | { readonly op: 'copy'; readonly from: string; readonly path: string };

/**
 * A translation: JSON Pointers into the spec, each to a text it shows (`/fields/name/label`) or a
 * string inside one (`/fields/domain/label/$else/$template`), mapped to the text in its place.
 * A text the spec only implies, like a label made from the key, may be given too.
 */
export type Translations = { readonly [pointer: string]: Text };

// ── Results ───────────────────────────────────────────────────────────────────────────────

/** A problem with a value, at a JSON Pointer into the values. */
export interface Issue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  /**
   * What the library's own messages are about (`{ min: 3 }` for "must be at least 3"), so they
   * can be said in another language. Absent where the spec wrote the message (a check's,
   * `patternMessage`), which translates with the spec.
   */
  readonly params?: { readonly [name: string]: Param };
}

/** What an issue's message is about: a bound, a pattern, the options allowed. */
export type Param = string | number | boolean | readonly (string | number | boolean)[];

/** A problem with a spec, at a JSON Pointer into the spec. Phrased as the fix. */
export interface Fault {
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly [] }
  | { readonly ok: false; readonly value: T | undefined; readonly issues: readonly Issue[] };
