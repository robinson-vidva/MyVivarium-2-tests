import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import bcryptjs from 'bcryptjs';
import { withDb } from './seed/db.js';
import type { RowDataPacket } from './seed/db.js';

const ADMIN_EMAIL = 'admin@myvivarium.online';
const ADMIN_PASSWORD = 'P@ssw0rd';
const BASE_URL = 'http://localhost:8080';

interface CliArgs {
  seed: number;
  quiet: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let seed = 42;
  let quiet = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') {
      const v = argv[i + 1];
      if (!v) {
        console.error('--seed requires a value');
        process.exit(2);
      }
      seed = parseInt(v, 10);
      if (Number.isNaN(seed)) {
        console.error('--seed must be an integer');
        process.exit(2);
      }
      i++;
    } else if (a === '--quiet') quiet = true;
    else if (a === '--force') force = true;
  }
  return { seed, quiet, force };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function fmtDate(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

interface StrainSeed {
  str_id: string;
  str_name: string;
  str_aka: string;
  str_url: string;
  str_rrid: string;
  str_notes: string;
}
interface UserSeed {
  email: string;
  name: string;
  position: string;
  initials: string;
  role: 'admin' | 'vivarium_manager' | 'user';
  password: string;
}
interface CageTemplate {
  cage_id: string;
  room: string;
  rack: string;
  remarks: string;
}
interface BreedingTemplate extends CageTemplate {
  cross: string;
}
interface LabSeed {
  lab_name: string;
  url: string;
  timezone: string;
}
interface NamesPool {
  mouseSuffixes: string[];
  earCodes: string[];
  genotypeFragments: string[];
  notePhrases: string[];
  maintenanceComments: string[];
  taskTitles: string[];
  taskDescriptions: string[];
  reminderTitles: string[];
  reminderDescriptions: string[];
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

class SeederError extends Error {
  constructor(public readonly step: string, public readonly cause: unknown) {
    super(`${step} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function makeLogger(quiet: boolean): {
  step: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  note: (msg: string) => void;
} {
  return {
    step: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const t0 = Date.now();
      if (!quiet) process.stdout.write(`  ${label}...`);
      try {
        const result = await fn();
        const dt = Date.now() - t0;
        if (!quiet) process.stdout.write(` ok (${(dt / 1000).toFixed(1)}s)\n`);
        return result;
      } catch (err) {
        if (!quiet) process.stdout.write(' FAILED\n');
        throw new SeederError(label, err);
      }
    },
    note: (msg: string): void => {
      if (!quiet) console.log(`    ${msg}`);
    },
  };
}

async function isAppReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/index.php`, { redirect: 'manual' });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

async function isDbFresh(): Promise<boolean> {
  return withDb(async (con) => {
    const [u] = await con.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS c FROM users',
    );
    const [c] = await con.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS c FROM cages',
    );
    const userCount = Number(u[0]?.c ?? 0);
    const cageCount = Number(c[0]?.c ?? 0);
    return userCount === 1 && cageCount === 0;
  });
}

async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`${question} [y/N] `);
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.once('data', (chunk) => {
      process.stdin.pause();
      const answer =
        chunk instanceof Buffer ? chunk.toString('utf8') : String(chunk);
      resolve(answer.trim().toLowerCase().startsWith('y'));
    });
  });
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/index.php');
  await page.fill('input[name="username"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/home\.php(\?|$)/),
    page.click('button[name="login"]'),
  ]);
}

async function getCsrfToken(page: Page): Promise<string> {
  await page.goto('/hc_addn.php');
  const token = await page
    .locator('input[name="csrf_token"]')
    .first()
    .inputValue();
  if (!token) throw new Error('CSRF token not found on /hc_addn.php');
  return token;
}

interface PostOk {
  ok: true;
  status: number;
  body: string;
}
interface PostErr {
  ok: false;
  status: number;
  body: string;
}
type PostResult = PostOk | PostErr;

async function csrfPost(
  page: Page,
  path: string,
  form: Record<string, string>,
): Promise<PostResult> {
  const res = await page.request.post(path, { form });
  const body = await res.text();
  if (res.status() >= 200 && res.status() < 400) {
    if (body.includes('CSRF token validation failed')) {
      return { ok: false, status: res.status(), body };
    }
    return { ok: true, status: res.status(), body };
  }
  return { ok: false, status: res.status(), body };
}

