import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { SqlServerAdapter } from '../src/db/sqlserver.js';
import { flattenPlan } from '../src/db/plan.js';
import type { ExtractedQuery } from '../src/types.js';

// Opt-in: needs a running SQL Server (docker compose up -d sqlserver). Skipped
// by default so `npm test` stays fast and offline.
const run = process.env.RUN_DB_TESTS === '1';
const describeDb = run ? describe : describe.skip;

function databaseUrl(): string {
  if (process.env.MSSQL_URL) return process.env.MSSQL_URL;
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  const env = readFileSync(envPath, 'utf8');
  const match = env.match(/^MSSQL_URL=(.+)$/m);
  if (!match) throw new Error('MSSQL_URL not set and not found in .env');
  return match[1]!.trim();
}

const TABLE = 'qr_integration_users';

const query = (sqlText: string): ExtractedQuery => ({
  id: 't:1',
  file: 't.ts',
  startLine: 1,
  endLine: 1,
  source: 'raw',
  dialect: 'sqlserver',
  sql: sqlText,
  confidence: 1,
  codeSpan: sqlText,
});

describeDb('SqlServerAdapter (live)', () => {
  let adapter: SqlServerAdapter;
  let pool: sql.ConnectionPool;
  const url = run ? databaseUrl() : '';

  beforeAll(async () => {
    pool = await new sql.ConnectionPool(url).connect();
    await pool.request().batch(`IF OBJECT_ID('${TABLE}', 'U') IS NOT NULL DROP TABLE ${TABLE}`);
    await pool
      .request()
      .batch(`CREATE TABLE ${TABLE} (id int identity primary key, email nvarchar(200), active bit)`);
    await pool.request().batch(
      `WITH n AS (
         SELECT 1 AS g UNION ALL SELECT g + 1 FROM n WHERE g < 20000
       )
       INSERT INTO ${TABLE} (email, active)
       SELECT CONCAT('u', g, '@x.com'), CASE WHEN g % 50 = 0 THEN 1 ELSE 0 END
       FROM n OPTION (MAXRECURSION 0)`,
    );
    adapter = new SqlServerAdapter(url);
  }, 60_000);

  afterAll(async () => {
    await pool.request().batch(`IF OBJECT_ID('${TABLE}', 'U') IS NOT NULL DROP TABLE ${TABLE}`);
    await pool.close();
    await adapter.close();
  });

  it('returns an actual plan with a filtered table scan for a SELECT', async () => {
    const plan = await adapter.analyze(query(`SELECT * FROM ${TABLE} WHERE active = 1`));
    const nodes = flattenPlan(plan);
    const scan = nodes.find((n) => n.kind === 'Seq Scan');
    expect(scan).toBeDefined();
    expect(scan!.table).toBe(TABLE);
    expect(scan!.rowsRemovedByFilter).toBeGreaterThan(10_000);
    expect(plan.actualTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('does not execute (plan-only) for a non-SELECT statement', async () => {
    const before = await pool.request().query(`SELECT COUNT(*) AS c FROM ${TABLE}`);
    const plan = await adapter.analyze(query(`DELETE FROM ${TABLE} WHERE active = 1`));
    const after = await pool.request().query(`SELECT COUNT(*) AS c FROM ${TABLE}`);
    // SHOWPLAN_XML produces an estimated plan without running the statement.
    expect(after.recordset[0].c).toBe(before.recordset[0].c);
    expect(plan.actualTimeMs).toBeUndefined();
  });
});
