/**
 * Builds what the package ships: dist/, JavaScript and declarations compiled from src/.
 * The source imports with .ts extensions, which tsc rewrites to .js in JavaScript but leaves
 * in declarations; those are rewritten here, so every consumer's TypeScript resolves them.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
const tsc = Bun.spawnSync([join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.exe" : "tsc"), "-p", "tsconfig.build.json"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1);

const RELATIVE = /((?:from|import)\s*\(?\s*["'])(\.{1,2}\/[^"']*?)\.tsx?(["'])/g;
let files = 0;
for (const entry of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
  if (!entry.endsWith(".d.ts")) continue;
  const file = join(dist, entry);
  const text = readFileSync(file, "utf8");
  const out = text.replace(RELATIVE, "$1$2.js$3");
  if (out !== text) writeFileSync(file, out);
  files++;
}
console.log(`built dist/: ${files} declaration files`);
