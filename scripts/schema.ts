/**
 * Writes schema/spec.json, the JSON Schema of the spec format the package ships and unpkg
 * serves at SCHEMA_URL. `--check` fails instead when the file is stale.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { metaSchema } from '#src/schema.ts';

const file = join(import.meta.dirname, '..', 'schema', 'spec.json');
const text = `${JSON.stringify(metaSchema(), null, 2)}\n`;
let current: string | null = null;
try {
  current = readFileSync(file, 'utf8');
} catch {}

if (process.argv.includes('--check')) {
  if (current !== text) {
    console.error('schema/spec.json is stale: run `bun run schema`.');
    process.exit(1);
  }
} else if (current !== text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote ${file}`);
}
