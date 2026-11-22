// The driver program the harness runs: node /bot/main.ts (node22). It reads every
// case from /input/cases.json (a JSON array of {id, input}), answers each one
// alone with run() from solve.js, and writes /output/answers.json: a JSON array
// of the answers, one per case and in the cases' order. Outside a container
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// Revision: the harness runs this program once per set in a fresh process, so
// the parser starts cold — the first case runs interpreted while V8 warms up.
// A short warm-up parse of a small synthetic CSV (exercising quotes, doubled
// quotes, CRs, CRLF and junk) runs run() three times before the real cases,
// so the real cases start on already-optimised code. The warm-up input is
// constant, its results are discarded, and run() keeps no state between
// calls, so every case is still answered alone. The output directory is only
// ever created (mkdir), never removed: the grader mounts /output as a volume.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off and a larger young generation (fewer scavenges
// while the answers are built), set before solve.js is imported so all of its
// work runs under them (the rules: the house baseline runs with
// --no-incremental-marking, and an entry may tune V8's flags too).
setFlagsFromString('--no-incremental-marking --max-semi-space-size=64');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

// Warm the JIT: run the parser over a small synthetic CSV that exercises the
// paths the real cases take, three times, so the real cases start optimised.
{
  let warm = 'id,name,note,amount\r\n';
  for (let i = 0; i < 3000; i++) {
    warm += `${i},"Name ${i}","multi\nline\rnote ""quoted""",${(i * 1.5).toFixed(2)}\r\n`;
    warm += `${i}x,plain,short\r\n`;
  }
  for (let k = 0; k < 3; k++) run({ text: warm, header: true });
}

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
