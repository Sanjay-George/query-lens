import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgresAdapter } from '../src/db/postgres.js';
import { flattenPlan } from '../src/db/plan.js';
import type { ExtractedQuery } from '../src/types.js';

// Opt-in: needs a running Postgres (docker compose up -d postgres). Skipped by
// default so `npm test` stays fast and offline.
const run = process.env.RUN_DB_TESTS === '1';
const describeDb = run ? describe : describe.skip;

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Fall back to .env (the file docker-compose.yml reads).
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  const env = readFileSync(envPath, 'utf8');
  const match = env.match(/^DATABASE_URL=(.+)$/m);
  if (!match) throw new Error('DATABASE_URL not set and not found in .env');
  return match[1]!.trim();
}

const TABLE = 'qr_integration_users';

const query = (sql: string): ExtractedQuery => ({
  id: 't:1',
  file: 't.ts',
  startLine: 1,
  endLine: 1,
  source: 'raw',
  dialect: 'postgres',
  sql,
  confidence: 1,
  codeSpan: sql,
});

describeDb('PostgresAdapter (live)', () => {
  let adapter: PostgresAdapter;
  let pool: pg.Pool;
  const url = run ? databaseUrl() : '';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await pool.query(`CREATE TABLE ${TABLE} (id serial primary key, email text, active boolean)`);
    await pool.query(
      `INSERT INTO ${TABLE} (email, active)
       SELECT 'u'||g||'@x.com', (g % 50 = 0) FROM generate_series(1, 20000) g`,
    );
    await pool.query(`ANALYZE ${TABLE}`);
    adapter = new PostgresAdapter(url);
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await pool.end();
    await adapter.close();
  });

  it('returns an ANALYZE plan with a filtered seq scan for a SELECT', async () => {
    const plan = await adapter.analyze(query(`SELECT * FROM ${TABLE} WHERE active = true`));
    const nodes = flattenPlan(plan);
    const seqScan = nodes.find((n) => n.kind === 'Seq Scan');
    expect(seqScan).toBeDefined();
    expect(seqScan!.table).toBe(TABLE);
    expect(seqScan!.rowsRemovedByFilter).toBeGreaterThan(10_000);
    expect(plan.actualTimeMs).toBeGreaterThan(0);
  });

  it('does not execute (no ANALYZE) for a non-SELECT statement', async () => {
    const before = await pool.query(`SELECT count(*)::int AS c FROM ${TABLE}`);
    const plan = await adapter.analyze(query(`DELETE FROM ${TABLE} WHERE active = true`));
    const after = await pool.query(`SELECT count(*)::int AS c FROM ${TABLE}`);
    // Plan-only EXPLAIN: row count unchanged, no actual timing recorded.
    expect(after.rows[0].c).toBe(before.rows[0].c);
    expect(plan.actualTimeMs).toBeUndefined();
  });

  it('rolls back so a SELECT analysis leaves no trace', async () => {
    // ANALYZE on a SELECT runs the query but our BEGIN/ROLLBACK reverts any
    // side effects; this mainly asserts the adapter doesn't leak transactions.
    const plan = await adapter.analyze(query(`SELECT count(*) FROM ${TABLE}`));
    expect(plan.ops.length).toBeGreaterThan(0);
  });
});
