import { withDb } from './db';

export const ADMIN = {
  email: 'admin@myvivarium.online',
  password: 'P@ssw0rd',
  role: 'admin' as const,
};

export const VM = {
  email: 'vm@test.local',
  password: 'P@ssw0rd',
  role: 'vivarium_manager' as const,
};

export const USER = {
  email: 'user@test.local',
  password: 'P@ssw0rd',
  role: 'user' as const,
};

// bcrypt hash of "P@ssw0rd" — same hash schema.sql seeds for the default admin.
export const TEST_PASSWORD_HASH =
  '$2y$10$roVlhpjZsRFXY.m9JtRB/OAaN2dp50O7D2J5idI2MsUotxMyrHRZ6';

export interface SeedUser {
  email: string;
  name: string;
  role: 'admin' | 'vivarium_manager' | 'user';
  initials?: string;
  position?: string;
}

export async function ensureUser(opts: SeedUser): Promise<number> {
  return withDb(async (con) => {
    const [rows] = await con.execute(
      'SELECT id FROM users WHERE username = ?',
      [opts.email],
    );
    const found = rows as Array<{ id: number }>;
    if (found.length > 0) {
      await con.execute(
        `UPDATE users SET
            password = ?, role = ?, status = 'approved',
            email_verified = 1, login_attempts = 0, account_locked = NULL,
            name = ?, initials = ?, position = ?
         WHERE username = ?`,
        [
          TEST_PASSWORD_HASH,
          opts.role,
          opts.name,
          opts.initials ?? 'TST',
          opts.position ?? 'Tester',
          opts.email,
        ],
      );
      return found[0].id;
    }
    const [result] = await con.execute(
      `INSERT INTO users (name, username, position, role, password, status,
                          login_attempts, email_verified, initials)
       VALUES (?, ?, ?, ?, ?, 'approved', 0, 1, ?)`,
      [
        opts.name,
        opts.email,
        opts.position ?? 'Tester',
        opts.role,
        TEST_PASSWORD_HASH,
        opts.initials ?? 'TST',
      ],
    );
    return (result as { insertId: number }).insertId;
  });
}

export async function unlockUser(email: string): Promise<void> {
  await withDb(async (con) => {
    await con.execute(
      'UPDATE users SET login_attempts = 0, account_locked = NULL WHERE username = ?',
      [email],
    );
  });
}

export async function deleteUser(email: string): Promise<void> {
  await withDb(async (con) => {
    await con.execute('DELETE FROM users WHERE username = ?', [email]);
  });
}

export async function getUserId(email: string): Promise<number | null> {
  return withDb(async (con) => {
    const [rows] = await con.execute('SELECT id FROM users WHERE username = ?', [email]);
    const arr = rows as Array<{ id: number }>;
    return arr.length > 0 ? arr[0].id : null;
  });
}
