import type { ExtractedQuery, NormalizedPlan, Verdict } from '../types.js';
import type { Thresholds } from '../config.js';

export interface JudgeInput {
  query: ExtractedQuery;
  /** The normalized plan for the query, if available. Not mandatory for LLM judges*/
  plan?: NormalizedPlan;
  thresholds: Thresholds;
}

export interface Judge {
  judge(input: JudgeInput): Promise<Verdict>;
}
