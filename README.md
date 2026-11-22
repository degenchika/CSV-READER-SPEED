# CSV-READER-SPEED

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/degenchika/CSV-READER-SPEED/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/degenchika/CSV-READER-SPEED/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0: `solve.js` exports `run(input)` returning exactly the same `{columns, rows, errors}` for every `{text, header}`, including every error code (`stray_cr`, `quote_junk`, `unterminated_quote`, `short_row`, `long_row`), the line reset on an unterminated quote, BOM dropping, and row padding/cutting to the first record's width. It stays exact by reading the vendor implementation line by line and matching its semantics, not the prose summary. It is faster because it replaces the reference's character-at-a-time loop with one left-to-right pass that finds unquoted fields with `indexOf` (one C++ scan per delimiter kind), materialises fields with a single `slice`, and only does per-character work on the rare paths (doubled quotes or CRs inside a quoted field). The positions of the next LF and CR are cached lazily, so they are re-found only when the scan passes them. On the practice set it answers every case exactly and runs about 2.2× faster than the house baseline whole-program (about 6.8× on the parser alone), and the driver warms the JIT with a short synthetic parse before the real cases so a fresh process starts on optimised code.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=cdzr1hpv&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
