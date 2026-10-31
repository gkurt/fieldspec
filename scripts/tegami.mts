// scripts/tegami.mts — Tegami versioning + changelog config.
//
// Run via the `tegami` package script (`bun tegami …`).
//
// Every package shares one version (`groups.all` + `syncBump`), so the primary
// published package's version stands in for the whole release.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tegami } from 'tegami';
import { runCli } from 'tegami/cli';
import { github } from 'tegami/plugins/github';

const root = join(import.meta.dirname, '..');

const paper = tegami({
  groups: { all: { syncBump: true } },
  packages: () => ({ group: 'all' }),

  npm: {
    client: 'bun',
  },

  plugins: [
    github({
      repo: 'gkurt/fieldspec',
      versionPr: {
        base: 'main',
        // Put the release version in the PR title ("chore: release v0.20.0")
        // instead of Tegami's default "Version Packages", mirroring the old
        // Changesets workflow.
        //
        // `create` runs AFTER the draft is applied, so the graph already holds
        // the bumped versions — read the new version straight off it. Do NOT
        // call `bumpVersion` here: the graph is post-apply, so it would bump a
        // second time (0.20.0 -> 0.21.0).
        create() {
          const version = this.graph.get('npm:fieldspec')?.version;
          return { title: version ? `chore: release v${version}` : 'chore: release' };
        },
      },
    }),
    // The version is also written into src/version.ts (the built package imports no JSON) and into
    // the spec format's JSON Schema, which is versioned by it. Both follow the bump in the same commit.
    {
      name: 'fieldspec-version',
      enforce: 'post',
      applyDraft() {
        const version = this.graph.get('npm:fieldspec')?.version;
        if (version === undefined) return;
        const file = join(root, 'src', 'version.ts');
        const text = readFileSync(file, 'utf8');
        writeFileSync(file, text.replace(/export const VERSION: string = '[^']*';/, `export const VERSION: string = '${version}';`));
        const schema = Bun.spawnSync(['bun', 'scripts/schema.ts'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
        if (schema.exitCode !== 0) throw new Error('scripts/schema.ts failed');
      },
    },
  ],
});

await runCli(paper);
