# Regression reports

Public history of every regression run against MyVivarium-2.

## Directory layout

Each run produces a subdirectory named:

```
YYYY-MM-DD-HHMMSS-<sha7>/
```

where the timestamp is UTC and `<sha7>` is the 7-char prefix of the
MyVivarium-2 commit being tested (NOT this repo's commit).

## Contents of each run

- `summary.md` — Human-readable markdown report. The primary artifact:
  diff-able, searchable, readable on GitHub directly. Includes target
  app SHA + commit subject, pass/fail/skip totals, per-module
  breakdown, per-failure details with classification stubs.
- `results.json` — Raw Playwright JSON reporter output. Source of
  truth for the summary; useful for later automated analysis.
- `artifacts/` — Playwright screenshots, video, and traces from failed
  tests. May be gitignored if the directory grows large (see
  `docs/architecture.md`); alternatively kept in git or uploaded as
  GitHub Actions artifacts when CI is wired up.

## Retention

Reports are kept forever. The public history is the quality signal.
A failed run is not a problem to hide — it is the trigger for the
diagnose-classify-fix-rerun cycle. The audit trail is the point.

## How runs are produced

```
./scripts/run-regression.sh   # via the wrapper (planned)
# or directly:
npx tsx scripts/run-regression.ts
```

See `docs/architecture.md` for the full workflow.