async function getAdminUserId(): Promise<number> {
  return withDb(async (con) => {
    const [rows] = await con.execute<RowDataPacket[]>(
      'SELECT id FROM users WHERE username = ? LIMIT 1',
      [ADMIN_EMAIL],
    );
    const id = Number(rows[0]?.id);
    if (!id) throw new Error(`Admin user ${ADMIN_EMAIL} not found`);
    return id;
  });
}

async function insertUsersDirect(
  users: UserSeed[],
): Promise<Record<string, number>> {
  const idByEmail: Record<string, number> = {};
  await withDb(async (con) => {
    for (const u of users) {
      const passwordHash = await bcryptjs.hash(u.password, 10);
      const [result] = await con.execute(
        `INSERT INTO users
           (name, username, position, role, password, status,
            login_attempts, email_verified, initials)
         VALUES (?, ?, ?, ?, ?, 'approved', 0, 1, ?)`,
        [u.name, u.email, u.position, u.role, passwordHash, u.initials],
      );
      const insertId = (result as { insertId: number }).insertId;
      idByEmail[u.email] = insertId;
    }
  });
  return idByEmail;
}

async function updateLabSettings(
  page: Page,
  lab: LabSeed,
  csrf: string,
): Promise<void> {
  await page.goto('/manage_lab.php');
  await page.fill('input[name="lab_name"]', lab.lab_name);
  await page.fill('input[name="url"]', lab.url);
  await page.fill('input[name="timezone"]', lab.timezone);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('button[name="update_lab"]'),
  ]);
  // Silence unused-variable lint; csrf carried in the form's hidden input.
  void csrf;
}

async function addStrainViaUi(page: Page, s: StrainSeed): Promise<void> {
  await page.goto('/manage_strain.php');
  await page.getByRole('button', { name: 'Add New Strain' }).click();
  await page.fill('#strain_id', s.str_id);
  await page.fill('#strain_name', s.str_name);
  await page.fill('#strain_aka', s.str_aka);
  await page.fill('#strain_url', s.str_url);
  await page.fill('#strain_rrid', s.str_rrid);
  await page.fill('#strain_notes', s.str_notes);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('button[name="add"]'),
  ]);
}

async function addIacucViaUi(
  page: Page,
  iacuc_id: string,
  title: string,
  pdfPath: string,
): Promise<void> {
  await page.goto('/manage_iacuc.php');
  await page.getByRole('button', { name: 'Add New IACUC' }).click();
  await page.fill('#iacuc_id', iacuc_id);
  await page.fill('#iacuc_title', title);
  await page.setInputFiles('#iacuc_file', pdfPath);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('button[name="add"]'),
  ]);
}

async function addHoldingCageViaUi(
  page: Page,
  cage: CageTemplate,
  piId: number,
  iacucIds: string[],
): Promise<void> {
  await page.goto('/hc_addn.php');
  await page.fill('input[name="cage_id"]', cage.cage_id);
  await page.selectOption('select[name="pi_name"]', String(piId));
  await page.fill('input[name="room"]', cage.room);
  await page.fill('input[name="rack"]', cage.rack);
  if (iacucIds.length > 0) {
    await page.selectOption('select[name="iacuc[]"]', iacucIds);
  }
  await page.fill('textarea[name="remarks"]', cage.remarks);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('button[type="submit"]'),
  ]);
}

interface MouseSeed {
  mouse_id: string;
  sex: 'male' | 'female';
  dob: string;
  cage_id: string;
  strain: string;
  genotype: string;
  ear_code: string;
  notes: string;
}

async function addMouseViaUi(page: Page, m: MouseSeed): Promise<void> {
  await page.goto('/mouse_addn.php');
  await page.fill('input[name="mouse_id"]', m.mouse_id);
  await page.selectOption('select[name="sex"]', m.sex);
  await page.fill('input[name="dob"]', m.dob);
  await page.selectOption('select[name="cage_id"]', m.cage_id);
  await page.selectOption('select[name="strain"]', m.strain);
  await page.fill('input[name="ear_code"]', m.ear_code);
  await page.fill('input[name="genotype"]', m.genotype);
  await page.fill('textarea[name="notes"]', m.notes);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('button[type="submit"]'),
  ]);
}

interface OffspringSeed extends MouseSeed {
  sire_id: string;
  dam_id: string;
}

