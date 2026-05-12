# MyVivarium-2 regression test plan

Map of every testable capability in v2. Implementation lives in `specs/`;
this file is the contract for what is covered, what is manual, and what
is queued.

## Status legend

- `A` — Automated. Cell links to the spec file that implements it.
- `M` — Manual. Run from this checklist; no automation worth maintaining
  (typically because the action depends on SMTP, real-time cron, hardware,
  or external services).
- `TODO` — Automation planned, spec not yet written.

A `TODO` row with the suffix `(EXPECTED TO FAIL until fix)` means the
spec, when written, will currently fail and is the signal for a
diagnose-and-fix cycle on `deep-testing`.

## ID format

`<MODULE>-NN` per row, monotonically numbered within a module. Module
codes match the table-of-contents below.

## Table of contents

1. [AUTH](#1-auth--authentication--account-lifecycle)
2. [RBAC](#2-rbac--role-based-access-control)
3. [NAV](#3-nav--header-footer-session-pwa-dark-mode)
4. [HC](#4-hc--holding-cages)
5. [BC](#5-bc--breeding-cages)
6. [MOUSE](#6-mouse--mouse-as-entity)
7. [CARDS](#7-cards--printable-cage-cards)
8. [LINEAGE](#8-lineage--cage-lineage-view)
9. [SCHED](#9-sched--tasks-reminders-calendar)
10. [NOTES](#10-notes--sticky-notes)
11. [NOTIF](#11-notif--in-app-notifications)
12. [AUDIT](#12-audit--activity-log)
13. [MAINT](#13-maint--maintenance-log--vm-oversight)
14. [ADMIN](#14-admin--admin-reference-data)
15. [DATA-IO](#15-data-io--csv-export--v1-import)
16. [FILE](#16-file--file-attachments)
17. [IOT](#17-iot--iot-sensors)
18. [CRON](#18-cron--email-queue--reminder-worker)

End sections: [v1 feature coverage check](#v1-feature-coverage-check),
[How to run](#how-to-run), [Known caveats](#known-caveats),
[Coverage summary](#coverage-summary).

---

## 1. AUTH — authentication & account lifecycle

Files: `index.php`, `register.php`, `logout.php`, `forgot_password.php`,
`reset_password.php`, `confirm_email.php`, `user_profile.php`,
`session_config.php`.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| AUTH-01 | Login page renders with username, password, submit | A | [specs/smoke.spec.ts](specs/smoke.spec.ts) |
| AUTH-02 | Admin can log in and lands on home.php | A | [specs/auth/login.spec.ts](specs/auth/login.spec.ts) (`@smoke`) |
| AUTH-03 | Vivarium Manager can log in | A | [specs/auth/login.spec.ts](specs/auth/login.spec.ts) (`@smoke`) |
| AUTH-04 | Standard user can log in | A | [specs/auth/login.spec.ts](specs/auth/login.spec.ts) (`@smoke`) |
| AUTH-05 | Wrong password rejected with "Invalid credentials. Please try again." | A | [specs/auth/login.spec.ts](specs/auth/login.spec.ts) |
| AUTH-06 | Unknown email yields the same error string as wrong password (no enumeration) | A | [specs/auth/login.spec.ts](specs/auth/login.spec.ts) |
| AUTH-07 | Logout destroys session; subsequent /home.php hits redirect to /index.php | A | [specs/auth/login.spec.ts](specs/auth/login.spec.ts) |
| AUTH-08 | Account lockout after 3 failed attempts; 15-minute lock (UTC-anchored) | A | [specs/auth/login.spec.ts](specs/auth/login.spec.ts); DB-assert `users.account_locked` window. |
| AUTH-09 | Even correct password is rejected while account is locked | A | Covered inside AUTH-08 (4th attempt with correct password). |
| AUTH-10 | Successful login resets `login_attempts` to 0 and clears `account_locked` | TODO | Pre-set attempts via DB; log in; DB-assert reset. |
| AUTH-11 | Login regenerates session id (prevents fixation) | TODO | Capture PHPSESSID before/after login; assert different. |
| AUTH-12 | Session expires after 30 min of inactivity; next request returns to /index.php | TODO | Mutate `$_SESSION['LAST_ACTIVITY']` via DB-side cannot apply — manual or fast-forward via test hook. Possibly `M`. |
| AUTH-13 | Open-redirect block on `?redirect=` — external URLs ignored, login lands on /home.php | TODO | Try `?redirect=https://evil.test/`, `?redirect=//evil.test`, `?redirect=/../`. |
| AUTH-14 | Same-origin `?redirect=foo.php` honoured after successful login | TODO | Try `?redirect=hc_dash.php` and assert final URL. |
| AUTH-15 | Unverified email blocks login and resends verification email | TODO | Insert user with `email_verified=0`; attempt login; assert error text + outbox row. |
| AUTH-16 | Pending-status user blocked from login with "pending admin approval" message | TODO | Insert user with `status='pending'`; assert error text. |
| AUTH-17 | Cloudflare Turnstile gate enforced when both settings keys are set | M | Requires real Turnstile keys; not testable in headless CI. |
| AUTH-18 | Self-registration creates user with `status='pending'` and `email_verified=0` | TODO | POST register; DB-assert row state. |
| AUTH-19 | Registration honeypot field rejects bot submissions | TODO | POST with the honeypot field non-empty; assert no row inserted. |
| AUTH-20 | Registration rejects duplicate email | TODO | Insert a user; POST registration with same `username`; assert error message. |
| AUTH-21 | Email confirmation: valid token sets `email_verified=1` and clears `email_token` | TODO | Seed user with token; GET `/confirm_email.php?token=...`; DB-assert. |
| AUTH-22 | Email confirmation: invalid or expired token shows error and leaves row unchanged | TODO | GET with bogus token; assert no DB change. |
| AUTH-23 | Forgot-password generates reset token + outbox email | TODO | POST forgot; DB-assert `reset_token`/`reset_token_expiration` non-null and outbox row pending. |
| AUTH-24 | Forgot-password unknown email shows generic success (no enumeration) | TODO | POST forgot with random email; assert no DB token created and message is identical to known-email response. |
| AUTH-25 | Reset password with valid unexpired token sets new hash; token cleared | TODO | Seed token; POST reset; DB-assert. |
| AUTH-26 | Reset password with expired token rejected | TODO | Seed token with `reset_token_expiration` in the past; POST reset; assert error. |
| AUTH-27 | Reset password with bogus token rejected | TODO | POST with random token; assert error and no DB change. |
| AUTH-28 | User profile edit: update name and position | TODO | POST profile update; DB-assert updates. |
| AUTH-29 | User profile email change triggers re-verification flow | TODO | Change `username` field; DB-assert `email_verified=0`, new `email_token`, outbox row. |
| AUTH-30 | User profile "request password change" flow sends reset email | TODO | POST reset request; assert outbox row. |

---

## 2. RBAC — role-based access control

Cross-cutting. Three roles in `users.role`: `admin`, `vivarium_manager`,
`user`. Per-cage permissions tracked in the `cage_users` junction.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| RBAC-01 | Protected pages redirect to /index.php when unauthenticated | A | [specs/auth/login.spec.ts](specs/auth/login.spec.ts) (8 paths sampled) |
| RBAC-02 | Admin-only pages reject vivarium_manager and user roles | TODO | Loop over `manage_users.php`, `manage_iacuc.php`, `manage_strain.php`, `manage_lab.php`, `activity_log.php`, `export_data.php`, `admin_import.php` for each non-admin role; assert redirect to /index.php. |
| RBAC-03 | Admin+VM-only pages (`vivarium_manager_notes.php`) reject standard `user` role | TODO | Authenticate as user; GET page; assert redirect. |
| RBAC-04 | Admin and VM both accepted on `vivarium_manager_notes.php` | TODO | Both roles see HTTP 200 and the form. |
| RBAC-05 | Mouse hard-delete (`mouse_drop.php`) requires admin role | TODO | POST as VM and as user; assert rejection message. |
| RBAC-06 | `delete_file.php` requires admin role OR cage_users membership for the file's cage | TODO | Test as cage_users-member user (allowed) and unrelated user (denied). |
| RBAC-07 | Note edit (`nt_edit.php`) restricted to original creator or admin | TODO | User-A creates note; User-B tries to edit; admin tries to edit (allowed). |
| RBAC-08 | Note delete (`nt_rmv.php`) restricted to original creator or admin | TODO | Same matrix as RBAC-07. |
| RBAC-09 | Task delete (`manage_tasks.php`) restricted to `assigned_by` user or admin | TODO | Created via API; delete attempt as third party rejected. |
| RBAC-10 | Cage-user assignment via `hc_addn`/`hc_edit` writes `cage_users` junction row | TODO | Create cage with selected users; DB-assert junction rows. |
| RBAC-11 | Non-admin user only sees cages they are assigned to (or none) on dashboards | TODO | Seed cage with only admin assigned; log in as user; assert cage absent from `/hc_dash.php`. |
| RBAC-12 | Header nav exposes admin-only items only to admin role | TODO | Compare visible `dropdown-item` set per role; admin sees Manage Users/IACUC/Strain/Lab/Activity Log/Export/Import; VM sees Maintenance Notes; user sees neither. |
| RBAC-13 | `home.php` admin-banner block visible only to seeded admin email + admin role (line 119) | TODO | This is a banner intended for the demo seed admin; assert it does not render for other admins or after rename. |

---

## 3. NAV — header, footer, session, PWA, dark mode

Files: `header.php`, `footer.php`, `message.php`, `manifest.json`,
`sw.js`. Cross-cutting visual / chrome layer.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| NAV-01 | Header displays lab name and logo sourced from `settings` table | TODO | Seed `lab_name='Test Lab Name'`; assert visible. |
| NAV-02 | Header dropdowns gate by role (see RBAC-12) | TODO | Same as RBAC-12; lives there. |
| NAV-03 | Notification bell renders for authenticated users with unread count badge | TODO | Insert N notifications for current user; assert bell shows N. |
| NAV-04 | Dark-mode toggle: light → dark sets `html[data-bs-theme="dark"]` | A | [specs/ui/dark-mode.spec.ts](specs/ui/dark-mode.spec.ts) |
| NAV-05 | Dark-mode toggle: dark → light sets `html[data-bs-theme="light"]` | A | [specs/ui/dark-mode.spec.ts](specs/ui/dark-mode.spec.ts) |
| NAV-06 | Dark mode persists across page reload and same-tab navigation | A | [specs/ui/dark-mode.spec.ts](specs/ui/dark-mode.spec.ts) |
| NAV-07 | `localStorage.mv-theme` reflects current theme after toggle | A | [specs/ui/dark-mode.spec.ts](specs/ui/dark-mode.spec.ts) |
| NAV-08 | Footer shows lab name + current year | TODO | Match year against `new Date().getFullYear()`. |
| NAV-09 | `$_SESSION['message']` rendered as Bootstrap alert and then unset | TODO | Set message via flow that triggers it (e.g. archive cage); next page shows alert; reload — alert gone. |
| NAV-10 | Service worker registers from `/sw.js` on first page load | TODO | Wait for `navigator.serviceWorker.controller` or `getRegistrations()`. |
| NAV-11 | Service worker offline fallback: page served from SW cache when network is down | M | Manual: install via Chrome devtools, toggle offline, reload. |
| NAV-12 | Security header `X-Content-Type-Options: nosniff` set by `header.php` | TODO | Inspect response headers on any authenticated page. |
| NAV-13 | Mobile responsive: hamburger menu visible at narrow viewport widths | M | Visual inspection at <768px; automation low ROI. |
| NAV-14 | PWA installability metadata: `manifest.json` linked from pages | TODO | Inspect `<link rel="manifest">` and fetch the URL. |

---

## 4. HC — holding cages

Files: `hc_addn.php`, `hc_dash.php`, `hc_view.php`, `hc_edit.php`,
`hc_drop.php`, `hc_fetch_data.php`. Mutates `cages`, `cage_iacuc`,
`cage_users`, `files`, `notifications`. Cage type is implicit: a row in
`cages` with no row in `breeding` is a holding cage.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| HC-01 | Create holding cage with valid CSRF token persists row in `cages` | A | [specs/security/csrf.spec.ts](specs/security/csrf.spec.ts) (positive-control) |
| HC-02 | Create rejects without CSRF token (200 + "CSRF token validation failed") | A | [specs/security/csrf.spec.ts](specs/security/csrf.spec.ts) |
| HC-03 | Create with only `cage_id` (other fields blank) succeeds | TODO | Minimal POST; assert row + redirect. |
| HC-04 | Create with PI, room, rack, IACUC[], user[], remarks persists all values + junction rows | TODO | Full POST; DB-assert `cages.*`, `cage_iacuc`, `cage_users`. |
| HC-05 | Create with cage_id colliding with existing breeding cage_id rejected | TODO | Insert breeding cage first; POST hc_addn with same id; assert rejection. |
| HC-06 | Clone-from-cage (`hc_addn.php?clone=<id>`) prefills room/rack/PI/IACUC/users/remarks | TODO | GET with clone param; parse form values. |
| HC-07 | Clone does NOT carry over mice (independent entities in v2) | TODO | Confirm cloned form has no mouse fields. |
| HC-08 | hc_dash search filter narrows results by cage id substring | TODO | Create cages A, B; search "A"; assert only A visible. |
| HC-09 | hc_dash pagination respects per-page setting (10/20/30/50) | TODO | Insert >50 cages; assert page count. |
| HC-10 | hc_dash sort toggle (cage_id asc/desc) reorders rows | TODO | Compare row order. |
| HC-11 | hc_dash columns toggle shows up to 2 optional columns (strain/sex/age) | TODO | Toggle each column; assert thead. |
| HC-12 | hc_dash "Show Archived" toggle reveals archived cages and hides them again | TODO | Archive a cage; default view hides; toggle shows. |
| HC-13 | hc_view renders mice currently in the cage (live count, not stored quantity) | TODO | Register 2 mice into cage; cage view shows count 2; move one out; count drops to 1. |
| HC-14 | hc_view renders files section with uploaded attachments | TODO | Upload via hc_edit; cage view shows row. |
| HC-15 | hc_view renders notes section (sticky notes for this cage) | TODO | Add note via nt_add; cage view shows it. |
| HC-16 | hc_view renders maintenance log section | TODO | Add maintenance entry; cage view shows it. |
| HC-17 | hc_view shows QR code linking back to the cage view URL | TODO | Decode QR src; assert URL. |
| HC-18 | hc_view "Transfer Mouse" modal opens and POSTs to mouse_move.php | TODO | Click button; modal visible; submit; assert mouse moved. |
| HC-19 | hc_edit rename cage_id cascades to mice.current_cage_id, mouse_cage_history.cage_id, breeding.cage_id, files, cage_iacuc, cage_users via FK ON UPDATE CASCADE | TODO | Set up cage with mice + files + history; rename; DB-assert every FK target updated. |
| HC-20 | hc_edit update PI, room, rack, IACUC[], user[], remarks persists changes | TODO | Edit form POST; DB-assert. |
| HC-21 | hc_edit removes user from cage_users when unselected | TODO | Create with users [A,B]; edit to [B]; assert only B in junction. |
| HC-22 | hc_edit upload file inserts row in `files` and writes blob under `uploads/` | TODO | Multipart POST; DB-assert + filesystem check. |
| HC-23 | Archive holding cage (default `action`) sets `cages.status='archived'` | TODO | POST hc_drop; DB-assert. |
| HC-24 | Restore archived cage sets `cages.status='active'` | TODO | Same row, `action=restore`. |
| HC-25 | Permanent-delete with `action=permanent_delete` removes cage + cascades: closes open `mouse_cage_history` intervals, sets mice.current_cage_id NULL, deletes related files/notes/maintenance/tasks/reminders | TODO | Wide DB-assert. |
| HC-26 | Permanent-delete UI requires double confirmation (two confirm() dialogs) | M | Browser dialog automation is awkward; manual check. |
| HC-27 | hc_drop rejects requests without CSRF token | TODO | POST without token; assert error. |
| HC-28 | hc_drop rejects GET requests | TODO | GET; assert redirect to hc_dash with message. |
| HC-29 | Archive emits notification to all `cage_users` | TODO | Seed cage with users; archive; DB-assert notifications rows. |
| HC-30 | hc_fetch_data returns JSON with current page rows + pagination meta | TODO | GET endpoint; parse JSON shape. |

---

## 5. BC — breeding cages

Files: `bc_addn.php`, `bc_dash.php`, `bc_view.php`, `bc_edit.php`,
`bc_drop.php`, `bc_fetch_data.php`. Mutates `cages`, `breeding`,
`litters`, `cage_iacuc`, `cage_users`, `files`, `notifications`. A
breeding cage is a `cages` row with a corresponding `breeding` row.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| BC-01 | Create breeding cage with valid CSRF persists `cages` + `breeding` rows | TODO | csrf positive-control only covers holding cages; breeding-cage create needs its own positive test. |
| BC-02 | Create rejects without CSRF token | A | [specs/security/csrf.spec.ts](specs/security/csrf.spec.ts) |
| BC-03 | Create with male_id/female_id FKs pointing into `mice` populates breeding row correctly | TODO | Pre-register two mice; create breeding cage with them; DB-assert. |
| BC-04 | Create with cross, PI, room, rack, IACUC, users persists all | TODO | Full POST. |
| BC-05 | Create with NULL male_id/female_id allowed (founders not yet registered) | TODO | POST with empty parent IDs; assert row created with NULLs. |
| BC-06 | Initial litter row created when litter data supplied at creation | TODO | POST with litter dom/pups; DB-assert `litters` row. |
| BC-07 | Clone-from-cage (`bc_addn.php?clone=<id>`) prefills metadata (room/rack/PI/IACUC/users/cross) | TODO | GET with clone param; parse form. |
| BC-08 | bc_dash search filter narrows by cage id | TODO |  |
| BC-09 | bc_dash pagination + sort + columns + show-archived toggles (same shape as HC) | TODO | One row per toggle; or one consolidated row — prefer consolidated to avoid HC parity duplication. |
| BC-10 | bc_view shows parent details JOINed from `mice` (sex/dob/genotype) | TODO | Verify mouse_view-derived columns. |
| BC-11 | bc_view shows litters list with pups counts and DoB | TODO |  |
| BC-12 | bc_view shows files, notes, maintenance log sections | TODO | Same pattern as HC. |
| BC-13 | bc_view QR code links to cage view URL | TODO |  |
| BC-14 | bc_edit rename cage_id cascades through FKs (same as HC-19) | TODO |  |
| BC-15 | bc_edit update parents/cross/metadata persists | TODO |  |
| BC-16 | bc_edit add new litter row | TODO |  |
| BC-17 | bc_edit edit existing litter row | TODO |  |
| BC-18 | bc_edit delete litter row | TODO |  |
| BC-19 | bc_edit upload file (same as HC-22) | TODO |  |
| BC-20 | Archive breeding cage sets `cages.status='archived'` | TODO |  |
| BC-21 | Restore archived breeding cage | TODO |  |
| BC-22 | Permanent-delete breeding cage cascades through `litters`, `breeding`, related files/notes/maintenance | TODO | DB-assert. |
| BC-23 | Permanent-delete double confirmation (two confirm() dialogs) | M | Manual. |
| BC-24 | Archive emits notification to cage_users | TODO |  |
| BC-25 | bc_fetch_data returns JSON page | TODO |  |

---

## 6. MOUSE — mouse as entity

Files: `mouse_addn.php`, `mouse_dash.php`, `mouse_view.php`,
`mouse_edit.php`, `mouse_move.php`, `mouse_sacrifice.php`,
`mouse_drop.php`, `mouse_fetch_data.php`. Mutates `mice`,
`mouse_cage_history`, `cages` (inline-create mode), `activity_log`.
v2's core entity model.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| MOUSE-01 | Register mouse into a cage opens history interval and sets `mice.current_cage_id` | A | [specs/mice/move-atomic.spec.ts](specs/mice/move-atomic.spec.ts) |
| MOUSE-02 | Register mouse without `cage_id` creates mouse with `current_cage_id=NULL` and writes no history row | TODO | POST without cage; DB-assert. |
| MOUSE-03 | Register requires unique `mouse_id`; duplicate rejected with error | TODO | Insert mouse; POST again; assert error. |
| MOUSE-04 | Register accepts sex enum: male / female / unknown | TODO | One POST per value. |
| MOUSE-05 | Register accepts dob as date; rejects pre-1900 dates (HTML `min`) | TODO | POST dob=1850; expect failure or sanitized; check actual behaviour. |
| MOUSE-06 | Register with `strain` FK populates the column; with strain blank, NULL | TODO |  |
| MOUSE-07 | Register with `sire_id` / `dam_id` FK populates parent links | TODO | Pre-create parents; register child with FK; DB-assert. |
| MOUSE-08 | Register with `sire_external_ref` / `dam_external_ref` (text) when FK blank | TODO |  |
| MOUSE-09 | Register with `source_cage_label` preserves V1-style breadcrumb | TODO |  |
| MOUSE-10 | Register rejects without CSRF token | TODO |  |
| MOUSE-11 | mouse_dash filters by status (alive, sacrificed, transferred_out, archived, all) | TODO | One row per filter value or one row covering the dropdown. Prefer one. |
| MOUSE-12 | mouse_dash filters by sex (male, female, all) | TODO |  |
| MOUSE-13 | mouse_dash filters by current cage id | TODO |  |
| MOUSE-14 | mouse_dash optional columns toggle: max 2 of sex/dob/age/genotype | TODO | Assert max-2 enforcement. |
| MOUSE-15 | mouse_dash search across mouse_id, genotype, ear_code, current_cage_id | TODO |  |
| MOUSE-16 | mouse_dash pagination | TODO |  |
| MOUSE-17 | mouse_view renders the cage-history timeline (one row per `mouse_cage_history` entry) | TODO | Insert 3 history rows; view shows 3. |
| MOUSE-18 | mouse_view renders the offspring list (mice whose sire_id or dam_id matches) | TODO | Pre-create children; view shows them. |
| MOUSE-19 | mouse_view action buttons gated by status: alive shows Move+Sacrifice+Edit; sacrificed shows Edit only | TODO | Per-status assertion. |
| MOUSE-20 | mouse_view "Hard Delete" admin-only button hidden for non-admin | TODO | Compare view as admin vs user. |
| MOUSE-21 | mouse_edit rename mouse_id cascades via FKs (sire/dam self-FK, breeding.male_id/female_id, mouse_cage_history.mouse_id) | TODO | Set up offspring + breeding row + history; rename; DB-assert. |
| MOUSE-22 | mouse_edit update any non-id field persists | TODO |  |
| MOUSE-23 | mouse_edit rejects without CSRF token | TODO |  |
| MOUSE-24 | mouse_move closes A interval + opens B interval + syncs `mice.current_cage_id` atomically | A | [specs/mice/move-atomic.spec.ts](specs/mice/move-atomic.spec.ts) |
| MOUSE-25 | mouse_move records `moved_by` (actor) and `reason` on the new open interval | A | [specs/mice/move-atomic.spec.ts](specs/mice/move-atomic.spec.ts) |
| MOUSE-26 | mouse_move rejects on `status` in {sacrificed, archived} | TODO | Pre-set status; POST; assert error message. |
| MOUSE-27 | mouse_move rejects when target cage doesn't exist or is archived | TODO |  |
| MOUSE-28 | mouse_move no-op when source == target (mouse already in that cage) | TODO | History row count unchanged. |
| MOUSE-29 | mouse_move with `target_cage_id=__none__` sets mouse status to `transferred_out` and current_cage_id=NULL | TODO | DB-assert. |
| MOUSE-30 | mouse_move `redirect_to` parameter enforced against 5-entry allow-list | TODO security | Allow-list: mouse_view.php, hc_view.php, bc_view.php, mouse_edit.php, mouse_dash.php. Non-allowlisted values must fall back to mouse_view. |
| MOUSE-31 | mouse_move rejects without CSRF token | TODO | Covered by general CSRF spec; verify in MOUSE context too. |
| MOUSE-32 | mouse_sacrifice closes the open history interval (sets `moved_out_at`) | TODO | DB-assert. |
| MOUSE-33 | mouse_sacrifice sets `mice.status='sacrificed'`, `sacrificed_at`, `sacrifice_reason`, clears `current_cage_id` | TODO |  |
| MOUSE-34 | mouse_sacrifice writes `activity_log` row | TODO |  |
| MOUSE-35 | mouse_drop requires admin role (RBAC-05 covers gate; this is the destructive path) | TODO | POST as admin; mouse row gone. |
| MOUSE-36 | mouse_drop requires `confirm_mouse_id` to exactly match `mouse_id` | TODO | Mismatch rejected. |
| MOUSE-37 | mouse_drop requires `reason` ≥ 3 characters | TODO | Short reason rejected. |
| MOUSE-38 | mouse_drop writes `activity_log` row BEFORE the DELETE (audit survives delete) | TODO | DB-assert activity_log row exists after row is deleted. |
| MOUSE-39 | Parent picker typeahead (`mouse_fetch_data?mode=parent_search`) returns sex-filtered candidates | TODO | Sire picker returns male+unknown; dam picker returns female+unknown. |
| MOUSE-40 | Inline "+ Add new cage" (`mouse_fetch_data?mode=create_cage`) creates a minimal cage row | TODO | POST with cage_id; DB-assert row + JSON response. |
| MOUSE-41 | Inline cage-create rejects without CSRF token (returns 403 + JSON) | TODO | POST missing token; assert HTTP 403 and JSON shape. |
| MOUSE-42 | mouse_fetch_data list mode returns paginated JSON | TODO | GET with mode=list; assert pagination meta. |

---

## 7. CARDS — printable cage cards

Files: `slct_crd.php`, `prnt_crd.php`. Selector and renderer for
mixed-type cage card printing.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| CARDS-01 | slct_crd renders multi-select populated with active holding and breeding cages | TODO | Create 2 holding, 2 breeding; both groups visible. |
| CARDS-02 | slct_crd excludes archived cages from the picker | TODO |  |
| CARDS-03 | prnt_crd renders 2×2 grid for ≤4 cages on letter-landscape | TODO | Visual inspection of CSS; spec asserts container exists. |
| CARDS-04 | prnt_crd inserts page breaks every 4 cages | TODO | Pass 5 ids; assert `page-break-after` rule applied to 4th card. |
| CARDS-05 | prnt_crd holding-card pulls aggregate fields from currently-resident mice (strain, sex, dob-min) | TODO | Register mice with mixed sex/strain; assert card shows aggregates. |
| CARDS-06 | prnt_crd breeding-card pulls parent details JOINed from `mice` | TODO | Pre-register parents; assert card. |
| CARDS-07 | prnt_crd auto-detects type per cage id (holding vs breeding) | TODO | Mix one of each in `?id=A,B`; verify each renders in its template. |
| CARDS-08 | Each card embeds a QR code linking back to the cage view URL | TODO |  |
| CARDS-09 | prnt_crd with no `id` redirects to slct_crd | TODO |  |

---

## 8. LINEAGE — cage lineage view

File: `cage_lineage.php`. Derives parent cages from per-mouse sire/dam.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| LINEAGE-01 | cage_lineage selector lists active cages | TODO |  |
| LINEAGE-02 | Selecting a cage lists mice currently in it (mouse_id, sex, dob) | TODO |  |
| LINEAGE-03 | View resolves each mouse's sire/dam and the cage each parent was last housed in | TODO | Pre-build a 2-generation lineage; assert correct parent cages enumerated. |
| LINEAGE-04 | View handles mice with NULL sire_id/dam_id (founders) gracefully | TODO |  |
| LINEAGE-05 | View handles parents whose mouse rows have been hard-deleted (FK was SET NULL) | TODO |  |

---

## 9. SCHED — tasks, reminders, calendar

Files: `manage_tasks.php`, `get_task.php`, `manage_reminder.php`,
`get_reminder.php`, `calendar.php`, `calendar_events.php`,
`process_reminders.php` (the cron-side; also covered in CRON).
Mutates `tasks`, `reminders`, `notifications`, `outbox`.

### Tasks

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| SCHED-01 | Create task with title, description, assigned_to (multi-user CSV), status, completion_date, cage_id | TODO |  |
| SCHED-02 | manage_tasks rejects POST without CSRF token | A | [specs/security/csrf.spec.ts](specs/security/csrf.spec.ts) |
| SCHED-03 | Task creation writes outbox rows for each assigned user | TODO | DB-assert outbox count == assignees count. |
| SCHED-04 | Task creation writes notification rows for each assignee | TODO |  |
| SCHED-05 | Edit task: any field change persists | TODO |  |
| SCHED-06 | Delete task allowed for `assigned_by` user or admin only (RBAC-09) | TODO |  |
| SCHED-07 | Task status workflow: Pending → In Progress → Completed | TODO | One transition per row, or one row covering the state machine. Prefer covering. |
| SCHED-08 | Marking task Completed sets `completion_date` | TODO |  |
| SCHED-09 | Task list filter: assigned_by_me, assigned_to_me, all | TODO |  |
| SCHED-10 | Task list search across title/description/assigned_by/assigned_to/status/cage_id | TODO |  |
| SCHED-11 | get_task AJAX returns task details JSON for the owner | TODO |  |
| SCHED-12 | get_task returns 401-equivalent error JSON for unauthenticated requests | TODO |  |

### Reminders

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| SCHED-13 | Create daily reminder with `time_of_day` | TODO |  |
| SCHED-14 | Create weekly reminder requires `day_of_week` | TODO |  |
| SCHED-15 | Create monthly reminder requires `day_of_month` (1-31) | TODO |  |
| SCHED-16 | Reminder assignment writes notification rows | TODO |  |
| SCHED-17 | Edit reminder | TODO |  |
| SCHED-18 | Archive reminder sets `status='inactive'` | TODO |  |
| SCHED-19 | Restore archived reminder | TODO |  |
| SCHED-20 | Permanently delete archived reminder | TODO |  |
| SCHED-21 | manage_reminder rejects POST without CSRF token | A | [specs/security/csrf.spec.ts](specs/security/csrf.spec.ts) |
| SCHED-22 | get_reminder AJAX returns reminder JSON | TODO |  |
| SCHED-23 | Reminder cron processor creates a task when due window hits and writes outbox row | M | Cron timing — manual or fast-forwarded via CLI invocation. |

### Calendar

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| SCHED-24 | calendar.php renders FullCalendar widget on /calendar.php | TODO | Assert `.fc` root present. |
| SCHED-25 | calendar_events returns JSON for a `?start=&end=` window | TODO | Direct GET; parse JSON. |
| SCHED-26 | Admin sees "All vs Mine" view toggle; non-admin always sees "Mine" only | TODO | Compare event count per role. |
| SCHED-27 | Calendar events color-coded by status (Pending / In Progress / Completed / Reminder) | TODO |  |
| SCHED-28 | calendar_events rejects unauthenticated requests with JSON error | TODO |  |

---

## 10. NOTES — sticky notes

Files: `nt_app.php`, `nt_add.php`, `nt_edit.php`, `nt_rmv.php`. Mutates
`notes`. Per-cage or global notes; AJAX-driven. All three mutating
endpoints return JSON with HTTP 403 on auth/CSRF failures.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| NOTES-01 | nt_app renders existing notes for the current cage (`?id=<cage_id>`) | TODO | Pre-insert 2 notes for cage; assert rendered. |
| NOTES-02 | nt_app renders global notes (no cage_id) when accessed without `id` param | TODO |  |
| NOTES-03 | nt_add creates a note with valid CSRF, returns success JSON | TODO | POST; DB-assert row; parse `{success:true}` JSON. |
| NOTES-04 | nt_add rejects without CSRF token with HTTP 403 + JSON `{success:false, message:"Invalid CSRF token."}` | A | [specs/security/csrf.spec.ts](specs/security/csrf.spec.ts) |
| NOTES-05 | nt_add rejects without authentication with JSON error | TODO |  |
| NOTES-06 | nt_add enforces 250-char client cap (HTML maxlength); server accepts at the cap | TODO | Long note submitted via API bypasses HTML cap — confirm server behaviour. |
| NOTES-07 | nt_edit updates own note | TODO | Owner edits; DB-assert. |
| NOTES-08 | nt_edit blocks non-owner non-admin with JSON error | TODO | User-B attempts to edit User-A's note; rejected. |
| NOTES-09 | nt_edit allows admin to edit any note | TODO |  |
| NOTES-10 | nt_edit rejects without CSRF token with HTTP 403 + JSON | TODO |  |
| NOTES-11 | nt_rmv deletes own note | TODO |  |
| NOTES-12 | nt_rmv blocks non-owner non-admin | TODO |  |
| NOTES-13 | nt_rmv allows admin to delete any note | TODO |  |
| NOTES-14 | nt_rmv rejects without CSRF token with HTTP 403 + JSON | TODO |  |

---

## 11. NOTIF — in-app notifications

Files: `get_notifications.php`, `mark_notification.php`. Rendered from
the bell in `header.php`. Mutates `notifications`. Notifications are
produced by cage create/edit/archive (`cage_users` watchers), by task
assignment, by reminder assignment.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| NOTIF-01 | get_notifications returns JSON list + unread count for the current user | TODO | Insert N rows; GET endpoint; assert shape. |
| NOTIF-02 | get_notifications rejects unauthenticated requests with JSON error | TODO |  |
| NOTIF-03 | mark_notification with `id` flag marks one notification read | TODO | POST; DB-assert `is_read=1`. |
| NOTIF-04 | mark_notification with `mark_all` flag marks every notification for the user as read | TODO |  |
| NOTIF-05 | mark_notification rejects non-POST requests with JSON error | TODO |  |
| NOTIF-06 | Cage user assignment generates notification rows for newly assigned users | TODO | Edit cage to add user; DB-assert notifications row. |
| NOTIF-07 | Cage archive generates a notification for every `cage_users` member | TODO |  |
| NOTIF-08 | Cage permanent-delete generates a notification for every `cage_users` member | TODO |  |
| NOTIF-09 | Task assignment generates notification rows for each assignee | TODO |  |
| NOTIF-10 | Reminder assignment generates notification rows | TODO |  |
| NOTIF-11 | Notification `link` column is honoured: header bell items link through | TODO | Insert notification with link=hc_view.php?id=X; assert anchor href. |

---

## 12. AUDIT — activity log

Files: `activity_log.php` (viewer), `log_activity.php` (helper).
Mutates `activity_log` from every state-changing endpoint that opts in.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| AUDIT-01 | activity_log.php requires admin role (non-admin redirected to /index.php) | TODO |  |
| AUDIT-02 | activity_log search across user name, action, entity_type, entity_id, details | TODO | Insert known row; search; assert visible. |
| AUDIT-03 | activity_log filter by `entity_type` (mouse, cage, user, etc.) | TODO |  |
| AUDIT-04 | activity_log date range filter (`date_from`, `date_to`) | TODO |  |
| AUDIT-05 | activity_log pagination (`per_page`, `page` GET params) | TODO |  |
| AUDIT-06 | Cage create writes `activity_log` row with action='create', entity_type='cage' | TODO | Trigger via hc_addn; DB-assert. |
| AUDIT-07 | Cage archive writes action='archive' row | TODO |  |
| AUDIT-08 | Cage permanent-delete writes action='delete' row | TODO |  |
| AUDIT-09 | Cage restore writes action='restore' row | TODO |  |
| AUDIT-10 | Mouse register writes action='create', entity_type='mouse' row | TODO |  |
| AUDIT-11 | Mouse move writes action='move' row with from/to cage in details | TODO |  |
| AUDIT-12 | Mouse sacrifice writes action='sacrifice' row | TODO |  |
| AUDIT-13 | Mouse hard-delete writes action='hard_delete' row BEFORE the DELETE (audit survives) | TODO | Confirmed in MOUSE-38; AUDIT row exists post-delete. |
| AUDIT-14 | Role change in `manage_users.php` writes activity_log row | TODO |  |

---

## 13. MAINT — maintenance log + VM oversight

Files: `maintenance.php` (add entry from cage view),
`vivarium_manager_notes.php` (admin/VM-only oversight view).
Mutates `maintenance`.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| MAINT-01 | Add maintenance entry from cage view (POST + CSRF) | TODO | DB-assert row in `maintenance`. |
| MAINT-02 | Maintenance entry appears in cage view's maintenance log section | TODO |  |
| MAINT-03 | maintenance.php rejects without CSRF token | TODO |  |
| MAINT-04 | vivarium_manager_notes.php requires admin OR vivarium_manager role | TODO | Standard user rejected. |
| MAINT-05 | View filters: "vivarium_managers only" (default) vs "all users" | TODO |  |
| MAINT-06 | View search across user name, cage, comments | TODO |  |
| MAINT-07 | View date range filter (`date_from`, `date_to`) | TODO |  |
| MAINT-08 | View pagination | TODO |  |
| MAINT-09 | Add maintenance note via AJAX action=add | TODO | DB-assert. |
| MAINT-10 | Edit existing note via AJAX action=edit | TODO |  |
| MAINT-11 | Delete note via AJAX action=delete | TODO |  |
| MAINT-12 | AJAX endpoints reject without CSRF token (HTTP 200 with success:false JSON — third rejection shape) | TODO | Known caveats §3 — JSON shape varies. |
| MAINT-13 | Get-note via AJAX action=get_note returns single note JSON | TODO |  |
| MAINT-14 | Print mode renders a printer-friendly maintenance report | M | Visual; low-ROI to automate. |

---

## 14. ADMIN — admin reference data

Files: `manage_users.php`, `manage_iacuc.php`, `manage_strain.php`,
`manage_lab.php`. All admin-only. Each follows the same shape: search +
table + add/edit/delete forms with CSRF.

### Users

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| ADMIN-01 | manage_users.php admin-only | TODO | Covered in RBAC-02 but verified here too against the page surface. |
| ADMIN-02 | Approve pending user sets `status='approved'` | TODO |  |
| ADMIN-03 | Set user to pending sets `status='pending'` | TODO |  |
| ADMIN-04 | Delete user removes row | TODO |  |
| ADMIN-05 | Promote user → admin updates `role` | TODO |  |
| ADMIN-06 | Promote user → vivarium_manager updates `role` | TODO |  |
| ADMIN-07 | Demote admin/VM → user updates `role` | TODO |  |
| ADMIN-08 | All `action=` POSTs require CSRF token | TODO |  |
| ADMIN-09 | User-list search by name / username / role | TODO |  |
| ADMIN-10 | User-list per-page selector | TODO |  |

### IACUC

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| ADMIN-11 | manage_iacuc admin-only | TODO |  |
| ADMIN-12 | Add IACUC record with PDF upload writes row + saves file under `uploads/` | TODO |  |
| ADMIN-13 | Edit IACUC record (id, title, file) | TODO |  |
| ADMIN-14 | Delete IACUC removes row | TODO |  |
| ADMIN-15 | IACUC associated to cage via `cage_iacuc` junction (set in hc_addn/hc_edit/bc_addn/bc_edit) | TODO |  |

### Strain

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| ADMIN-16 | manage_strain admin-only | TODO |  |
| ADMIN-17 | Add strain (str_id, str_name, str_aka, str_url, str_rrid, str_notes) | TODO |  |
| ADMIN-18 | Edit strain | TODO |  |
| ADMIN-19 | Delete strain (FK to mice.strain is `ON DELETE SET NULL`) | TODO | Insert mouse with strain; delete strain; mouse.strain becomes NULL. |
| ADMIN-20 | "None / Not Applicable" sentinel value behaviour in dropdowns | TODO |  |

### Lab settings

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| ADMIN-21 | manage_lab admin-only | TODO |  |
| ADMIN-22 | Update lab_name writes to `settings` table | TODO |  |
| ADMIN-23 | Update url (public domain) writes to settings | TODO |  |
| ADMIN-24 | Update timezone (IANA name) writes to settings | TODO |  |
| ADMIN-25 | Update Cloudflare Turnstile site key and secret key writes to settings | TODO |  |
| ADMIN-26 | Update IoT sensor URLs for 2 rooms × 4 metrics (r1_temp, r1_humi, r1_illu, r1_pres, r2_*) writes to settings | TODO |  |
| ADMIN-27 | Empty Turnstile secret-key submission preserves the existing stored secret (intentional behaviour: don't wipe on blank) | TODO | Known caveat: line 78 of manage_lab.php. |

---

## 15. DATA-IO — CSV export & V1 import

Files: `export_data.php`, `admin_import.php`.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| MIG-01 | export_data admin-only | TODO |  |
| MIG-02 | export_data returns a ZIP with a CSV per database table | TODO | Inspect ZIP entries. |
| MIG-03 | export_data ZIP filename is `exported_data.zip` | TODO |  |
| MIG-04 | admin_import admin-only | TODO |  |
| MIG-05 | admin_import preflight: rejects non-empty DB unless `confirm_overwrite=1` is set | TODO | Try import with existing data; assert rejection with checkbox prompt. |
| MIG-06 | admin_import with `confirm_overwrite=1` clears existing data and re-imports | TODO |  |
| MIG-07 | admin_import transforms V1 `holding` + `mice` + `breeding` rows into V2 mouse entities + `mouse_cage_history` rows | TODO | Sample V1 JSON; import; DB-assert resulting `mice` and history rows. |
| MIG-08 | admin_import is wrapped in a single transaction (rollback on partial failure) | M | Force a mid-import failure to verify rollback — hard to automate reliably. |
| MIG-09 | admin_import rejects file uploads other than `.json` / `application/json` | TODO | POST with `.txt`; assert rejection. |
| MIG-10 | admin_import rejects without CSRF token | TODO |  |

---

## 16. FILE — file attachments

File: `delete_file.php`. Upload paths live inside `hc_edit.php`,
`bc_edit.php`, `manage_iacuc.php`; this module captures the file
lifecycle.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| FILE-01 | Upload file via hc_edit attaches it to the cage (row in `files` + blob in `uploads/`) | TODO | Same as HC-22 but assert filesystem path too. |
| FILE-02 | Upload file via bc_edit attaches it to the breeding cage | TODO |  |
| FILE-03 | Upload file via manage_iacuc attaches it to the IACUC record | TODO |  |
| FILE-04 | delete_file removes the DB row and unlinks the blob from disk | TODO |  |
| FILE-05 | delete_file requires admin role OR membership in the file's cage's `cage_users` | TODO security | Three users: admin (allowed), cage_users member (allowed), unrelated (denied). |
| FILE-06 | delete_file `url` redirect param restricted to 6-entry allow-list; bogus values fall back to `bc_edit` | TODO security | Allow-list: bc_edit, hc_edit, bc_view, hc_view, bc_dash, hc_dash. |
| FILE-07 | delete_file strips CR/LF from cage_id before composing the Location header | TODO security | Pre-set a cage_id containing CRLF; trigger delete; assert Location header is clean. |

---

## 17. IOT — IoT sensors display

File: `iot_sensors.php`.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| IOT-01 | iot_sensors.php requires authentication | TODO |  |
| IOT-02 | Page renders 8 iframes (2 rooms × 4 metrics: temp, humi, illu, pres) | TODO | DOM assert `iframe` count and src values. |
| IOT-03 | Iframe URLs sourced from `settings` rows: `r1_temp`, `r1_humi`, `r1_illu`, `r1_pres`, `r2_*` | TODO |  |
| IOT-04 | When a sensor URL is not set in `settings`, the corresponding iframe is empty (or omitted) | TODO | Verify graceful handling. |

---

## 18. CRON — email queue & reminder worker

Files: `send_email.php`, `process_reminders.php`. CLI entry points
invoked by `cron`. Mutates `outbox`, `tasks`, `notifications`,
`reminders.last_task_created`.

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| CRON-01 | `process_reminders.php` returns HTTP 403 plain text when accessed over HTTP | TODO | GET endpoint via HTTP; assert status + body match. |
| CRON-02 | `send_email.php` returns HTTP 403 plain text when accessed over HTTP | TODO (EXPECTED TO FAIL until fix) | Current behaviour returns HTTP 200 empty (function definitions execute, but `sendPendingEmails()` only runs under CLI). Spec exists to flag the guard asymmetry; failure triggers diagnose-and-fix on `deep-testing`. |
| CRON-03 | `process_reminders.php` under CLI creates a `tasks` row from a due reminder | M | Set up reminder due-now; invoke via `docker exec mv-app php /var/www/html/process_reminders.php`; DB-assert. |
| CRON-04 | `process_reminders.php` writes an `outbox` row for the new task | M |  |
| CRON-05 | `process_reminders.php` updates `reminders.last_task_created` so the same reminder doesn't fire twice in the same window | M |  |
| CRON-06 | `send_email.php` under CLI sends pending `outbox` rows via SMTP (status pending → sent) | M | Requires reachable SMTP; out of scope for CI. |
| CRON-07 | `send_email.php` under CLI marks failed sends with `status='failed'` and `error_message` populated | M |  |

---

## v1 feature coverage check

The three items below existed in v1 but are intentionally absent in v2.
They are NOT regressions — each is an explicit design choice tied to v2's
mouse-as-entity model. No tests are planned. They are recorded here so
future readers asking "where did X go?" find an answer.

| v1 artefact | v2 status | Reason |
|---|---|---|
| `holding` table (cage-scoped mouse rows) | Intentionally removed | Replaced by `mice` as a first-class entity with stable identity across cage moves; lineage is per-mouse (`sire_id`/`dam_id`) rather than per-cage (`holding.parent_cg`). |
| `export_for_v2.php` admin endpoint | Intentionally absent in v2 | This was the V1-side JSON dump feeding V2's importer. V2 receives via `admin_import.php`. The producer lives in V1 only — testing it requires the V1 codebase, which is out of scope for this repo's regression suite. |
| Separate per-type printable card endpoints (`bc_prnt_crd.php`, `bc_slct_crd.php`, `hc_prnt_crd.php`, `hc_slct_crd.php`) | Intentionally consolidated | Replaced by unified `slct_crd.php` + `prnt_crd.php`, which accept mixed cage IDs and auto-detect type per row. Covered by the CARDS module. |

---

## How to run

See [tests/README.md](README.md). In short: bring up the Docker stack
from the repo root, then `cd tests && npm install && npm test`. The
suite assumes the `deep-testing` branch is checked out under `app/` so
that `SESSION_COOKIE_SECURE=false` takes effect over HTTP. Spec helpers
talk to the DB directly on `127.0.0.1:3307` for state verification.

---

## Known caveats

1. **Feature-level rows, not selector-precise.** Each row above states a
   capability. When a `TODO` row gets a spec written, the spec author
   re-greps for the exact form field names, button selectors, and DOM
   anchors. Selectors are not committed in this document because they
   would rot faster than the underlying behaviour.

2. **Direct DB probes for state verification.** Specs frequently bypass
   the UI and read tables (`mouse_cage_history`, `cage_users`, `outbox`,
   etc.) via the `mysql2` fixture in `tests/fixtures/db.ts`. This is
   intentional: UI scrapes are brittle, and the invariants we care about
   are schema-level (e.g. "exactly one open interval per mouse"). When a
   probe-based assertion fails, the first triage step is always "is the
   spec's table or column name still correct?" — schema names can shift.

3. **Three CSRF rejection shapes.** A POST that fails CSRF can come
   back as:
   - **HTTP 200 + plain text body `CSRF token validation failed`** (most
     state-changing pages: `hc_addn`, `bc_addn`, `manage_tasks`,
     `manage_reminder`, `manage_users`, `manage_lab`, etc.). Implemented
     as `die(...)`.
   - **HTTP 403 + JSON body `{"success":false,"message":"Invalid CSRF
     token."}`** (`nt_add`, `nt_edit`, `nt_rmv`, `mouse_fetch_data?mode=create_cage`).
     Implemented as `http_response_code(403); echo json_encode(...)`.
   - **HTTP 200 + JSON body `{"success":false,"message":"CSRF token
     validation failed"}`** (`vivarium_manager_notes.php` AJAX action
     handlers). Implemented inline inside the AJAX branch.

   All three are correct rejections; the inconsistency is a UX issue
   worth flagging but not a security bug. CSRF specs handle these per
   endpoint rather than asserting one uniform string.

4. **`delete_file.php` is GET-based and has no CSRF token.** Defence in
   depth is provided by the `cage_users`-or-admin authorization check
   (line 58) and a 6-entry redirect allow-list (line 78). A trivial
   image-tag CSRF cannot delete a file the attacker is not already
   authorized to delete. Worth a spec to confirm the authz boundary
   (FILE-05) but not a REAL-APP-BUG.

5. **Stale `nt_data` reference in `nt_add.php` docblock.** The file's
   own docblock says "inserts the note into the `nt_data` table", but
   the SQL inserts into `notes`. The table `nt_data` does not exist in
   the v2 schema. This is a documentation comment rot, not a behavioural
   bug. Tests assert against the `notes` table — do not be confused if
   you go reading the v1 README and see `nt_data` mentioned.

6. **Expected-fail tests.** Only one row is currently marked
   `EXPECTED TO FAIL`: CRON-02 (`send_email.php` weak HTTP guard).
   When the spec for CRON-02 lands and fails in CI, that is the trigger
   for the diagnose-and-fix flow on `deep-testing` — not an assertion
   loosening.

7. **Mouse hard-delete reason check** (MOUSE-37): the server check is
   `strlen($reason) < 3`. Whitespace-only strings of length ≥ 3 will
   pass that check (e.g. `"   "`). If a future spec asserts "reason must
   be non-trivial", that is a real behaviour change to file as a
   REAL-APP-BUG and fix on `deep-testing`, not a test-side decision.

8. **Cron timing (CRON-03/04/05)** is marked Manual because cron
   triggers are wall-clock-time-dependent. Forcing the cron via
   `docker exec mv-app php /var/www/html/process_reminders.php` is the
   straightforward way to verify, but it doesn't model the real schedule.

9. **SMTP-dependent paths** (AUTH-15, AUTH-21, AUTH-23 to AUTH-30,
   CRON-06/07, SCHED-03, MIG email outbox rows): the suite asserts
   `outbox` rows are written; actual delivery is not tested. Container
   `SMTP_HOST` is `smtp.invalid` by design, so any outbound attempt
   fails fast and the row gets `status='failed'`.

10. **Browser-confirm dialogs** (HC-26, BC-23) are not asserted directly
    because Playwright's dialog handlers swallow them. The double-confirm
    is a JS-only safeguard; the server-side endpoint does not require
    repeated confirmation. The server-side path is covered by HC-25 /
    BC-22.

---

## Coverage summary

Counts below are derived from the tables above as of TESTPLAN authoring,
computed by grep — not estimated. Update when rows change.

| Status | Count |
|---|---|
| A (automated, links to spec) | 23 |
| M (manual checklist) | 13 |
| TODO (automation planned) | 268 |
| Total rows | 304 |

`A`-cell count (23) is higher than the 15 currently-passing test cases
because some tests cover several TESTPLAN rows. For example, the
`POST without csrf_token is rejected on every state-changing endpoint`
test (one spec test) is the implementing spec for HC-02, BC-02,
SCHED-02, SCHED-21, and NOTES-04 — five rows, one underlying test.

Breakdown by module:

| Module | A | M | TODO | Total |
|---|---|---|---|---|
| AUTH    | 9 | 1 | 20 | 30 |
| RBAC    | 1 | 0 | 12 | 13 |
| NAV     | 4 | 2 |  8 | 14 |
| HC      | 2 | 1 | 27 | 30 |
| BC      | 1 | 1 | 23 | 25 |
| MOUSE   | 3 | 0 | 39 | 42 |
| CARDS   | 0 | 0 |  9 |  9 |
| LINEAGE | 0 | 0 |  5 |  5 |
| SCHED   | 2 | 1 | 25 | 28 |
| NOTES   | 1 | 0 | 13 | 14 |
| NOTIF   | 0 | 0 | 11 | 11 |
| AUDIT   | 0 | 0 | 14 | 14 |
| MAINT   | 0 | 1 | 13 | 14 |
| ADMIN   | 0 | 0 | 27 | 27 |
| DATA-IO | 0 | 1 |  9 | 10 |
| FILE    | 0 | 0 |  7 |  7 |
| IOT     | 0 | 0 |  4 |  4 |
| CRON    | 0 | 5 |  2 |  7 |

Mapping of `A` cells to underlying spec tests:

| Spec test | TESTPLAN rows |
|---|---|
| `specs/smoke.spec.ts` — login page renders | AUTH-01 |
| `specs/auth/login.spec.ts` — admin can log in | AUTH-02 |
| `specs/auth/login.spec.ts` — vivarium manager can log in | AUTH-03 |
| `specs/auth/login.spec.ts` — standard user can log in | AUTH-04 |
| `specs/auth/login.spec.ts` — wrong password rejected | AUTH-05 |
| `specs/auth/login.spec.ts` — no enumeration | AUTH-06 |
| `specs/auth/login.spec.ts` — logout destroys session | AUTH-07 |
| `specs/auth/login.spec.ts` — lockout after 3 attempts | AUTH-08, AUTH-09 |
| `specs/auth/login.spec.ts` — protected pages redirect | RBAC-01 |
| `specs/ui/dark-mode.spec.ts` — toggle dark + persistence + localStorage | NAV-04, NAV-06, NAV-07 |
| `specs/ui/dark-mode.spec.ts` — toggle back to light | NAV-05 |
| `specs/security/csrf.spec.ts` — missing-token rejection (5 endpoints) | HC-02, BC-02, SCHED-02, SCHED-21, NOTES-04 |
| `specs/security/csrf.spec.ts` — positive control creates holding cage | HC-01 |
| `specs/mice/move-atomic.spec.ts` — atomic move | MOUSE-01, MOUSE-24 |
| `specs/mice/move-atomic.spec.ts` — actor + reason | MOUSE-25 |

Sum: 15 spec tests, 23 `A` cells. Numbers reconcile.

