import type { ExtractedQuery, NormalizedPlan } from '../types.js';

export interface DbAdapter {
  /** Run EXPLAIN for the query and return its normalized plan. Never mutates. */
  analyze(query: ExtractedQuery): Promise<NormalizedPlan>;
  close(): Promise<void>;
}
