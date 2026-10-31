import { randomSpec } from './generate.ts';
/**
 * Random specs in batches, each batch in its own process with a time limit; after a hang or a
 * crash the next batch starts past the seed it happened on. `bun test/stress/fuzz.ts [from] [to]`.
 * Fails on any error or slow step in a spec the checker accepts, and any hang, crash or stack
 * overflow in any spec. A spec the checker rejects may fail its steps, and may be slow where it
 * asks for huge values, but must end.
 */
import { ensureDom, exercise } from './harness.ts';

const LIMIT = Number(process.env.STRESS_LIMIT ?? 30_000);
const BATCH = 25;

if (process.argv[2] === '--child') {
  ensureDom();
  const [from, to] = [Number(process.argv[3]), Number(process.argv[4])];
  for (let seed = from; seed < to; seed++) {
    process.stderr.write(`seed ${seed}\n`);
    const { spec, values } = randomSpec(seed);
    const report = await exercise(spec, values, { seed });
    for (const s of report.steps) {
      const failure = (s.error !== undefined && (report.valid || s.error.startsWith('RangeError'))) || (report.valid && s.ms > 1000);
      if (failure)
        console.log(`FAIL seed ${seed} (${report.valid ? 'valid' : 'invalid'}): ${s.step} ${Math.round(s.ms)}ms ${s.error ?? ''}`);
    }
  }
} else {
  const [from, to] = [Number(process.argv[2] ?? 0), Number(process.argv[3] ?? 200)];
  let failures = 0;
  let seed = from;
  while (seed < to) {
    const end = Math.min(seed + BATCH, to);
    const child = Bun.spawnSync(['bun', import.meta.path, '--child', String(seed), String(end)], {
      env: { ...process.env, STRESS_TRACE: '1' },
      timeout: LIMIT,
    });
    const out = child.stdout.toString();
    process.stdout.write(out);
    failures += out.split('\n').filter((l) => l.startsWith('FAIL')).length;
    if (child.exitCode === 0) {
      seed = end;
      continue;
    }
    const trace = child.stderr.toString().trim().split('\n');
    const at = Number(
      [...trace]
        .reverse()
        .find((l) => l.startsWith('seed '))
        ?.slice(5) ?? seed,
    );
    console.log(`FAIL seed ${at}: ${child.signalCode ?? `exit ${child.exitCode}`} in step: ${trace.at(-1)?.trim()}`);
    if (child.exitCode !== null) console.log(trace.slice(-6).join('\n'));
    failures++;
    seed = at + 1;
  }
  console.log(failures === 0 ? `seeds ${from} to ${to - 1}: every spec ended, without errors` : `${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