async function addMouseViaPost(
  page: Page,
  m: OffspringSeed,
  csrf: string,
): Promise<void> {
  const result = await csrfPost(page, '/mouse_addn.php', {
    csrf_token: csrf,
    mouse_id: m.mouse_id,
    sex: m.sex,
    dob: m.dob,
    cage_id: m.cage_id,
    strain: m.strain,
    ear_code: m.ear_code,
    genotype: m.genotype,
    sire_id: m.sire_id,
    dam_id: m.dam_id,
    notes: m.notes,
  });
  if (!result.ok) {
    throw new Error(
      `mouse_addn POST for ${m.mouse_id} returned ${result.status}: ${result.body.slice(0, 200)}`,
    );
  }
}

async function moveMouseViaPost(
  page: Page,
  mouse_id: string,
  target_cage_id: string,
  reason: string,
  csrf: string,
): Promise<void> {
  const result = await csrfPost(page, '/mouse_move.php', {
    csrf_token: csrf,
    mouse_id,
    target_cage_id,
    reason,
  });
  if (!result.ok) {
    throw new Error(
      `mouse_move POST for ${mouse_id} returned ${result.status}: ${result.body.slice(0, 200)}`,
    );
  }
}

async function addBreedingCageViaPost(
  page: Page,
  b: BreedingTemplate,
  piId: number,
  iacucIds: string[],
  male_id: string,
  female_id: string,
  csrf: string,
): Promise<void> {
  const form: Record<string, string> = {
    csrf_token: csrf,
    cage_id: b.cage_id,
    pi_name: String(piId),
    room: b.room,
    rack: b.rack,
    cross: b.cross,
    male_id,
    female_id,
    remarks: b.remarks,
  };
  // Multi-valued fields: serialized via key[] form-encoded; Playwright form supports string only,
  // so we use multipart form encoding for arrays via separate keys.
  // Workaround: append iacuc[] entries to the form key.
  // Playwright's form helper accepts only string-valued entries; we replicate
  // PHP's bracket-array convention by sending iacuc%5B%5D entries via the
  // multipart fallback. For the seeder we only attach a single IACUC per
  // breeding cage, so we send iacuc[] as one entry.
  if (iacucIds.length > 0) {
    form['iacuc[]'] = iacucIds[0];
  }
  const result = await csrfPost(page, '/bc_addn.php', form);
  if (!result.ok) {
    throw new Error(
      `bc_addn POST for ${b.cage_id} returned ${result.status}: ${result.body.slice(0, 200)}`,
    );
  }
}

async function addStickyNoteViaPost(
  page: Page,
  cage_id: string,
  note_text: string,
  csrf: string,
): Promise<void> {
  const result = await csrfPost(page, '/nt_add.php', {
    csrf_token: csrf,
    cage_id,
    note_text,
  });
  if (!result.ok) {
    throw new Error(
      `nt_add POST for ${cage_id} returned ${result.status}: ${result.body.slice(0, 200)}`,
    );
  }
  // nt_add returns JSON; double-check for success: false.
  if (result.body.includes('"success":false')) {
    throw new Error(`nt_add returned success:false for ${cage_id}: ${result.body}`);
  }
}

async function addMaintenanceViaUi(
  page: Page,
  cage_id: string,
  comment: string,
): Promise<void> {
  await page.goto('/maintenance.php');
  await page.selectOption('select[name="cage_id[]"]', cage_id);
  // The maintenance form clones a comment textarea per selected cage via JS.
  // For a single cage selection, target the first comments[] textarea.
  await page.fill('textarea[name="comments[]"]', comment);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('button[type="submit"]'),
  ]);
}

interface TaskSeed {
  title: string;
  description: string;
  assignedToIds: number[];
  status: 'Pending' | 'In Progress' | 'Completed';
  completion_date: string;
}

async function addTaskViaUi(
  page: Page,
  t: TaskSeed,
  adminId: number,
): Promise<void> {
  await page.goto('/manage_tasks.php');
  // Open the modal by clicking the add button, then fill inside.
  await page.click('#addNewTaskButton');
  await page.fill('input[name="title"]', t.title);
  await page.fill('textarea[name="description"]', t.description);
  // assigned_by_id is hidden; set via DOM evaluate since it's pre-populated server-side.
  await page.evaluate((id) => {
    const el = document.getElementById('assigned_by_id') as HTMLInputElement | null;
    if (el) el.value = String(id);
  }, adminId);
  await page.selectOption(
    'select[name="assigned_to[]"]',
    t.assignedToIds.map(String),
  );
  await page.click(`input[name="status"][value="${t.status}"]`);
  await page.fill('input[name="completion_date"]', t.completion_date);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('button[name="add"]'),
  ]);
}

