# MyVivarium-2-tests architecture

Reference material for the intended shape of this repository. Read this
before making structural changes — new scripts, repo layout shifts, new
top-level directories. Decisions are logged in `docs/decisions.md`.

## Table of contents

1. [Overview](#overview)
2. [Repo layout](#repo-layout)
3. [Sync workflow — `scripts/sync-app.sh`](#sync-workflow--scriptssync-appsh)
4. [Regression run workflow — `scripts/run-regression.sh`](#regression-run-workflow--scriptsrun-regressionsh)
5. [Regression report shape](#regression-report-shape)
6. [Synthetic data generator](#synthetic-data-generator)
7. [MyVivarium-2 README addition](#myvivarium-2-readme-addition)
8. [Future work — flagged but deferred](#future-work--flagged-but-deferred)
9. [Concerns to honor](#concerns-to-honor)
10. [Implementation status](#implementation-status)

## Overview

This is a **two-repo design**:

- `MyVivarium-2` — the application itself. PHP/MySQL colony management
  app. Lives at `github.com/robinson-vidva/MyVivarium-2`. Contains the
  PHP source, schema, demo configuration, and a short
  "Testing & Quality" section in its README pointing at this repo.
- `MyVivarium-2-tests` — this repo. Public. Contains the Docker test
  environment, the Playwright regression suite, the test plan, the
  synthetic dataset generator, and a public history of regression
  reports.

The split keeps the application repo focused on application code and
lets the test infrastructure evolve independently. A short link in the
app's README gives visibility without coupling the two repos.

Tests run against `MyVivarium-2`. The current commit of `MyVivarium-2`
being tested is recorded in `.app-version` at this repo's root, written
by the sync script and read by the regression runner.

## Repo layout

```
myvivarium-2-tests/                  (public, git tracked)
├── README.md                        Project overview, run instructions, link to MyVivarium-2
├── CLAUDE.md                        Workflow rules for AI sessions
├── docs/
│   ├── architecture.md              This document
│   └── decisions.md                 Architecture decision log
├── docker-compose.yml               PHP + MySQL + MailHog stack
├── docker/                          Dockerfile, entrypoint, php.ini
├── scripts/
│   ├── sync-app.sh                  Pull a specified version of MyVivarium-2 into ./app
│   ├── run-regression.sh            One-command: sync (if needed) + start stack + run suite + snapshot report
│   ├── seed-synthetic.ts            Generate the small realistic dataset
│   └── report-summarize.ts          Convert Playwright JSON results to markdown summary
├── tests/                           Playwright workspace
│   ├── package.json, tsconfig.json, playwright.config.ts
│   ├── TESTPLAN.md                  The 304-row capability catalog
│   ├── README.md                    Run commands only
│   ├── fixtures/                    db, auth, csrf, users, uniq
│   ├── seed/
│   │   ├── generate.ts              Synthetic data generator (called by seed-synthetic.ts)
│   │   ├── data/
│   │   │   ├── labs.json            Source data: lab names, PI names
│   │   │   ├── strains.json         JAX strain catalog excerpts
│   │   │   ├── names.json           User name pool
│   │   │   └── cage-ids.json        Cage ID templates
│   │   └── README.md                What the dataset contains, how to regenerate
│   └── specs/
│       ├── smoke.spec.ts
│       ├── auth/, mice/, security/, ui/                  (current)
│       └── (future modules per TESTPLAN.md)
├── regression-reports/              Public history of every run
│   ├── README.md                    How to read these
│   └── YYYY-MM-DD-HHMMSS-<sha7>/
│       ├── summary.md               Markdown: app SHA, pass/fail per spec, duration
│       ├── results.json             Raw Playwright JSON
│       └── artifacts/               (gitignored if large; or link to Actions artifact)
├── app/                             GITIGNORED. Synced from MyVivarium-2 on demand
├── v1-reference/                    GITIGNORED. Optional v1 sanity reference
└── .app-version                     Plain text file: the SHA currently synced into app/
```

`app/` and `v1-reference/` are gitignored. The Docker stack bind-mounts
`./app` into the container at `/var/www/html`. The tests reference
neither directly — they reach the app through `http://localhost:8080`
and the DB through `127.0.0.1:3307`.

## Sync workflow — `scripts/sync-app.sh`

Usage:

```
./scripts/sync-app.sh [ref]
  ref: branch, tag, or commit SHA. Defaults to "main".
```

Behaviour:

1. If `./app/` does not exist, clone
   `https://github.com/robinson-vidva/MyVivarium-2.git app`.
2. `cd app && git fetch origin && git checkout <ref>`. When `<ref>`
   is a branch, also `git pull --ff-only`.
3. Record the resolved commit SHA into `.app-version` at the repo root.
   Write atomically (write to temp file, rename) so a crashed sync
   never leaves a half-written version file.
4. Print a one-line summary: `Synced app to <ref> @ <sha7>`.

Typical invocations:

```
./scripts/sync-app.sh main           # after a merge to main
./scripts/sync-app.sh v2.1.0         # regression-test a release tag
./scripts/sync-app.sh 89f683b        # regression-test a specific commit
```

The sync is **read-only against MyVivarium-2**. It never pushes,
amends, or otherwise mutates the application repo.

## Regression run workflow — `scripts/run-regression.sh`

Usage:

```
./scripts/run-regression.sh [--no-sync] [--ref <ref>]
```

What it does:

1. Unless `--no-sync` is set, run `sync-app.sh --ref <ref>` (default
   `main`).
2. Read `.app-version` to get the synced SHA. **Refuse to continue if
   `.app-version` is missing** — a regression report without the SHA
   is uninterpretable later.
3. `docker compose down && docker compose up -d --build`.
4. Wait for the app to be reachable on `http://localhost:8080`.
5. `cd tests && npm test -- --reporter=json,html`.
6. Create a report directory:
   `regression-reports/YYYY-MM-DD-HHMMSS-<sha7>/`.
7. Copy `tests/playwright-report/results.json` into the report dir.
8. Run `scripts/report-summarize.ts` to produce `summary.md`.
9. Print a one-line summary:
   `X passed, Y failed, Z skipped against <sha7>. Report: regression-reports/...`.

Typical invocations:

```
./scripts/run-regression.sh                  # default: sync to main, run, snapshot
./scripts/run-regression.sh --ref v2.1.0     # test a specific release
./scripts/run-regression.sh --no-sync        # re-run against currently-synced app
```

## Regression report shape

Each report is a directory under `regression-reports/`, named
`YYYY-MM-DD-HHMMSS-<sha7>/`, where the SHA is the `MyVivarium-2`
commit under test (NOT this repo's commit). The directory contains:

- `summary.md` — human-readable markdown summary. The primary artifact.
  Diff-able, search-able, readable on GitHub directly.
- `results.json` — raw Playwright reporter output. The source of truth
  for the summary and useful for later automated analysis.
- `artifacts/` — Playwright screenshots, video, traces on failure. May
  be gitignored if the directory grows large; alternatively, attached
  to a GitHub Actions artifact when CI is wired up.

### `summary.md` shape

```markdown
# Regression run: 2026-05-12 14:30:22 UTC

## Target
- App: MyVivarium-2 @ 89f683b
  ("Security: fix auth bypass, CSRF, XSS, upload, and lockout bugs")
- Branch synced from: main
- Tests repo: 4a2c1f9 (this commit)

## Result
- 15 passed
- 0 failed
- 0 skipped
- Duration: 7.2s

## By module
| Module   | Passed | Failed | Skipped |
|----------|--------|--------|---------|
| smoke    | 1      | 0      | 0       |
| auth     | 8      | 0      | 0       |
| mice     | 2      | 0      | 0       |
| security | 2      | 0      | 0       |
| ui       | 2      | 0      | 0       |

## Failures
None.

## Notes
First run after the v2.1 security fixes. All baseline specs green.
```

When there are failures, the **Failures** section expands per-test with
the test name, the assertion error, and a classification stub
(`SELECTOR-WRONG` / `TEST-ASSUMPTION-WRONG` /
`TEST-INFRASTRUCTURE-WRONG` / `REAL-APP-BUG`) that Claude Code fills in
during diagnosis.

Reports are markdown so they render on GitHub, diff cleanly between
runs, and stay readable six months later. Reports are kept forever.

## Synthetic data generator

`scripts/seed-synthetic.ts` produces a deterministic, realistic dataset
the test suite can sit on top of.

Usage:

```
./scripts/seed-synthetic.ts [--size small|medium] [--target test|demo] [--seed N]
  --size:   small (default)  ~10 cages, ~50 mice
            medium            ~100 cages, ~500 mice
  --target: test (default)   seed the local test DB directly
            demo              emit SQL applied to a demo-site DB
  --seed:   integer seed for the PRNG; same seed produces the same data
```

### Small dataset contents

- 1 lab with a realistic name and PI
- 5 strains (a mix of common JAX lines)
- 2 IACUC protocols
- 4 users: 1 admin (matches the schema seed), 1 vivarium_manager,
  2 regular users
- 7 holding cages with 30 mice across them (various sexes, DOBs,
  genotypes)
- 3 breeding cages with 6 founder mice as parents and ~20 offspring
- Realistic `mouse_cage_history` — most mice with 1-2 prior moves
- 8 sticky notes scattered across cages
- 5 maintenance entries
- 6 tasks (mixed statuses, distributed across users)
- 3 recurring reminders (one daily, one weekly, one monthly)
- 4 audit-log entries from past actions

### Determinism

Every run with the same `--seed` produces byte-identical output. The
default seed is `42`. Specs that need stable data references can rely
on the seeded dataset; specs that mutate data use `uniq()` IDs layered
on top, so they never collide with seeded rows.

### Dual target

Same generator, two outputs:

- `--target test` writes rows directly to the test database via
  `mysql2`. Called by `seed-synthetic.ts` at the top of relevant spec
  files (or as a one-off CLI).
- `--target demo` writes a SQL file (stdout or to a path). That file is
  uploaded to the demo site via phpMyAdmin, or applied by a
  `database/seed-demo.php` script during demo provisioning.

The shared code path means the demo site and the test environment have
identical realistic baselines.

## MyVivarium-2 README addition

A short Testing & Quality section to be appended to `MyVivarium-2`'s
existing `README.md` once this repo is public:

```markdown
## Testing & Quality

Regression tests, the test plan, and historical regression reports live
in a companion repository:
[MyVivarium-2-tests](https://github.com/robinson-vidva/MyVivarium-2-tests).

That repo contains:
- A Docker-based test environment (PHP/MySQL/MailHog)
- A Playwright regression suite
- A 300+ row test plan tracking coverage
- A synthetic dataset for fast realistic testing
- Public regression reports snapshotted on every run
```

One paragraph, one link. The app repo itself does not change beyond
that addition unless a regression run surfaces a real bug, in which
case the fix flows back as a PR.

## Future work — flagged but deferred

These are deliberately out of scope for the initial build. Each is
straightforward once the foundation is stable; doing them in parallel
with the foundation is how scope creep starts.

- **CI in GitHub Actions.** A workflow that runs
  `./scripts/run-regression.sh` on a schedule and on every push to
  `MyVivarium-2`'s `main`, then commits the regression report back.
  Deferred until enough manual runs exist to know what "good" looks
  like.
- **Medium dataset.** `--size medium` (~100 cages, ~500 mice) for load
  / pagination realism. Not needed for correctness regressions; useful
  for performance regressions later.
- **Demo site auto-deploy.** A GitHub Action that, on every successful
  regression run against a release tag, regenerates the demo database
  with `--target demo` and pushes the SQL to the demo host. Currently
  manual.
- **Inline Playwright HTML report.** Today the report is linked from
  `results.json` and rendered separately. An inline embed in
  `summary.md` is feasible but adds storage cost; defer until storage
  cost has been measured.
- **Failure classification automation.** Claude Code currently
  classifies failing specs by hand during diagnosis (`SELECTOR-WRONG`,
  `TEST-ASSUMPTION-WRONG`, `TEST-INFRASTRUCTURE-WRONG`,
  `REAL-APP-BUG`). Heuristic automation on failure signatures is
  feasible but defers until we have several real failures to learn
  from.
- **Multiple-app-version compare runs.**
  `./scripts/run-regression.sh --against v2.0.0,v2.1.0,main` would
  generate a regression report against each named ref plus a diff
  between them. Defer until there is a concrete reason to compare
  versions side-by-side.
- **Service worker / PWA depth tests.** TESTPLAN currently has one
  row covering registration plus offline fallback (NAV-10, NAV-11).
  Expand into cache-key behaviour, update flow, and offline-mode
  mutation queueing if PWA becomes a feature users depend on.

## Concerns to honor

- **Public regression reports raise the bar.** Once this repo is
  public, every failed run is visible. That is the point — the public
  history is the quality signal. Discipline: when something fails,
  snapshot it, classify it, fix it, re-run, snapshot again. **Do not
  suppress failed reports.** The history is the value.
- **The `.app-version` file is the linchpin.** Without it, reports are
  uninterpretable six months later. The sync script must write it
  atomically; the report-summarize step must refuse to produce a
  report if it is missing.
- **The synthetic data generator is its own small project.** Treat it
  as its own phase, not bundled into a regression-runner phase. A few
  hours of focused work; worth it for both the test fixtures and the
  demo dataset.

## Implementation status

As of the date this document was written, the implemented surface is a
subset of the architecture described above. The full list:

**Implemented**

- `docker-compose.yml` — PHP 8.1 + Apache + MySQL 8 stack. Reachable
  at `http://localhost:8080` (app) and `127.0.0.1:3307` (DB).
- `docker/` — `Dockerfile`, `entrypoint.sh`, `php.ini`.
- `tests/` — Playwright workspace with `package.json`,
  `playwright.config.ts`, `tsconfig.json`, `README.md`, `.gitignore`,
  `TESTPLAN.md` (304 rows).
- `tests/fixtures/` — `auth.ts`, `csrf.ts`, `db.ts`, `uniq.ts`,
  `users.ts`.
- `tests/specs/` — 5 reference spec files (smoke, auth/login,
  mice/move-atomic, security/csrf, ui/dark-mode) with 15 passing tests.
- `CLAUDE.md` at the repo root.
- `app/` and `v1-reference/` gitignored.

**Not yet implemented (planned per this document)**

- `scripts/sync-app.sh`, `scripts/run-regression.sh`,
  `scripts/seed-synthetic.ts`, `scripts/report-summarize.ts`.
- `tests/seed/` directory and the synthetic data generator.
- `regression-reports/` directory and the public report history.
- `.app-version` file (created by the sync script).
- MailHog (or another mail catcher) in `docker-compose.yml`. Current
  SMTP target is `smtp.invalid` by design, which fails fast and
  exercises the `outbox` failure-status path. A mail catcher would let
  specs assert on rendered email bodies.
- `README.md` at the repo root (Project overview, run instructions,
  link to MyVivarium-2).
- The Testing & Quality paragraph added to MyVivarium-2's README.
- The public GitHub repo itself at
  `github.com/robinson-vidva/MyVivarium-2-tests`.

The Phase 5 work plan covers building these out.
