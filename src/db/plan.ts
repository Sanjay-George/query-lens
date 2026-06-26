import type { NormalizedPlan, PlanNode } from '../types.js';

// Dialect-agnostic helpers over a NormalizedPlan. The per-dialect normalizers
// (normalize-postgres, normalize-sqlserver) all produce the same PlanNode tree,
// so anything that walks that tree lives here rather than in one dialect's file.

export function flattenPlan(plan: NormalizedPlan): PlanNode[] {
  const out: PlanNode[] = [];
  const walk = (n: PlanNode): void => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const op of plan.ops) walk(op);
  return out;
}
