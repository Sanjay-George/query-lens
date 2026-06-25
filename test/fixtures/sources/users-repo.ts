import { pool } from './db';

export async function findActiveUsers() {
  const res = await pool.query(
    "SELECT * FROM users WHERE active = true",
  );
  return res.rows;
}
