import pg from 'pg';
import type { ExtractedQuery, NormalizedPlan } from '../types.js';
import type { DbAdapter } from './adapter.js';
import { normalizePostgresPlan } from './normalize-postgres.js';

const SELECT_LEADING = /^\s*(with|select)\b/i;

export class PostgresAdapter implements DbAdapter {
  private readonly pool: pg.Pool;

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }

  async analyze(query: ExtractedQuery): Promise<NormalizedPlan> {
    // ANALYZE actually executes the statement, so only use it for read-only
    // SELECT/WITH. Everything else gets a plan-only EXPLAIN. Either way the
    // whole thing runs inside a transaction we roll back, so nothing persists.
    const analyze = SELECT_LEADING.test(query.sql);
    const explainPrefix = analyze
      ? 'EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS)'
      : 'EXPLAIN (FORMAT JSON)';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(`${explainPrefix} ${query.sql}`);
      const planJson = res.rows[0]?.['QUERY PLAN'];
      return normalizePostgresPlan(planJson);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
