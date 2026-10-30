/**
 * Specs written to break things, and random ones, through every entry point (see
 * test/stress/harness.ts): nothing may hang or overflow the stack, a spec the checker accepts
 * must go through every step without error, and the checker must reject the specs that are
 * wrong on purpose. A synchronous hang cannot be timed out in-process; `bun run stress` runs
 * these cases and a thousand random specs in child processes with a time limit, naming the case
 * and step that hung.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { CASES } from "./stress/cases.ts";
import { randomSpec } from "./stress/generate.ts";
import { exercise, type Report } from "./stress/harness.ts";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

/** The steps that went wrong: any error in an accepted spec, and a stack overflow in any. */
const failures = (report: Report) =>
  report.steps.filter((s) => s.error && (report.valid || s.error.startsWith("RangeError"))).map((s) => `${s.step}: ${s.error}`);

describe("specs written to break things", () => {
  for (const c of CASES) {
    test(
      c.name,
      async () => {
        const report = await exercise(c.spec, c.values ?? {}, { huge: c.huge });
        if (c.expect) expect(report.valid ? "valid" : "invalid").toBe(c.expect);
        expect(failures(report)).toEqual([]);
      },
      30_000,
    );
  }
});

describe("random specs", () => {
  const SEEDS = Number(process.env.STRESS_SEEDS ?? 40);
  for (let seed = 0; seed < SEEDS; seed++) {
    test(
      `seed ${seed}`,
      async () => {
        const { spec, values } = randomSpec(seed);
        expect(failures(await exercise(spec, values, { seed }))).toEqual([]);
      },
      30_000,
    );
  }
});
