# Synthetic seed dataset

What `scripts/seed-synthetic.ts` populates into a fresh test database.

## Contents

When run with the default seed (42), the seeder creates:

- **1 lab settings update** — name, public URL, timezone (from `data/labs.json`).
- **5 strains** — real JAX strains: C57BL/6J, BALB/cJ, FVB/NJ, DBA/2J, 129S1/SvImJ (from `data/strains.json`). Inserted via the `manage_strain.php` UI.
- **2 IACUC protocols** — both upload `data/sample.pdf` (a synthetic ~370-byte PDF, valid `application/pdf` per libmagic). Inserted via the `manage_iacuc.php` UI.
- **3 non-admin users** — one `vivarium_manager`, two regular `user`s. Inserted via direct mysql2 `INSERT` because `manage_users.php` has no add-user form and `register.php` requires email verification.
- **7 holding cages** — `HC-001` through `HC-007`, spread across rooms B201 / B202. Inserted via `hc_addn.php` UI (from `data/cages.json`).
- **30 mice** — distributed across the 7 holding cages, varied sex / DOB / strain / genotype. The first 24 (founders, no sire/dam) go through the `mouse_addn.php` UI for full UI coverage. The remaining 6 (offspring with `sire_id` / `dam_id` FKs into earlier-created mice) use `page.request.post()` because the Select2 parent picker is AJAX-driven and brittle to drive.
- **5 mouse moves** — close one history interval, open another; recorded in `mouse_cage_history`. Driven via `page.request.post()` to `mouse_move.php`.
- **3 breeding cages** — `BC-001` through `BC-003`, each with `male_id` / `female_id` FKs into existing mice. Driven via `page.request.post()` to `bc_addn.php` because the parent picker is the same Select2-typeahead surface.
- **8 sticky notes** — scattered across cages. Driven via `page.request.post()` to `nt_add.php` (JSON-only AJAX endpoint).
- **5 maintenance entries** — varied cages and comments. Inserted via the `maintenance.php` UI.
- **6 tasks** — mix of `Pending` / `In Progress` / `Completed`, assigned to different users. Inserted via the `manage_tasks.php` UI.
- **3 recurring reminders** — one daily (`08:00:00`), one weekly Monday (`09:30:00`), one monthly day-15 (`10:00:00`). Inserted via the `manage_reminder.php` UI.

The exact entity counts and the seed used are written to
`scripts/seed/last-run.json` after each successful run.

## How to regenerate

```
# Bring up the Docker stack first (see top-level CLAUDE.md)
docker compose up -d --build

# From the working directory root:
cd scripts && npm install     # first time only
npx tsx seed-synthetic.ts                 # default seed=42

# Other variants
npx tsx seed-synthetic.ts --seed 99       # different deterministic dataset
npx tsx seed-synthetic.ts --quiet         # less progress output
npx tsx seed-synthetic.ts --force         # skip the fresh-DB check
```

## Determinism

The dataset is deterministic with respect to `--seed`. Two runs with the
same seed produce identical: cage IDs, mouse IDs, ear codes, genotypes,
note text, maintenance comments, task assignments, and move sequences.
The PRNG is a small in-script mulberry32 — `Math.random()` is never
called.

Timestamps (`created_at`, `moved_in_at`, etc.) are server-assigned and
will differ between runs. The seeder does not attempt to backdate.

## What is NOT in the dataset

- No real PHI, no real human names, no real animal-protocol numbers.
- No real strain holders — JAX IDs are accurate (so the strain pages
  render correctly) but every other field is synthetic.
- No completed regression-test artifacts. The seed is only the
  "before state" for Phase 3+ specs.
- No mice in sacrificed / transferred_out / archived status. All
  seeded mice are `alive`. Specs that need terminal-status mice
  produce them themselves.

## Source data files

| File | Purpose |
|---|---|
| `data/labs.json` | Single lab-settings object. |
| `data/strains.json` | 5 strain records, JAX-accurate. |
| `data/users.json` | 3 non-admin users with plaintext passwords (bcrypt-hashed at script runtime). |
| `data/cages.json` | 7 holding + 3 breeding cage templates. |
| `data/names.json` | Pools of mouse-name suffixes, ear codes, genotypes, note text, task and reminder copy. |
| `data/sample.pdf` | 376-byte synthetic PDF used for IACUC uploads. |