interface ReminderSeed {
  title: string;
  description: string;
  assignedToIds: number[];
  recurrence: 'daily' | 'weekly' | 'monthly';
  day_of_week: '' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';
  day_of_month: string;
  time_of_day: string;
}

async function addReminderViaUi(page: Page, r: ReminderSeed): Promise<void> {
  await page.goto('/manage_reminder.php');
  await page.click('#addNewReminderButton');
  await page.fill('input[name="title"]', r.title);
  await page.fill('textarea[name="description"]', r.description);
  await page.selectOption(
    'select[name="assigned_to[]"]',
    r.assignedToIds.map(String),
  );
  await page.selectOption('select[name="recurrence_type"]', r.recurrence);
  if (r.recurrence === 'weekly') {
    await page.selectOption('select[name="day_of_week"]', r.day_of_week);
  } else if (r.recurrence === 'monthly') {
    await page.fill('input[name="day_of_month"]', r.day_of_month);
  }
  await page.fill('input[name="time_of_day"]', r.time_of_day);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('button[name="add"]'),
  ]);
}

interface Counts {
  labs: number;
  strains: number;
  iacuc: number;
  users: number;
  holding_cages: number;
  mouse_moves: number;
  breeding_cages: number;
  sticky_notes: number;
  maintenance: number;
  tasks: number;
  reminders: number;
  mice: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rng = mulberry32(args.seed);
  const log = makeLogger(args.quiet);
  const t0 = Date.now();
  const here = process.cwd();
  const dataDir = resolve(here, 'scripts', 'seed', 'data');
  const pdfPath = resolve(dataDir, 'sample.pdf');

  console.log(`Seeding with seed=${args.seed}`);

  if (!(await isAppReachable())) {
    console.error(
      `App not reachable at ${BASE_URL}/index.php. Run: docker compose up -d`,
    );
    process.exit(1);
  }

  const fresh = await isDbFresh();
  if (!fresh && !args.force) {
    if (process.stdin.isTTY) {
      const cont = await promptYesNo(
        'DB has existing data. Continue and add to it?',
      );
      if (!cont) {
        console.log('Aborted.');
        process.exit(0);
      }
    } else {
      console.error('DB has existing data. Pass --force to continue.');
      process.exit(1);
    }
  }

  if (!existsSync(pdfPath)) {
    console.error(`Sample PDF missing at ${pdfPath}`);
    process.exit(1);
  }

  const lab = loadJson<LabSeed>(join(dataDir, 'labs.json'));
  const strains = loadJson<StrainSeed[]>(join(dataDir, 'strains.json'));
  const usersJson = loadJson<UserSeed[]>(join(dataDir, 'users.json'));
  const cages = loadJson<{ holding: CageTemplate[]; breeding: BreedingTemplate[] }>(
    join(dataDir, 'cages.json'),
  );
  const names = loadJson<NamesPool>(join(dataDir, 'names.json'));

  const counts: Counts = {
    labs: 0,
    strains: 0,
    iacuc: 0,
    users: 0,
    holding_cages: 0,
    mouse_moves: 0,
    breeding_cages: 0,
    sticky_notes: 0,
    maintenance: 0,
    tasks: 0,
    reminders: 0,
    mice: 0,
  };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      baseURL: BASE_URL,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    await log.step('login as admin', () => loginAsAdmin(page));

    const csrf = await log.step('retrieve CSRF token', () => getCsrfToken(page));

    await log.step('update lab settings', () =>
      updateLabSettings(page, lab, csrf),
    );
    counts.labs = 1;

    await log.step(`add ${strains.length} strains (UI)`, async () => {
      for (const s of strains) {
        await addStrainViaUi(page, s);
        counts.strains += 1;
      }
    });

    const iacucIds = ['IACUC-2026-001', 'IACUC-2026-002'];
    await log.step(`add ${iacucIds.length} IACUC protocols (UI, file upload)`, async () => {
      const titles = [
        'Standard rodent husbandry and tail snipping',
        'Behavioural testing battery',
      ];
      for (let i = 0; i < iacucIds.length; i++) {
        await addIacucViaUi(page, iacucIds[i], titles[i], pdfPath);
        counts.iacuc += 1;
      }
    });

