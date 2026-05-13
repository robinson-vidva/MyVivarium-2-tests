import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { syncApp } from './sync-app.js';

interface CliArgs {
  noSync: boolean;
  ref: string;
}

function parseArgs(argv: string[]): CliArgs {
  let noSync = false;
  let ref = 'main';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-sync') noSync = true;
    else if (a === '--ref') {
      const v = argv[i + 1];
      if (!v) {
        console.error('--ref requires a value');
        process.exit(2);
      }
      ref = v;
      i++;
    }
  }
  return { noSync, ref };
}

function header(label: string): void {
  console.log(`\n=== ${label} ===`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForApp(url: string, maxAttempts: number): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      // 200 (login page) or 3xx (redirect to login) both mean the app is up.
      if (res.status >= 200 && res.status < 400) return true;
    } catch {
      // Connection refused, etc. — not up yet.
    }
    await sleep(1000);
  }
  return false;
}

function nowUtcCompact(): string {
  const d = new Date();
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

interface ResultCounts {
  passed: number;
  failed: number;
  skipped: number;
}

interface PlaywrightStats {
  duration?: number;
  expected?: number;
  unexpected?: number;
  skipped?: number;
  flaky?: number;
}

interface PlaywrightReportShape {
  stats?: PlaywrightStats;
}

function readCountsFrom(jsonPath: string): ResultCounts {
  try {
    const raw = readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw) as PlaywrightReportShape;
    return {
      passed: data.stats?.expected ?? 0,
      failed: data.stats?.unexpected ?? 0,
      skipped: data.stats?.skipped ?? 0,
    };
  } catch {
    return { passed: 0, failed: 0, skipped: 0 };
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const testsDir = resolve(root, 'tests');
  const reportsDir = resolve(root, 'regression-reports');
  const appVersionFile = resolve(root, '.app-version');

  const args = parseArgs(process.argv.slice(2));

  if (!args.noSync) {
    header('Sync');
    const result = syncApp(args.ref, root);
    if (!result.ok) {
      console.error(`Sync failed: ${result.reason}`);
      process.exit(1);
    }
    console.log(`Synced app to ${result.ref} @ ${result.sha7}`);
  } else {
    header('Sync skipped (--no-sync)');
  }

  if (!existsSync(appVersionFile)) {
    console.error(
      `.app-version missing at ${appVersionFile}. ` +
        'Run scripts/sync-app.ts first or omit --no-sync.',
    );
    process.exit(1);
  }
  const sha = readFileSync(appVersionFile, 'utf8').trim();
  const sha7 = sha.slice(0, 7);

  header('Docker compose down (ignore errors) + up');
  try {
    execSync('docker compose down', { cwd: root, stdio: 'inherit' });
  } catch {
    // First run: nothing to bring down.
  }
  try {
    execSync('docker compose up -d --build', { cwd: root, stdio: 'inherit' });
  } catch {
    console.error('docker compose up failed.');
    process.exit(1);
  }

  header('Waiting for app on http://localhost:8080/index.php');
  const ready = await waitForApp('http://localhost:8080/index.php', 90);
  if (!ready) {
    console.error('App never responded after 90 seconds. Tailing logs:');
    try {
      execSync('docker compose logs app --tail=50', {
        cwd: root,
        stdio: 'inherit',
      });
    } catch {
      // ignore
    }
    process.exit(1);
  }
  console.log('App is up.');

  header('Running Playwright suite');
  const testRun = spawnSync(
    'npx',
    ['playwright', 'test', '--reporter=list,json,html'],
    {
      cwd: testsDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_JSON_OUTPUT_NAME: resolve(testsDir, 'results.json'),
        PLAYWRIGHT_HTML_OPEN: 'never',
      },
    },
  );
  const playwrightExit = testRun.status ?? 1;

  header('Snapshotting report');
  const reportDirName = `${nowUtcCompact()}-${sha7}`;
  const reportDir = join(reportsDir, reportDirName);
  mkdirSync(reportDir, { recursive: true });

  const resultsCandidates = [
    join(testsDir, 'playwright-report', 'results.json'),
    join(testsDir, 'results.json'),
  ];
  let copiedResultsAt: string | null = null;
  for (const candidate of resultsCandidates) {
    if (existsSync(candidate)) {
      const dest = join(reportDir, 'results.json');
      copyFileSync(candidate, dest);
      copiedResultsAt = dest;
      break;
    }
  }
  if (!copiedResultsAt) {
    console.warn(
      'No Playwright results.json found. Tests likely did not complete cleanly.',
    );
  }

  if (copiedResultsAt) {
    try {
      unlinkSync(join(testsDir, 'results.json'));
    } catch {
      // ignore - file may already be gone
    }
  }

  const testResultsDir = join(testsDir, 'test-results');
  if (existsSync(testResultsDir)) {
    cpSync(testResultsDir, join(reportDir, 'artifacts'), { recursive: true });
  }

  if (copiedResultsAt) {
    header('Generating summary.md');
    try {
      execSync(
        [
          'npx tsx scripts/report-summarize.ts',
          `--input ${copiedResultsAt}`,
          `--output ${join(reportDir, 'summary.md')}`,
          `--app-sha ${sha}`,
          `--app-ref ${args.ref}`,
        ].join(' '),
        { cwd: root, stdio: 'inherit' },
      );
    } catch {
      console.warn(
        'Summary generation failed. results.json is preserved in the report dir.',
      );
    }
  }

  header('Done');
  const counts = copiedResultsAt
    ? readCountsFrom(copiedResultsAt)
    : { passed: 0, failed: 0, skipped: 0 };
  console.log(
    `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped against ${sha7}.`,
  );
  console.log(`Report: regression-reports/${reportDirName}/`);

  process.exit(playwrightExit);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
