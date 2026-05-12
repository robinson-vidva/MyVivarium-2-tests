# Architecture decisions

Short log of structural decisions for MyVivarium-2-tests. One entry per
decision. When making a new structural decision, add a numbered entry
below with the same five fields.

## ADR-001: How should MyVivarium-2-tests sync from MyVivarium-2?

- **Date:** 2026-05-12
- **Choice:** Manual via `scripts/sync-app.sh`.
- **Rationale:** Solo project; control matters more than automation.
  Manual sync avoids surprise regression runs against unstable `main`
  commits and keeps "what version is under test" a deliberate, dated
  decision.
- **Alternatives considered:** Scheduled nightly sync; sync on every
  push to MyVivarium-2 `main`; both (nightly + on-push).

## ADR-002: How often to snapshot regression reports?

- **Date:** 2026-05-12
- **Choice:** Every run, keep forever.
- **Rationale:** The public history is the quality signal — losing runs
  means losing the trend. Markdown reports are small; storage cost is
  not the constraint. Per-failure retention or 30-day windows risk
  pruning exactly the runs that turn out to matter.
- **Alternatives considered:** 30-day retention; keep only on failure;
  only manually-promoted snapshots.

## ADR-003: Synthetic dataset size?

- **Date:** 2026-05-12
- **Choice:** Small dataset (~10 cages, ~50 mice), realistic but fast.
- **Rationale:** Fast test feedback matters more than load coverage for
  a correctness regression suite. The same generator can produce a
  medium dataset later if performance regressions become a concern. The
  demo site can use the same generator with different parameters.
- **Alternatives considered:** Medium dataset (~100 cages, ~500 mice);
  ship both small and medium up front; defer dataset generation
  entirely and rely on per-spec `uniq()` data.

## ADR-004: Public or private MyVivarium-2-tests repo?

- **Date:** 2026-05-12
- **Choice:** Public, including the regression report history.
- **Rationale:** The test plan and report history are themselves a
  quality signal for the research-software audience. Honesty about
  coverage gaps is more credible than no tests. The discipline of
  knowing every failure is visible enforces good failure-classification
  habits.
- **Alternatives considered:** Private repo entirely; public plan but
  private reports.

## ADR-005: Tests inline in the main repo, or separate repo?

- **Date:** 2026-05-12
- **Choice:** Separate repo, with a short "Testing & Quality" section
  in MyVivarium-2's README linking back here.
- **Rationale:** Keeps the application repo focused on application
  code. Lets the test infrastructure (Docker, Playwright, dataset
  generator, report history) evolve independently. A single-paragraph
  link gives visibility without coupling the repos' commit histories.
- **Alternatives considered:** Single `tests/` folder in the main repo;
  hybrid (lightweight unit-style tests in main, heavy integration
  infrastructure here).

## ADR-006: How does this repo reference the MyVivarium-2 source?

- **Date:** 2026-05-12
- **Choice:** Gitignored `app/` directory, populated by
  `scripts/sync-app.sh`. The exact synced SHA is written to
  `.app-version` at the repo root. The `app/` directory itself is
  never committed to MyVivarium-2-tests.
- **Rationale:** Avoids two copies of the application code in version
  control, keeps this repo lean, and lets each regression report
  record the exact SHA it ran against without needing to also store a
  copy of the code at that SHA.
- **Alternatives considered:** Git submodule pointing at
  MyVivarium-2; commit `app/` as a snapshot at each regression run.

## ADR-007: What to do when a specified commit message contains a factual error?

- **Date:** 2026-05-12
- **Choice:** Stop, flag the error, offer corrected text, await
  confirmation before committing.
- **Rationale:** Honest commit history matters more than literal
  adherence to a specified message; once a misleading commit is
  logged, the no-amend rule forces a follow-up fix that is uglier
  than catching the inaccuracy at draft time. Precedent set in the
  Phase 4 boundary commit and the initial commit.
- **Alternatives considered:** Commit verbatim and amend later;
  silently correct the inaccuracy.
