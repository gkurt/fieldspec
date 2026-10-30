/**
 * Calling Clairic (`@cf/cloudflare/clairic`, Cloudflare Workers AI) through the `cf` CLI, which
 * holds the Cloudflare sign-in, so no token is created or stored here.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FieldType = "text" | "number" | "date" | "time" | "datetime" | "duration" | "list" | "estimate" | "forecast";

export interface ClairicField {
  type: FieldType;
  instructions?: string;
  unit?: string;
  integer?: boolean;
  decimals?: number;
  items?: "text" | "number" | "date";
  min?: number | string;
  max?: number | string;
  step?: number | string;
  scale?: "linear" | "log";
  null_threshold?: number;
}

export interface ClairicAnswer {
  type: string;
  value: unknown;
  guess?: unknown;
  p_null?: number;
  confidence?: number;
  span?: [number, number];
  spans?: [number, number][];
  median?: number;
  mean?: number;
  p10?: number;
  p90?: number;
}

export interface ClairicCall {
  answers: Record<string, ClairicAnswer>;
  tokens: number;
  passes: number;
  ms: number;
  fields: number;
}

export async function clairic(state: string, fields: Record<string, ClairicField>): Promise<ClairicCall> {
  const dir = mkdtempSync(join(tmpdir(), "clairic-"));
  const body = join(dir, "body.json");
  writeFileSync(body, JSON.stringify({ model: "clairic", state, fields }));
  const start = performance.now();
  try {
    // `cf` is a Node program; on Windows it is a .cmd shim.
    const cf = process.platform === "win32" ? "cf.cmd" : "cf";
    const proc = Bun.spawn([cf, "ai", "run", "@cf/cloudflare/clairic", "--body", `@${body}`], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(`cf ai run failed (${code}): ${err.slice(0, 600)}`);
    const res = JSON.parse(out) as { answers: Record<string, ClairicAnswer>; usage: { input_tokens: number; passes: number } };
    return { answers: res.answers, tokens: res.usage.input_tokens, passes: res.usage.passes, ms: performance.now() - start, fields: Object.keys(fields).length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
