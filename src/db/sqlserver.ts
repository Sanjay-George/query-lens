import sql from 'mssql';
import type { ExtractedQuery, NormalizedPlan } from '../types.js';
import type { DbAdapter } from './adapter.js';
import { normalizeSqlServerPlan } from './normalize-sqlserver.js';

const SELECT_LEADING = /^\s*(with|select)\b/i;

export class SqlServerAdapter implements DbAdapter {
  private readonly poolPromise: Promise<sql.ConnectionPool>;

  constructor(url: string) {
    this.poolPromise = new sql.ConnectionPool(url).connect();
  }

  async analyze(query: ExtractedQuery): Promise<NormalizedPlan> {
    // STATISTICS XML executes the statement and returns actual row/timing
    // counters, so it's only used for read-only SELECT/WITH. Everything else
    // gets the plan-only SHOWPLAN_XML (estimates, no execution). Both run inside
    // a transaction we roll back, so a SELECT's side effects never persist.
    const analyze = SELECT_LEADING.test(query.sql);
    const setStatement = analyze ? 'SET STATISTICS XML ON' : 'SET SHOWPLAN_XML ON';

    const pool = await this.poolPromise;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      // SHOWPLAN_XML/STATISTICS_XML must be set in their own batch, and the
      // setting is connection-scoped — the Transaction pins both batches to one
      // connection so the second batch sees the SET from the first.
      await new sql.Request(tx).batch(setStatement);
      const result = await new sql.Request(tx).batch(query.sql);
      return normalizeSqlServerPlan(extractShowplanXml(result));
    } finally {
      await tx.rollback().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const pool = await this.poolPromise;
    await pool.close();
  }
}

// The showplan XML arrives as a one-cell row in one of the result sets (the
// only one whose value is the <ShowPlanXML> document). Scan every recordset for
// it rather than assuming a position, which differs between the two SET modes.
function extractShowplanXml(result: sql.IResult<unknown>): string {
  for (const recordset of result.recordsets as unknown[][]) {
    for (const row of recordset) {
      for (const value of Object.values(row as Record<string, unknown>)) {
        if (typeof value === 'string' && value.includes('<ShowPlanXML')) return value;
      }
    }
  }
  throw new Error('No showplan XML returned by SQL Server');
}
