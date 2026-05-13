# CLAUDE.md — context bootstrap

## Purpose

This directory is a regression test environment for MyVivarium-2, a
PHP/MySQL vivarium colony management application. It contains a Docker
stack that runs the app, a Playwright TypeScript test harness, a 304-row
test plan cataloguing every testable v2 capability, and a sibling git
history that lives alongside the app's `deep-testing` branch. The app
itself is cloned into `app/` and treated as upstream code — we test it,
we do not own it.

## Architecture

This repo follows a specific architecture documented in
`docs/architecture.md`. Read it before making structural changes (new
scripts, repo layout shifts, new top-level directories). Decisions are
logged in `docs/decisions.md`. If you make a new structural decision,
add it to `decisions.md` as a numbered entry with Date | Question |
Choice | Rationale | Alternatives.

## Scripts

Three TypeScript scripts under `scripts/`, run via `tsx`:

- `scripts/sync-app.ts [ref]` — pull a version of MyVivarium-2 into `../app`.
- `scripts/run-regression.ts [--no-sync] [--ref <ref>]` — sync, bring up the stack, run the suite, snapshot a report.
- `scripts/report-summarize.ts` — convert Playwright JSON to `summary.md`. Called by `run-regression`.

First-time setup: `cd scripts && npm install`.

Regression reports land in `regression-reports/YYYY-MM-DD-HHMMSS-<sha7>/`.

## Repo layout

- `app/` — clone of `https://github.com/robinson-vidva/MyVivarium-2`,
  checked out on the `deep-testing` branch. Never `main`. The Docker
  stack bind-mounts this directory at `/var/www/html`. It has its own
  `.git/` and is excluded from this repo's commits via `.gitignore`.
- `docker/` — `Dockerfile`, `php.ini`, and `entrypoint.sh` that build
  the PHP 8.1 + Apache image. `docker-compose.yml` at the root wires
  app + MySQL 8.
- `tests/` — Playwright TypeScript harness. `TESTPLAN.md` is the
  catalogue; `specs/` holds 5 reference spec files (15 passing tests);
  `fixtures/` holds login, DB, CSRF, user-seeding, and uniq-id helpers;
  `README.md` explains how to run.
- `v1-reference/` — read-only clone of
  `https://github.com/myvivarium/MyVivarium` (HEAD `4b3a756...`). Used
  in Phase 4 only, as a sanity check for what v2 inherits. Tests never
  run against v1-reference and Docker never sees it. Gitignored.

## How to run

```
docker compose up -d --build       # app on :8080, MySQL on :3307
cd tests
npm install                        # first time only
npm test                           # 15 tests, all green at last run
```

More detail (reset recipe, env-var overrides, troubleshooting) in
`tests/README.md`.

## Workflow rules

- `app/` default is read-only. The only legitimate reason to modify it
  is a confirmed REAL-APP-BUG, and modifications happen on the
  `deep-testing` branch only.
- **Process for any app fix:** stop, explain the bug in plain English
  (what is wrong, what should happen, why it matters), wait for explicit
  "yes, fix it", make the minimum change, re-run the failing test plus
  the full suite, show `git status` and `git diff` from `app/`, do not
  commit until Robinson reviews. One bug per commit. Never push.
- **Never loosen a test assertion to make a test pass.** A failing test
  is a signal, not a problem to silence.
- **Failure classification when a spec fails:**
  - `SELECTOR-WRONG` — fix the spec
  - `TEST-ASSUMPTION-WRONG` — fix the spec
  - `TEST-INFRASTRUCTURE-WRONG` — fix entrypoint / config / helper
  - `REAL-APP-BUG` — stop, explain, await approval
- **Phase-boundary verification:** at the end of every phase, produce
  an explicit expected-file list, `ls` the destination, mark
  OK/MISSING per file, and print expected vs actual counts. Do not
  infer "verified" from the fact that a `Write` returned without error.
- No emojis. Minimal comments. Plain markdown.
- Robinson runs Docker and the test suite on his Mac. The agent does
  not have Docker available. Build correct files; Robinson pastes
  results.

