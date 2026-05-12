import mysql, { Connection, RowDataPacket } from 'mysql2/promise';

export type Row = RowDataPacket;

export async function dbConnect(): Promise<Connection> {
  return mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3307),
    user: process.env.DB_USERNAME ?? 'myvivarium',
    password: process.env.DB_PASSWORD ?? 'myvivariumpw',
    database: process.env.DB_DATABASE ?? 'myvivarium',
    multipleStatements: false,
    dateStrings: true,
  });
}

export async function withDb<T>(fn: (con: Connection) => Promise<T>): Promise<T> {
  const con = await dbConnect();
  try {
    return await fn(con);
  } finally {
    await con.end();
  }
}
