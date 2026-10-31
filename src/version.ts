/**
 * The package version, which the spec format's JSON Schema is versioned by. Written out rather
 * than read from package.json, so the built package imports no JSON; a test keeps the two equal.
 */
export const VERSION: string = '0.1.0';

/**
 * The version of the spec format this library reads, which a spec may state in `fieldspec`.
 * Unlike {@link VERSION}, it changes only when the grammar does, so that a spec written for an
 * earlier format would no longer mean the same thing. Edited by hand.
 */
export const FORMAT_VERSION = 1;

/**
 * Where the JSON Schema of this version of the spec format is published: the file the
 * package ships, served by unpkg. Put it in a spec's `$schema` and editors validate and
 * complete it.
 */
export const SCHEMA_URL = `https://unpkg.com/fieldspec@${VERSION}/schema/spec.json`;

/** Every version's schema URL has this shape; the checker reads the version back out of it. */
export const SCHEMA_URL_PATTERN = /^https:\/\/unpkg\.com\/fieldspec@([^/]+)\/schema\/spec\.json$/;
