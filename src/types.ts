import type { RuleName } from './judge/rules.js';

export type Dialect = 'postgres' | 'mysql' | 'sqlserver';

export type QuerySource =
  | 'raw'
  | 'eloquent'
  | 'prisma'
  | 'sqlalchemy'
  | 'typeorm'
  | 'drizzle'
  | 'sequelize'
  | 'django';

export interface ExtractedQuery {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  source: QuerySource;
  dialect: Dialect;
  sql: string;
  confidence: number;
  codeSpan: string;
}

export interface PlanNode {
  kind: string;
  table?: string;
  indexUsed?: string;
  estimatedRows?: number;
  actualRows?: number;
  actualTimeMs?: number;
  rowsRemovedByFilter?: number;
  children: PlanNode[];
}

export interface NormalizedPlan {
  totalCostEstimate?: number;
  actualTimeMs?: number;
  rowsReturned?: number;
  ops: PlanNode[];
  raw: unknown;
}

export interface Reason {
  rule: RuleName;
  detail: string;
}

/** Production-impact criticality, assigned by the LLM judge (and the composite). */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Suggestion {
  rationale: string;
  rewrittenSql?: string;
  indexHints?: string[];
}

// Unified output of every Judge. Heuristic emits only reasons; the LLM judge
// adds severity + suggestion; the composite carries whatever both produced.
export type Verdict =
  | { status: 'pass' }
  | {
      status: 'fail';
      reasons: Reason[];
      /** Overall criticality. Absent on heuristic-only verdicts. */
      severity?: Severity;
      /** A concrete fix, when a judge can offer one. */
      suggestion?: Suggestion;
    };

export interface ReviewResult {
  query: ExtractedQuery;
  plan?: NormalizedPlan;
  verdict: Verdict;
}
