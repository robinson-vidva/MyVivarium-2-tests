import { test, expect, request as playRequest, APIRequestContext } from '@playwright/test';
import { withDb } from '../../fixtures/db';
import { ADMIN } from '../../fixtures/users';
import { uniq } from '../../fixtures/uniq';
import { loginApi, fetchCsrfToken } from '../../fixtures/csrf';

interface CsrfTarget {
  path: string;
  payload: Record<string, string>;
  expectedStatus: number;
  expectedBodyMatch: RegExp;
}

// The app rejects missing CSRF tokens with two different shapes:
//   - die('CSRF token validation failed')        -> HTTP 200, plain text body
//   - http_response_code(403) + JSON             -> HTTP 403, JSON body
// Both are correct rejections; the inconsistency is a UX/uniformity concern
// (worth noting in TESTPLAN, not a REAL-APP-BUG).
const TARGETS: CsrfTarget[] = [
  { path: '/hc_addn.php',         payload: { cage_id: uniq('hc') },        expectedStatus: 200, expectedBodyMatch: /CSRF token validation failed/ },
  { path: '/bc_addn.php',         payload: { cage_id: uniq('bc') },        expectedStatus: 200, expectedBodyMatch: /CSRF token validation failed/ },
  { path: '/manage_tasks.php',    payload: { title: uniq('task') },        expectedStatus: 200, expectedBodyMatch: /CSRF token validation failed/ },
  { path: '/manage_reminder.php', payload: { title: uniq('rem') },         expectedStatus: 200, expectedBodyMatch: /CSRF token validation failed/ },
  { path: '/nt_add.php',          payload: { note_text: uniq('note') },    expectedStatus: 403, expectedBodyMatch: /Invalid CSRF token/ },
];

async function adminApi(): Promise<APIRequestContext> {
  const ctx = await playRequest.newContext({
    baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
    ignoreHTTPSErrors: true,
  });
  await loginApi(ctx, ADMIN.email, ADMIN.password);
  return ctx;
}

test('POST without csrf_token is rejected on every state-changing endpoint', async () => {
  const ctx = await adminApi();
  try {
    for (const t of TARGETS) {
      const resp = await ctx.post(t.path, { form: t.payload });
      const body = await resp.text();
      expect(resp.status(), `${t.path} status`).toBe(t.expectedStatus);
      expect(body, `${t.path} body should match ${t.expectedBodyMatch}`).toMatch(t.expectedBodyMatch);
    }
  } finally {
    await ctx.dispose();
  }
});

test('POST with valid csrf_token to hc_addn.php creates the cage (positive control)', async () => {
  const ctx = await adminApi();
  const cageId = uniq('csrf-ok');
  try {
    const token = await fetchCsrfToken(ctx, '/hc_addn.php');
    const resp = await ctx.post('/hc_addn.php', {
      form: { csrf_token: token, cage_id: cageId },
    });
    const body = await resp.text();
    expect(body).not.toMatch(/CSRF token validation failed/);

    const created = await withDb(async (con) => {
      const [rows] = await con.execute('SELECT cage_id FROM cages WHERE cage_id = ?', [cageId]);
      return (rows as unknown[]).length;
    });
    expect(created).toBe(1);
  } finally {
    await withDb(async (con) => {
      await con.execute('DELETE FROM cages WHERE cage_id = ?', [cageId]);
    });
    await ctx.dispose();
  }
});
