import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeSqlServerPlan } from '../src/db/normalize-sqlserver.js';
import { flattenPlan } from '../src/db/plan.js';

const fixtureUrl = new URL('./fixtures/plans/sqlserver-statistics.xml', import.meta.url);

describe('normalizeSqlServerPlan', () => {
  it('normalizes a captured STATISTICS XML plan with actual counters', async () => {
    const xml = await readFile(fileURLToPath(fixtureUrl), 'utf8');
    const plan = normalizeSqlServerPlan(xml);

    expect(plan.ops).toHaveLength(1);
    const root = plan.ops[0]!;
    expect(root.kind).toBe('Hash Match');
    expect(root.estimatedRows).toBe(400);
    expect(root.actualRows).toBe(400);

    expect(plan.totalCostEstimate).toBe(1.234);
    expect(plan.actualTimeMs).toBe(12);
    expect(plan.rowsReturned).toBe(400);
  });

  it('maps a full table scan to the canonical "Seq Scan" kind', async () => {
    const xml = await readFile(fileURLToPath(fixtureUrl), 'utf8');
    const flat = flattenPlan(normalizeSqlServerPlan(xml));

    expect(flat.map((n) => n.kind)).toEqual(['Hash Match', 'Seq Scan', 'Clustered Index Seek']);

    const scan = flat.find((n) => n.kind === 'Seq Scan')!;
    expect(scan.table).toBe('users');
    expect(scan.actualRows).toBe(400);
    // 20000 rows read - 400 emitted = 19600 discarded by the active=1 predicate.
    expect(scan.rowsRemovedByFilter).toBe(19600);
    expect(scan.actualTimeMs).toBe(8);
  });

  it('reads the index name on a seek and leaves its kind untouched', async () => {
    const xml = await readFile(fileURLToPath(fixtureUrl), 'utf8');
    const seek = flattenPlan(normalizeSqlServerPlan(xml)).find(
      (n) => n.kind === 'Clustered Index Seek',
    )!;
    expect(seek.table).toBe('orders');
    expect(seek.indexUsed).toBe('PK_orders');
    expect(seek.rowsRemovedByFilter).toBeUndefined();
  });

  it('uses estimates and omits actuals for an estimated-only SHOWPLAN_XML plan', () => {
    const xml = `<?xml version="1.0"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
  <BatchSequence><Batch><Statements>
    <StmtSimple StatementType="SELECT">
      <QueryPlan>
        <RelOp NodeId="0" PhysicalOp="Table Scan" EstimateRows="500" EstimateRowsRead="50000" EstimatedTotalSubtreeCost="2.5">
          <TableScan>
            <Object Database="[db]" Schema="[dbo]" Table="[events]" />
          </TableScan>
        </RelOp>
      </QueryPlan>
    </StmtSimple>
  </Statements></Batch></BatchSequence>
</ShowPlanXML>`;
    const plan = normalizeSqlServerPlan(xml);
    const root = plan.ops[0]!;

    expect(root.kind).toBe('Seq Scan');
    expect(root.table).toBe('events');
    expect(root.estimatedRows).toBe(500);
    expect(root.rowsRemovedByFilter).toBe(49500); // 50000 read - 500 emitted, from estimates
    expect(root.actualRows).toBeUndefined();
    expect(plan.actualTimeMs).toBeUndefined();
    expect(plan.rowsReturned).toBeUndefined();
    expect(plan.totalCostEstimate).toBe(2.5);
  });

  it('returns an empty plan for unrecognized input', () => {
    const plan = normalizeSqlServerPlan('<nonsense />');
    expect(plan.ops).toEqual([]);
    expect(plan.totalCostEstimate).toBeUndefined();
  });
});
