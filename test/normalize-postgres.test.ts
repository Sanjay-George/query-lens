import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizePostgresPlan, flattenPlan } from '../src/db/normalize-postgres.js';

const fixtureUrl = new URL('./fixtures/plans/seq-scan-filter.json', import.meta.url);

describe('normalizePostgresPlan', () => {
  it('flattens a captured EXPLAIN (ANALYZE, FORMAT JSON) plan', async () => {
    const json = JSON.parse(await readFile(fileURLToPath(fixtureUrl), 'utf8'));
    const plan = normalizePostgresPlan(json);

    expect(plan.ops).toHaveLength(1);
    const root = plan.ops[0]!;
    expect(root.kind).toBe('Seq Scan');
    expect(root.table).toBe('users');
    expect(root.estimatedRows).toBe(400);
    expect(root.actualRows).toBe(400);
    expect(root.rowsRemovedByFilter).toBe(19600);
    expect(root.actualTimeMs).toBeGreaterThan(0);

    expect(plan.totalCostEstimate).toBeGreaterThan(0);
    expect(plan.actualTimeMs).toBe(root.actualTimeMs);
    expect(plan.rowsReturned).toBe(400);
  });

  it('returns an empty plan for unrecognized input', () => {
    const plan = normalizePostgresPlan({ nonsense: true });
    expect(plan.ops).toEqual([]);
    expect(plan.totalCostEstimate).toBeUndefined();
  });

  it('flattens nested child nodes depth-first', () => {
    const json = [
      {
        Plan: {
          'Node Type': 'Hash Join',
          'Actual Total Time': 5,
          Plans: [
            { 'Node Type': 'Seq Scan', 'Relation Name': 'a', Plans: [] },
            { 'Node Type': 'Index Scan', 'Index Name': 'b_pkey' },
          ],
        },
      },
    ];
    const flat = flattenPlan(normalizePostgresPlan(json));
    expect(flat.map((n) => n.kind)).toEqual(['Hash Join', 'Seq Scan', 'Index Scan']);
    expect(flat[2]!.indexUsed).toBe('b_pkey');
  });
});
