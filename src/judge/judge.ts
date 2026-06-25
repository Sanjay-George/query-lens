import type { NormalizedPlan, Verdict } from '../types.js';
import type { Thresholds } from '../config.js';

export interface Judge {
  judge(plan: NormalizedPlan, thresholds: Thresholds): Verdict;
}
