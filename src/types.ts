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
  rule: string;
  detail: string;
}

export type Verdict =
  | { status: 'pass' }
  | { status: 'fail'; reasons: Reason[] };

export interface Suggestion {
  rationale: string;
  rewrittenSql?: string;
  indexHints?: string[];
}

export interface ReviewResult {
  query: ExtractedQuery;
  plan?: NormalizedPlan;
  verdict: Verdict;
  suggestion?: Suggestion;
}
