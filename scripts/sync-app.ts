import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_REPO = 'https://github.com/robinson-vidva/MyVivarium-2.git';

export type SyncResult =
  | { ok: true; ref: string; sha: string; sha7: string }
  | { ok: false; reason: string };

interface RunOpts {
  cwd: string;
  silent?: boolean;
}

function run(cmd: string, opts: RunOpts): void {
  execSync(cmd, { cwd: opts.cwd, stdio: opts.silent ? 'pipe' : 'inherit' });
}

function runCapture(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8' }).trim();
}

function isBranchOnOrigin(ref: string, appDir: string): boolean {
  try {
    execSync(`git show-ref --verify --quiet refs/remotes/origin/${ref}`, {
      cwd: appDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function writeAppVersionAtomic(target: string, sha: string): void {
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${sha}\n`);
  renameSync(tmp, target);
}

export function syncApp(ref: string, root: string): SyncResult {
  const appDir = resolve(root, 'app');
  const appVersionFile = resolve(root, '.app-version');

  try {
    if (!existsSync(appDir)) {
      run(`git clone ${APP_REPO} app`, { cwd: root });
    }

    run('git fetch origin', { cwd: appDir });
    run(`git checkout ${ref}`, { cwd: appDir });

    if (isBranchOnOrigin(ref, appDir)) {
      run(`git pull --ff-only origin ${ref}`, { cwd: appDir });
    }

    const sha = runCapture('git rev-parse HEAD', appDir);
    writeAppVersionAtomic(appVersionFile, sha);

    return { ok: true, ref, sha, sha7: sha.slice(0, 7) };
  } catch (err) {
    const reason =
      err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { ok: false, reason };
  }
}

function isMain(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMain()) {
  const ref = process.argv[2] ?? 'main';
  const result = syncApp(ref, process.cwd());
  if (result.ok) {
    console.log(`Synced app to ${result.ref} @ ${result.sha7}`);
    process.exit(0);
  } else {
    console.error(`Sync failed: ${result.reason}`);
    process.exit(1);
  }
}