## Carry-over findings (from Phase 4)

Each item below is a known v2 behaviour that needs a test, a documented
caveat, or both. The "owner" pointer goes to the TESTPLAN row(s) or
Known-caveat section that already cover it.

1. `send_email.php` weak HTTP guard — TESTPLAN: **CRON-02** (TODO, marked `EXPECTED TO FAIL until fix`).
2. `mouse_move.php redirect_to` allow-list — TESTPLAN: **MOUSE-30** (TODO security).
3. CSRF absent on `index.php` login — **intentional design**, not currently a TESTPLAN row or Known caveat. The login endpoint cannot validate a session-scoped CSRF token because no session exists pre-login. Mitigations: username-enumeration prevention (AUTH-06) and brute-force lockout (AUTH-08). If a future cycle wants this documented, add it as a Known caveat in TESTPLAN.
4. `nt_add` rejection shape (403+JSON) differs from most other endpoints (200+plain) — TESTPLAN: **Known caveats §3** + **NOTES-04 / NOTES-10 / NOTES-14**.
5. Account approval pending state blocks login — TESTPLAN: **AUTH-16** (login-side) + **AUTH-18** (registration-side that produces it).
6. Cage archive / restore / permanent-delete — TESTPLAN: **HC-23 / HC-24 / HC-25 / HC-26** (holding) + **BC-20 / BC-21 / BC-22 / BC-23** (breeding).
7. `cage_users` junction governs non-admin per-cage permissions — TESTPLAN: **RBAC-06 / RBAC-10 / RBAC-11** + **FILE-05**.
8. `delete_file.php` is GET-based with `cage_users`-based authz — TESTPLAN: **Known caveats §4** + **FILE-05 / FILE-06 / FILE-07**.
9. Three CSRF rejection shapes across the codebase — TESTPLAN: **Known caveats §3** + **MAINT-12** (third shape, in `vivarium_manager_notes.php` AJAX).
10. Mouse hard-delete: retype + reason ≥ 3 chars + audit-log written BEFORE the DELETE — TESTPLAN: **MOUSE-35 / MOUSE-36 / MOUSE-37 / MOUSE-38** + **Known caveats §7** (whitespace-only reason currently passes the length check).
11. `admin_import` preflight `has_data` check + `confirm_overwrite` checkbox — TESTPLAN: **MIG-05 / MIG-06**.
12. Reminder archive / restore / permanent-delete — TESTPLAN: **SCHED-18 / SCHED-19 / SCHED-20**.
13. Email-on-task-assignment writes `outbox` rows — TESTPLAN: **SCHED-03**.

## deep-testing branch state

One commit so far on `app/`'s `deep-testing` branch:

```
a4abdda  fix(session): make cookie Secure flag env-driven
```

Default behaviour is still `'secure' => true`. Setting
`SESSION_COOKIE_SECURE=false` (which `docker-compose.yml` does on the
`app` service) flips the cookie to allow HTTP dev. Branch is local-only.
Robinson pushes manually after reviewing.

## How to resume a session

1. Read this file.
2. Read `tests/TESTPLAN.md` to see the current capability map and
   what is A / M / TODO.
3. Ask Robinson where to pick up. Do not guess from git history alone.
4. Verify `app/` is on the right branch:
   ```
   cd app && git branch --show-current   # must print: deep-testing
   ```

## What not to do

- Do not push any branch.
- Do not modify `app/` files except on `deep-testing` and only after
  a REAL-APP-BUG has been classified and explicitly approved.
- Do not write specs that mock instead of verify. A spec asserting "no
  error thrown" when the spec should verify an actual outcome is worse
  than no spec.
- Do not consolidate TESTPLAN rows. Each row earned its spot during
  Phase 4 review.
- Do not regenerate `tests/TESTPLAN.md` without a specific request.
- Do not run `docker compose` or `npm test` yourself — the agent does
  not have Docker in its environment. Build correct files; Robinson
  runs the stack.
- Do not silently `--amend` a commit. Per workflow, always create a new
  commit unless Robinson explicitly requests an amend.
