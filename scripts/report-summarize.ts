import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface CliArgs {
  input: string;
  output: string;
  appSha: string;
  appRef: string;
}

type ParseArgsResult =
  | { ok: true; args: CliArgs }
  | { ok: false; reason: string };

function parseArgs(argv: string[]): ParseArgsResult {
  const partial: Partial<CliArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (!v) continue;
    if (a === '--input') {
      partial.input = v;
      i++;
    } else if (a === '--output') {
      partial.output = v;
      i++;
    } else if (a === '--app-sha') {
      partial.appSha = v;
      i++;
    } else if (a === '--app-ref') {
      partial.appRef = v;
      i++;
    }
  }
  if (!partial.input || !partial.output || !partial.appSha || !partial.appRef) {
    return {
      ok: false,
      reason:
        'Required: --input <path> --output <path> --app-sha <sha> --app-ref <ref>',
    };
  }
  return {
    ok: true,
    args: {
      input: partial.input,
      output: partial.output,
      appSha: partial.appSha,
      appRef: partial.appRef,
    },
  };
}

type SpecStatus = 'passed' | 'failed' | 'skipped';

interface SpecOutcome {
  module: string;
  file: string;
  title: string;
  status: SpecStatus;
  errorFirstLine: string | null;
  durationMs: number;
}

interface PlaywrightTestResult {
  status?: string;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
  duration?: number;
}

interface PlaywrightTest {
  results?: PlaywrightTestResult[];
}

interface PlaywrightSpec {
  title?: string;
  file?: string;
  tests?: PlaywrightTest[];
}

interface PlaywrightSuite {
  title?: string;
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightReport {
  config?: { rootDir?: string };
  suites?: PlaywrightSuite[];
  stats?: {
    startTime?: string;
    duration?: number;
    expected?: number;
    unexpected?: number;
    skipped?: number;
    flaky?: number;
  };
}

function mapStatus(raw: string | undefined): SpecStatus {
  if (raw === 'passed' || raw === 'expected') return 'passed';
  if (raw === 'skipped') return 'skipped';
  return 'failed';
}

function moduleFor(specFile: string): string {
  const marker = 'specs/';
  const idx = specFile.indexOf(marker);
  const tail = idx >= 0 ? specFile.slice(idx + marker.length) : specFile;
  const parts = tail.split('/');
  if (parts.length > 1) return parts[0];
  return parts[0].replace(/\.spec\.ts$/, '');
}

function flattenSpecs(
  suites: PlaywrightSuite[] | undefined,
): SpecOutcome[] {
  const out: SpecOutcome[] = [];
  if (!suites) return out;
  const visit = (s: PlaywrightSuite, inheritedFile?: string): void => {
    const currentFile = s.file ?? inheritedFile;
    if (s.specs) {
      for (const spec of s.specs) {
        const specFile = spec.file ?? currentFile ?? 'unknown';
        const title = spec.title ?? '<untitled>';
        const result = spec.tests?.[0]?.results?.[0];
        const errMsg =
          result?.error?.message ?? result?.errors?.[0]?.message ?? null;
        out.push({
          module: moduleFor(specFile),
          file: specFile,
          title,
          status: mapStatus(result?.status),
          errorFirstLine: errMsg ? errMsg.split('\n')[0] : null,
          durationMs: result?.duration ?? 0,
        });
      }
    }
    if (s.suites) for (const sub of s.suites) visit(sub, currentFile);
  };
  for (const top of suites) visit(top);
  return out;
}

function gitOneLine(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')[0];
  } catch {
    return '<unknown>';
  }
}

function isoNowUtc(): string {
  const d = new Date();
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.reason);
    process.exit(2);
  }
  const { args } = parsed;

  const root = process.cwd();
  const appDir = resolve(root, 'app');

  const raw = readFileSync(args.input, 'utf8');
  const report = JSON.parse(raw) as PlaywrightReport;

  const specs = flattenSpecs(report.suites);

  const passed = specs.filter((s) => s.status === 'passed').length;
  const failed = specs.filter((s) => s.status === 'failed').length;
  const skipped = specs.filter((s) => s.status === 'skipped').length;
  const durationSec = ((report.stats?.duration ?? 0) / 1000).toFixed(1);

  const moduleCounts: Record<string, { p: number; f: number; s: number }> = {};
  for (const spec of specs) {
    const bucket = moduleCounts[spec.module] ?? { p: 0, f: 0, s: 0 };
    if (spec.status === 'passed') bucket.p++;
    else if (spec.status === 'failed') bucket.f++;
    else bucket.s++;
    moduleCounts[spec.module] = bucket;
  }

  const sha7 = args.appSha.slice(0, 7);
  const appSubject = gitOneLine(
    `git log --format=%s -n 1 ${args.appSha}`,
    appDir,
  );
  const testsSha = gitOneLine('git rev-parse HEAD', root);
  const testsSha7 = testsSha === '<unknown>' ? testsSha : testsSha.slice(0, 7);
  const testsSubject = gitOneLine('git log --format=%s -n 1 HEAD', root);

  const lines: string[] = [];
  lines.push(`# Regression run: ${isoNowUtc()}`);
  lines.push('');
  lines.push('## Target');
  lines.push(`- App: MyVivarium-2 @ ${sha7} ("${appSubject}")`);
  lines.push(`- Branch synced from: ${args.appRef}`);
  lines.push(`- Tests repo: ${testsSha7} ("${testsSubject}")`);
  lines.push('');
  lines.push('## Result');
  lines.push(`- ${passed} passed`);
  lines.push(`- ${failed} failed`);
  lines.push(`- ${skipped} skipped`);
  lines.push(`- Duration: ${durationSec}s`);
  lines.push('');
  lines.push('## By module');
  lines.push('| Module | Passed | Failed | Skipped |');
  lines.push('|--------|--------|--------|---------|');
  const modules = Object.keys(moduleCounts).sort();
  for (const m of modules) {
    const c = moduleCounts[m];
    lines.push(`| ${m} | ${c.p} | ${c.f} | ${c.s} |`);
  }
  lines.push('');
  lines.push('## Failures');
  const failures = specs.filter((s) => s.status === 'failed');
  if (failures.length === 0) {
    lines.push('None.');
  } else {
    for (const f of failures) {
      lines.push(`### ${f.file}: ${f.title}`);
      lines.push(`- Error: ${f.errorFirstLine ?? '<no message>'}`);
      lines.push('- Classification: TBD (fill in during diagnosis)');
      lines.push('');
    }
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('Auto-generated. Add human notes below this line if needed.');
  lines.push('');

  writeFileSync(args.output, lines.join('\n'));
  console.log(`Wrote ${args.output}`);
}

main();
