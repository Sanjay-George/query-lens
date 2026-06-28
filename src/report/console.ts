import type { ReviewResult } from '../types.js';
import type { Reporter } from './reporter.js';

type Sink = (line: string) => void;

export class ConsoleReporter implements Reporter {
  // eslint-disable-next-line no-console
  constructor(private readonly sink: Sink = console.log) {}

  report(results: ReviewResult[]): void {
    const failed = results.filter((r) => r.verdict.status === 'fail');

    for (const r of failed) {
      // verdict.status === 'fail' is guaranteed by the filter above.
      const verdict = r.verdict.status === 'fail' ? r.verdict : null;
      const reasons = verdict?.reasons ?? [];
      const sev = verdict?.severity ? `[${verdict.severity.toUpperCase()}] ` : '';
      this.sink(`✗ ${sev}${r.query.file}:${r.query.startLine}`);
      this.sink(`  ${r.query.sql}`);
      for (const reason of reasons) {
        this.sink(`  - [${reason.rule}] ${reason.detail}`);
      }
      if (verdict?.suggestion) {
        this.sink(`  ↳ suggestion: ${verdict.suggestion.rationale}`);
      }
      this.sink('');
    }

    this.sink(`${results.length} queries analyzed, ${failed.length} flagged.`);
  }
}