    const userIdByEmail = await log.step(
      `insert ${usersJson.length} non-admin users (direct INSERT)`,
      () => insertUsersDirect(usersJson),
    );
    counts.users = usersJson.length;
    const adminId = await getAdminUserId();
    const nonAdminIds = Object.values(userIdByEmail);

    await log.step(`add ${cages.holding.length} holding cages (UI)`, async () => {
      for (let i = 0; i < cages.holding.length; i++) {
        const iacuc = i % 2 === 0 ? [iacucIds[0]] : [iacucIds[1]];
        await addHoldingCageViaUi(page, cages.holding[i], adminId, iacuc);
        counts.holding_cages += 1;
      }
    });

    const sexes = ['male', 'female'] as const;
    const founderMice: MouseSeed[] = [];
    const totalMice = 30;
    const founderCount = 24;
    const offspringCount = totalMice - founderCount;
    const dobStart = new Date(Date.UTC(2025, 5, 1));

    for (let i = 0; i < founderCount; i++) {
      const cage = cages.holding[i % cages.holding.length];
      const strain = strains[i % strains.length];
      const sex = pick(rng, sexes);
      const dobOffsetDays = randInt(rng, 0, 180);
      const dob = new Date(dobStart);
      dob.setUTCDate(dob.getUTCDate() + dobOffsetDays);
      const suffix = pick(rng, names.mouseSuffixes);
      founderMice.push({
        mouse_id: `M-${(i + 1).toString().padStart(4, '0')}-${suffix}`,
        sex,
        dob: fmtDate(dob),
        cage_id: cage.cage_id,
        strain: strain.str_id,
        genotype: pick(rng, names.genotypeFragments),
        ear_code: pick(rng, names.earCodes),
        notes: pick(rng, names.notePhrases),
      });
    }

    await log.step(`add ${founderCount} founder mice (UI)`, async () => {
      for (const m of founderMice) {
        await addMouseViaUi(page, m);
        counts.mice += 1;
      }
    });

    const adultMales = founderMice.filter((m) => m.sex === 'male').slice(0, 4);
    const adultFemales = founderMice
      .filter((m) => m.sex === 'female')
      .slice(0, 4);
    if (adultMales.length < 3 || adultFemales.length < 3) {
      throw new Error(
        `Not enough founder mice of each sex (males=${adultMales.length}, females=${adultFemales.length})`,
      );
    }

    const offspringMice: OffspringSeed[] = [];
    for (let i = 0; i < offspringCount; i++) {
      const cage = cages.holding[(i + 3) % cages.holding.length];
      const sire = adultMales[i % adultMales.length];
      const dam = adultFemales[i % adultFemales.length];
      const sex = pick(rng, sexes);
      const dobOffsetDays = randInt(rng, 200, 250);
      const dob = new Date(dobStart);
      dob.setUTCDate(dob.getUTCDate() + dobOffsetDays);
      const suffix = pick(rng, names.mouseSuffixes);
      offspringMice.push({
        mouse_id: `M-${(founderCount + i + 1).toString().padStart(4, '0')}-${suffix}`,
        sex,
        dob: fmtDate(dob),
        cage_id: cage.cage_id,
        strain: sire.strain,
        genotype: pick(rng, names.genotypeFragments),
        ear_code: pick(rng, names.earCodes),
        notes: `Offspring of ${sire.mouse_id} and ${dam.mouse_id}.`,
        sire_id: sire.mouse_id,
        dam_id: dam.mouse_id,
      });
    }

    await log.step(`add ${offspringCount} offspring mice (POST, parent FKs)`, async () => {
      for (const m of offspringMice) {
        await addMouseViaPost(page, m, csrf);
        counts.mice += 1;
      }
    });

    await log.step('perform 5 mouse moves (POST)', async () => {
      const movers = founderMice.slice(0, 5);
      const reasons = [
        'Routine cohort reshuffle',
        'Separating by sex',
        'Quarantine release',
        'Pre-experiment grouping',
        'Cage density adjustment',
      ];
      for (let i = 0; i < movers.length; i++) {
        const m = movers[i];
        const targets = cages.holding
          .map((c) => c.cage_id)
          .filter((id) => id !== m.cage_id);
        const target = pick(rng, targets);
        await moveMouseViaPost(page, m.mouse_id, target, reasons[i], csrf);
        counts.mouse_moves += 1;
      }
    });

