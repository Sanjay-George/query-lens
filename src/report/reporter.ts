import type { ReviewResult } from '../types.js';

export interface Reporter {
  report(results: ReviewResult[]): void;
}
