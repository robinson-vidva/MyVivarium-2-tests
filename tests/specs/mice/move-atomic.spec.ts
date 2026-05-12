import { test, expect, request as playRequest, APIRequestContext } from '@playwright/test';
import { withDb } from '../../fixtures/db';
import { ADMIN, getUserId } from '../../fixtures/users';
import { uniq } from '../../fixtures/uniq';
import { loginApi, fetchCsrfToken } from '../../fixtures/csrf';

interface HistoryRow {
  id: number;
  mouse_id: string;
  cage_id: string | null;
  moved_in_at: string;
  moved_out_at: string | null;
  reason: string | null;
  moved_by: number | null;
}

interface MiceRow {
  current_cage_id: string | null;
  status: string;
}

async function setupApiAdmin(): Promise<APIRequestContext> {
  const ctx = await playRequest.newContext({
    baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
    ignoreHTTPSErrors: true,
  });
  await loginApi(ctx, ADMIN.email, ADMIN.password);
  return ctx;
}

async function createCage(cage_id: string): Promise<void> {
  await withDb(async (con) => {
    await con.execute(
      `INSERT INTO cages (cage_id, status) VALUES (?, 'active')`,
      [cage_id],
    );
  });
}

async function deleteCageAndMouse(cage_a: string, cage_b: string, mouse_id: string): Promise<void> {
  await withDb(async (con) => {
    await con.execute('DELETE FROM mouse_cage_history WHERE mouse_id = ?', [mouse_id]);
    await con.execute('DELETE FROM mice WHERE mouse_id = ?', [mouse_id]);
    await con.execute('DELETE FROM cages WHERE cage_id IN (?, ?)', [cage_a, cage_b]);
  });
}

async function getHistory(mouse_id: string): Promise<HistoryRow[]> {
  return withDb(async (con) => {
    const [rows] = await con.execute(
      'SELECT id, mouse_id, cage_id, moved_in_at, moved_out_at, reason, moved_by ' +
        'FROM mouse_cage_history WHERE mouse_id = ? ORDER BY id ASC',
      [mouse_id],
    );
    return rows as HistoryRow[];
  });
}

async function getMouse(mouse_id: string): Promise<MiceRow> {
  return withDb(async (con) => {
    const [rows] = await con.execute(
      'SELECT current_cage_id, status FROM mice WHERE mouse_id = ?',
      [mouse_id],
    );
    return (rows as MiceRow[])[0];
  });
}

test('mouse move closes A, opens B, syncs mice.current_cage_id atomically', async () => {
  const cageA = uniq('cageA');
  const cageB = uniq('cageB');
  const mouseId = uniq('mouse');

  const ctx = await setupApiAdmin();
  try {
    await createCage(cageA);
    await createCage(cageB);

    const tokenForAddn = await fetchCsrfToken(ctx, '/mouse_addn.php');
    const reg = await ctx.post('/mouse_addn.php', {
      form: {
        csrf_token: tokenForAddn,
        mouse_id: mouseId,
        sex: 'female',
        dob: '2024-01-01',
        cage_id: cageA,
      },
    });
    expect(reg.ok(), `register response ${reg.status()} ${await reg.text()}`).toBe(true);

    let history = await getHistory(mouseId);
    expect(history).toHaveLength(1);
    expect(history[0].cage_id).toBe(cageA);
    expect(history[0].moved_out_at).toBeNull();

    let mouse = await getMouse(mouseId);
    expect(mouse.current_cage_id).toBe(cageA);
    expect(mouse.status).toBe('alive');

    const tokenForMove = await fetchCsrfToken(ctx, '/mouse_addn.php');
    const move = await ctx.post('/mouse_move.php', {
      form: {
        csrf_token: tokenForMove,
        mouse_id: mouseId,
        target_cage_id: cageB,
        reason: 'regression test move',
      },
    });
    expect(move.ok(), `move response ${move.status()} ${await move.text()}`).toBe(true);

    history = await getHistory(mouseId);
    expect(history).toHaveLength(2);

    const openIntervals = history.filter((r) => r.moved_out_at === null);
    const closedIntervals = history.filter((r) => r.moved_out_at !== null);
    expect(openIntervals).toHaveLength(1);
    expect(closedIntervals).toHaveLength(1);
    expect(openIntervals[0].cage_id).toBe(cageB);
    expect(closedIntervals[0].cage_id).toBe(cageA);

    mouse = await getMouse(mouseId);
    expect(mouse.current_cage_id).toBe(cageB);
    expect(mouse.status).toBe('alive');
  } finally {
    await deleteCageAndMouse(cageA, cageB, mouseId);
    await ctx.dispose();
  }
});

test('mouse move records moved_by (actor) and reason on the new open interval', async () => {
  const cageA = uniq('cageA');
  const cageB = uniq('cageB');
  const mouseId = uniq('mouse');
  const reason = 'quarantine';

  const ctx = await setupApiAdmin();
  try {
    await createCage(cageA);
    await createCage(cageB);

    const token1 = await fetchCsrfToken(ctx, '/mouse_addn.php');
    await ctx.post('/mouse_addn.php', {
      form: {
        csrf_token: token1,
        mouse_id: mouseId,
        sex: 'male',
        dob: '2024-02-01',
        cage_id: cageA,
      },
    });

    const token2 = await fetchCsrfToken(ctx, '/mouse_addn.php');
    await ctx.post('/mouse_move.php', {
      form: {
        csrf_token: token2,
        mouse_id: mouseId,
        target_cage_id: cageB,
        reason,
      },
    });

    const history = await getHistory(mouseId);
    const open = history.find((r) => r.moved_out_at === null);
    expect(open).toBeDefined();
    expect(open!.cage_id).toBe(cageB);
    expect(open!.reason).toBe(reason);

    const adminId = await getUserId(ADMIN.email);
    expect(open!.moved_by).toBe(adminId);
  } finally {
    await deleteCageAndMouse(cageA, cageB, mouseId);
    await ctx.dispose();
  }
});
