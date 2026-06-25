import type { NormalizedPlan, PlanNode } from '../types.js';

// Shape of a single entry in Postgres `EXPLAIN (FORMAT JSON)` output. Only the
// fields we read are typed; the rest pass through into `raw`.
interface PgPlan {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Plan Rows'?: number;
  'Actual Rows'?: number;
  'Actual Total Time'?: number;
  'Total Cost'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PgPlan[];
}

interface PgExplainRoot {
  Plan: PgPlan;
}

export function normalizePostgresPlan(explainJson: unknown): NormalizedPlan {
  const root = extractRootPlan(explainJson);
  const ops = root ? [toNode(root)] : [];
  const plan: NormalizedPlan = { ops, raw: explainJson };
  if (root) {
    if (root['Total Cost'] !== undefined) plan.totalCostEstimate = root['Total Cost'];
    if (root['Actual Total Time'] !== undefined) plan.actualTimeMs = root['Actual Total Time'];
    if (root['Actual Rows'] !== undefined) plan.rowsReturned = root['Actual Rows'];
  }
  return plan;
}

// `EXPLAIN (FORMAT JSON)` returns an array with a single `{ Plan: ... }` object.
function extractRootPlan(json: unknown): PgPlan | null {
  const container = Array.isArray(json) ? json[0] : json;
  if (
    container &&
    typeof container === 'object' &&
    'Plan' in container &&
    (container as PgExplainRoot).Plan
  ) {
    return (container as PgExplainRoot).Plan;
  }
  return null;
}

function toNode(pg: PgPlan): PlanNode {
  const node: PlanNode = {
    kind: pg['Node Type'],
    children: (pg.Plans ?? []).map(toNode),
  };
  if (pg['Relation Name'] !== undefined) node.table = pg['Relation Name'];
  if (pg['Index Name'] !== undefined) node.indexUsed = pg['Index Name'];
  if (pg['Plan Rows'] !== undefined) node.estimatedRows = pg['Plan Rows'];
  if (pg['Actual Rows'] !== undefined) node.actualRows = pg['Actual Rows'];
  if (pg['Actual Total Time'] !== undefined) node.actualTimeMs = pg['Actual Total Time'];
  if (pg['Rows Removed by Filter'] !== undefined) {
    node.rowsRemovedByFilter = pg['Rows Removed by Filter'];
  }
  return node;
}

export function flattenPlan(plan: NormalizedPlan): PlanNode[] {
  const out: PlanNode[] = [];
  const walk = (n: PlanNode): void => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const op of plan.ops) walk(op);
  return out;
}
