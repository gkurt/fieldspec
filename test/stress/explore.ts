/**
 * Runs each stress case in its own process with a time limit, so a hang names its case and
 * step and the rest still run. `bun test/stress/explore.ts [name filter]`. Fails on a hang, a
 * stack overflow, an error in a spec the checker accepts, or a checker verdict other than the
 * case expects; slow steps are listed.
 */
import { CASES } from './cases.ts';
import { ensureDom, exercise } from './harness.ts';

const LIMIT = Number(process.env.STRESS_LIMIT ?? 30_000);

if (process.argv[2] === '--one') {
  ensureDom();
  const c = CASES[Number(process.argv[3])]!;
  const report = await exercise(c.spec, c.values ?? {}, { huge: c.huge });
  const verdict = report.valid ? 'valid' : 'invalid';
  console.log(`${verdict}${c.expect && c.expect !== verdict ? ` (expected ${c.expect})` : ''}`);
  let failed = c.expect !== undefined && c.expect !== verdict;
  for (const s of report.steps) {
    const failure = s.error !== undefined && (report.valid || s.error.startsWith('RangeError'));
    failed ||= failure;
    if (failure || s.ms > 1000) console.log(`    ${failure ? 'FAIL' : 'slow'} ${s.step} ${Math.round(s.ms)}ms ${s.error ?? ''}`);
  }
  process.exit(failed ? 1 : 0);
} else {
  const only = process.argv[2];
  let failures = 0;
  for (const [i, c] of CASES.entries()) {
    if (only && !c.name.includes(only)) continue;
    const start = performance.now();
    // The example renderers import fieldspec by name: the condition makes that the source, as here.
    const child = Bun.spawnSync(['bun', '--conditions=fieldspec@dev', import.meta.path, '--one', String(i)], {
      env: { ...process.env, STRESS_TRACE: '1' },
      timeout: LIMIT,
    });
    const ms = Math.round(performance.now() - start);
    const [verdict, ...lines] = child.stdout.toString().trim().split('\n');
    if (child.signalCode != null) {
      const step = child.stderr.toString().trim().split('\n').at(-1)?.trim();
      console.log(`FAIL ${c.name}: ${child.signalCode} after ${ms}ms, in step: ${step}`);
    } else {
      console.log(
        `${child.exitCode === 0 ? 'ok  ' : 'FAIL'} ${c.name}: ${verdict}, ${ms}ms${lines.length > 0 ? `\n${lines.join('\n')}` : ''}`,
      );
    }
    if (child.exitCode !== 0) failures++;
  }
  console.log(failures === 0 ? 'every case ended, without errors' : `${failures} case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}
