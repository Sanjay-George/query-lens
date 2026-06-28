import { describe, expect, it } from 'vitest';
import { HeuristicJudge } from '../src/judge/heuristic.js';
import type { ExtractedQuery, NormalizedPlan, PlanNode } from '../src/types.js';
import type { Thresholds } from '../src/config.js';

const thresholds: Thresholds = {
  slowQueryMs: 200,
  largeTableRows: 10_000,
  maxQueriesPerPr: 20,
  minExtractorConfidence: 0.7,
  rowsFilteredRatio: 0.9,
};

const judge = new HeuristicJudge();

const query: ExtractedQuery = {
  id: 'src/x.ts:1',
  file: 'src/x.ts',
  startLine: 1,
  endLine: 1,
  source: 'raw',
  dialect: 'postgres',
  sql: 'SELECT 1',
  confidence: 1,
  codeSpan: 'db.query("SELECT 1")',
};

function plan(root: PlanNode, overrides: Partial<NormalizedPlan> = {}): NormalizedPlan {
  return { ops: [root], raw: null, ...overrides };
}

const node = (over: Partial<PlanNode> = {}): PlanNode => ({ kind: 'Result', children: [], ...over });

const run = (p?: NormalizedPlan) => judge.judge({ query, thresholds, ...(p ? { plan: p } : {}) });

describe('HeuristicJudge', () => {
  it('passes a clean plan', async () => {
    const p = plan(node({ kind: 'Index Scan', actualRows: 5 }), { actualTimeMs: 10 });
    expect(await run(p)).toEqual({ status: 'pass' });
  });

  it('abstains (passes) when no plan is available', async () => {
    expect(await run()).toEqual({ status: 'pass' });
  });

  it('fails on a single rule: seq scan on large table', async () => {
    const p = plan(node({ kind: 'Seq Scan', table: 'users', actualRows: 10_000 }), {
      actualTimeMs: 10,
    });
    const v = await run(p);
    expect(v.status).toBe('fail');
    expect(v.status === 'fail' && v.reasons.map((r) => r.rule)).toEqual([
      'seq-scan-on-large-table',
    ]);
  });

  it('does not assign a severity (ranking is the LLM judge job)', async () => {
    const p = plan(node({ kind: 'Seq Scan', table: 'users', actualRows: 10_000 }));
    const v = await run(p);
    expect(v.status === 'fail' && v.severity).toBeUndefined();
  });

  it('fails on a single rule: slow execution', async () => {
    const p = plan(node({ kind: 'Index Scan', actualRows: 1 }), { actualTimeMs: 200 });
    const v = await run(p);
    expect(v.status === 'fail' && v.reasons.map((r) => r.rule)).toEqual(['slow-execution']);
  });

  it('fails on a single rule: excessive rows filtered', async () => {
    const p = plan(
      node({ kind: 'Seq Scan', actualRows: 10, rowsRemovedByFilter: 90 }),
      { actualTimeMs: 5 },
    );
    const v = await run(p);
    expect(v.status === 'fail' && v.reasons.map((r) => r.rule)).toEqual([
      'excessive-rows-filtered',
    ]);
  });

  it('accumulates multiple reasons when several rules fail', async () => {
    const p = plan(
      node({ kind: 'Seq Scan', table: 't', actualRows: 10_000, rowsRemovedByFilter: 1_000_000 }),
      { actualTimeMs: 500 },
    );
    const v = await run(p);
    expect(v.status === 'fail' && v.reasons.map((r) => r.rule).sort()).toEqual([
      'excessive-rows-filtered',
      'seq-scan-on-large-table',
      'slow-execution',
    ]);
  });

  it('uses estimatedRows for seq scan when actualRows is absent', async () => {
    const p = plan(node({ kind: 'Seq Scan', estimatedRows: 50_000 }));
    const v = await run(p);
    expect(v.status).toBe('fail');
  });

  it('does not flag a small seq scan or a sub-threshold filter', async () => {
    const p = plan(
      node({ kind: 'Seq Scan', actualRows: 100, rowsRemovedByFilter: 100 }),
      { actualTimeMs: 50 },
    );
    expect(await run(p)).toEqual({ status: 'pass' });
  });

  it('inspects nested child nodes', async () => {
    const p = plan(
      node({
        kind: 'Hash Join',
        actualRows: 5,
        children: [node({ kind: 'Seq Scan', table: 'big', actualRows: 20_000 })],
      }),
      { actualTimeMs: 5 },
    );
    expect((await run(p)).status).toBe('fail');
  });

  it('boundary: filter ratio exactly at threshold fails', async () => {
    const p = plan(node({ kind: 'Seq Scan', actualRows: 10, rowsRemovedByFilter: 90 }));
    // 90 / 100 = 0.9 === threshold
    expect((await run(p)).status).toBe('fail');
  });
});
