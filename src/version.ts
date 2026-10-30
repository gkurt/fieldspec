/**
 * The package version, which the spec format's JSON Schema is versioned by. Written out rather
 * than read from package.json, so the built package imports no JSON; a test keeps the two equal.
 */
export const VERSION: string = "0.1.0";

/**
 * Where the JSON Schema of this version of the spec format is published: the file the
 * package ships, served by unpkg. Put it in a spec's `$schema` and editors validate and
 * complete it.
 */
export const SCHEMA_URL = `https://unpkg.com/fieldspec@${VERSION}/schema/spec.json`;

/** Every version's schema URL has this shape; the checker reads the version back out of it. */
export const SCHEMA_URL_PATTERN = /^https:\/\/unpkg\.com\/fieldspec@([^/]+)\/schema\/spec\.json$/;
