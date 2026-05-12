# MyVivarium-2 regression tests

Playwright + TypeScript suite that drives the Dockerized app at
`http://localhost:8080`.

## Prerequisites

1. Node 18+ on the host.
2. The Docker stack is up:
   ```
   docker compose up -d --build
   ```
   App reachable at http://localhost:8080, MySQL on host port 3307.
3. The `app/` clone is on the `deep-testing` branch:
   ```
   cd app && git branch --show-current   # must print deep-testing
   ```
   That branch carries one commit making the session cookie Secure
   flag env-driven (`SESSION_COOKIE_SECURE=false` is set in
   `docker-compose.yml`). On `main` the flag is hardcoded `true` and
   the browser will silently drop PHPSESSID over HTTP, breaking login.

## Install

From the repo root (this directory, not `app/`):

```
npm install
npx playwright install chromium
```

## Run

```
npm test                # headless, list + html reporter
npm run test:headed     # headed mode for debugging
npm run test:debug      # PWDEBUG=1 (inspector)
npm run report          # open last HTML report
```

Override the target URL or DB host with env vars:

```
BASE_URL=http://127.0.0.1:8080 DB_PORT=3307 npm test
```

## Layout

```
tests/
  README.md              this file
  fixtures/
    auth.ts              loginAs(), logout(), adminPage fixture, admin creds
    db.ts                mysql2 connection helper for state verification
  specs/
    smoke.spec.ts        login page renders (harness sanity)
```

Phase 3 will add: `auth.spec.ts`, `mouse-move-atomic.spec.ts`,
`csrf.spec.ts`, `dark-mode.spec.ts`.

## Conventions

- Tests run **serialized** (`workers: 1`, `fullyParallel: false`). The
  app's MySQL is shared mutable state; isolation is by unique entity
  names per test, not parallel sandboxes.
- Tests that mutate must use timestamp- or random-suffixed cage/mouse
  IDs so re-runs do not collide with prior data.
- Direct DB reads via `withDb(...)` are preferred over UI-scraping for
  state verification (e.g., `mouse_cage_history.moved_out_at IS NULL`).
- Never loosen an assertion to make a test pass. A failing test means
  one of: SELECTOR-WRONG (fix spec), TEST-ASSUMPTION-WRONG (fix spec),
  or REAL-APP-BUG (stop, report, wait for approval before touching
  `app/`).

## Reset between runs

The stack preserves DB state across `docker compose restart`. To wipe:

```
MV_RESET=1 docker compose up -d --force-recreate
```

That drops every table and re-applies `database/schema.sql`, restoring
the seed admin (`admin@myvivarium.online` / `P@ssw0rd`).