    await log.step(`add ${cages.breeding.length} breeding cages (POST, parent FKs)`, async () => {
      for (let i = 0; i < cages.breeding.length; i++) {
        const b = cages.breeding[i];
        const male = adultMales[i % adultMales.length];
        const female = adultFemales[i % adultFemales.length];
        const iacuc = i % 2 === 0 ? [iacucIds[0]] : [iacucIds[1]];
        await addBreedingCageViaPost(
          page,
          b,
          adminId,
          iacuc,
          male.mouse_id,
          female.mouse_id,
          csrf,
        );
        counts.breeding_cages += 1;
      }
    });

    await log.step('add 8 sticky notes (POST)', async () => {
      const cageIds = [
        ...cages.holding.map((c) => c.cage_id),
        ...cages.breeding.map((c) => c.cage_id),
      ];
      for (let i = 0; i < 8; i++) {
        const cage_id = cageIds[i % cageIds.length];
        const note = pick(rng, names.notePhrases);
        await addStickyNoteViaPost(page, cage_id, note, csrf);
        counts.sticky_notes += 1;
      }
    });

    await log.step('add 5 maintenance entries (UI)', async () => {
      for (let i = 0; i < 5; i++) {
        const cage_id = cages.holding[i % cages.holding.length].cage_id;
        const comment = pick(rng, names.maintenanceComments);
        await addMaintenanceViaUi(page, cage_id, comment);
        counts.maintenance += 1;
      }
    });

    const taskStatuses: Array<'Pending' | 'In Progress' | 'Completed'> = [
      'Pending',
      'In Progress',
      'Completed',
      'Pending',
      'In Progress',
      'Completed',
    ];
    const taskCompletionDates = [
      '2026-06-15',
      '2026-06-20',
      '2026-05-30',
      '2026-07-01',
      '2026-06-25',
      '2026-05-28',
    ];
    await log.step('add 6 tasks (UI)', async () => {
      for (let i = 0; i < 6; i++) {
        const assignee = [nonAdminIds[i % nonAdminIds.length]];
        const task: TaskSeed = {
          title: names.taskTitles[i % names.taskTitles.length],
          description: names.taskDescriptions[i % names.taskDescriptions.length],
          assignedToIds: assignee,
          status: taskStatuses[i],
          completion_date: taskCompletionDates[i],
        };
        await addTaskViaUi(page, task, adminId);
        counts.tasks += 1;
      }
    });

    const reminders: ReminderSeed[] = [
      {
        title: names.reminderTitles[0],
        description: names.reminderDescriptions[0],
        assignedToIds: [nonAdminIds[0]],
        recurrence: 'daily',
        day_of_week: '',
        day_of_month: '',
        time_of_day: '08:00:00',
      },
      {
        title: names.reminderTitles[1],
        description: names.reminderDescriptions[1],
        assignedToIds: [nonAdminIds[1] ?? nonAdminIds[0]],
        recurrence: 'weekly',
        day_of_week: 'Monday',
        day_of_month: '',
        time_of_day: '09:30:00',
      },
      {
        title: names.reminderTitles[2],
        description: names.reminderDescriptions[2],
        assignedToIds: [nonAdminIds[2] ?? nonAdminIds[0]],
        recurrence: 'monthly',
        day_of_week: '',
        day_of_month: '15',
        time_of_day: '10:00:00',
      },
    ];
    await log.step('add 3 recurring reminders (UI)', async () => {
      for (const r of reminders) {
        await addReminderViaUi(page, r);
        counts.reminders += 1;
      }
    });
  } catch (err) {
    if (err instanceof SeederError) {
      console.error(`\nSEED FAILED at step "${err.step}":`);
      console.error(`  ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`);
    } else {
      console.error('\nSEED FAILED:');
      console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    }
    process.exit(1);
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }

  const durationMs = Date.now() - t0;
  const summary = {
    seed: args.seed,
    timestamp_utc: new Date().toISOString(),
    durationMs,
    counts,
  };
  const summaryPath = resolve(here, 'scripts', 'seed', 'last-run.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');

  console.log('\nSeed complete.');
  console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Counts: ${JSON.stringify(counts)}`);
  console.log(`  Summary written to: scripts/seed/last-run.json`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
