import type { NormalizedPlan, PlanNode, Reason, Verdict } from '../types.js';
import type { Thresholds } from '../config.js';
import { flattenPlan } from '../db/plan.js';
import type { Judge, JudgeInput } from './judge.js';
import { Rules } from './rules.js';

/**
 * Heuristic judge that evaluates query plans against a set of configurable thresholds.
 * Execution plan is mandatory for this judge; if no plan is provided, it returns a "pass" verdict to defer to the LLM judge.
 */
export class HeuristicJudge implements Judge {
  async judge({ plan, thresholds }: JudgeInput): Promise<Verdict> {
    if (!plan) return { status: 'pass' };
    const nodes = flattenPlan(plan);
    const reasons: Reason[] = [];

    const seqScan = seqScanOnLargeTable(nodes, thresholds.largeTableRows);
    if (seqScan) reasons.push(seqScan);

    const slow = slowExecution(plan, thresholds.slowQueryMs);
    if (slow) reasons.push(slow);

    const filtered = excessiveRowsFiltered(nodes, thresholds.rowsFilteredRatio);
    if (filtered) reasons.push(filtered);

    return reasons.length > 0 ? { status: 'fail', reasons } : { status: 'pass' };
  }
}

function seqScanOnLargeTable(nodes: PlanNode[], largeTableRows: number): Reason | null {
  for (const n of nodes) {
    if (n.kind !== 'Seq Scan') continue;
    const rows = n.actualRows ?? n.estimatedRows;
    if (rows !== undefined && rows >= largeTableRows) {
      const where = n.table ? ` on "${n.table}"` : '';
      return {
        rule: Rules.seqScanOnLargeTable,
        detail: `Sequential scan${where} over ${rows} rows (threshold ${largeTableRows}).`,
      };
    }
  }
  return null;
}

function slowExecution(plan: NormalizedPlan, slowQueryMs: number): Reason | null {
  if (plan.actualTimeMs !== undefined && plan.actualTimeMs >= slowQueryMs) {
    return {
      rule: Rules.slowExecution,
      detail: `Execution time ${plan.actualTimeMs.toFixed(1)}ms (threshold ${slowQueryMs}ms).`,
    };
  }
  return null;
}

function excessiveRowsFiltered(nodes: PlanNode[], ratioThreshold: number): Reason | null {
  for (const n of nodes) {
    const removed = n.rowsRemovedByFilter;
    if (removed === undefined) continue;
    const kept = n.actualRows ?? 0;
    const scanned = removed + kept;
    if (scanned === 0) continue;
    const ratio = removed / scanned;
    if (ratio >= ratioThreshold) {
      return {
        rule: Rules.excessiveRowsFiltered,
        detail: `Filter discarded ${removed}/${scanned} rows scanned (${(ratio * 100).toFixed(0)}%, threshold ${(ratioThreshold * 100).toFixed(0)}%).`,
      };
    }
  }
  return null;
}
