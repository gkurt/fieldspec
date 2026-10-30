import pkg from "../package.json" with { type: "json" };

/** The package version, which the spec format's JSON Schema is versioned by. */
export const VERSION: string = pkg.version;

/**
 * Where the JSON Schema of this version of the spec format is published: the file the
 * package ships, served by unpkg. Put it in a spec's `$schema` and editors validate and
 * complete it.
 */
export const SCHEMA_URL = `https://unpkg.com/fieldspec@${VERSION}/schema/spec.json`;

/** Every version's schema URL has this shape; the checker reads the version back out of it. */
export const SCHEMA_URL_PATTERN = /^https:\/\/unpkg\.com\/fieldspec@([^/]+)\/schema\/spec\.json$/;
