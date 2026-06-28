export const Rules = {
  /**
   * A sequential scan over a large table: the database read every row instead
   * of using an index. On big tables this is the most common cause of a slow
   * query and usually the easiest fix — a missing or unused index.
   */
  seqScanOnLargeTable: 'seq-scan-on-large-table',

  /**
   * Measured execution time crossed the slow threshold. A direct, structure-
   * agnostic signal that something is wrong, and a backstop for slow queries
   * whose plan doesn't trip any of the specific structural rules above.
   */
  slowExecution: 'slow-execution',

  /**
   * The plan scanned far more rows than it kept. A high filter ratio means the
   * database read and threw away most of what it touched — usually fixable with
   * a more selective index so those rows are skipped up front rather than after.
   */
  excessiveRowsFiltered: 'excessive-rows-filtered',

  /** A finding from the LLM judge; not tied to a structural rule, ranked via the verdict's severity. */
  llmReview: 'llm-review',
} as const;

export type RuleName = (typeof Rules)[keyof typeof Rules];
