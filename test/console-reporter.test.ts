import { describe, expect, it } from 'vitest';
import { ConsoleReporter } from '../src/report/console.js';
import type { ExtractedQuery, ReviewResult } from '../src/types.js';

const query = (over: Partial<ExtractedQuery> = {}): ExtractedQuery => ({
  id: 'src/x.ts:10',
  file: 'src/x.ts',
  startLine: 10,
  endLine: 10,
  source: 'raw',
  dialect: 'postgres',
  sql: 'SELECT * FROM users',
  confidence: 0.95,
  codeSpan: 'db.query("SELECT * FROM users")',
  ...over,
});

describe('ConsoleReporter', () => {
  it('prints each failing query with its reasons and a summary', () => {
    const lines: string[] = [];
    const reporter = new ConsoleReporter((l) => lines.push(l));
    const results: ReviewResult[] = [
      {
        query: query(),
        verdict: {
          status: 'fail',
          reasons: [{ rule: 'slow-execution', detail: 'Execution time 300.0ms (threshold 200ms).' }],
        },
      },
      { query: query({ id: 'src/y.ts:5', file: 'src/y.ts', startLine: 5 }), verdict: { status: 'pass' } },
    ];
    reporter.report(results);
    expect(lines).toEqual([
      '✗ src/x.ts:10',
      '  SELECT * FROM users',
      '  - [slow-execution] Execution time 300.0ms (threshold 200ms).',
      '',
      '2 queries analyzed, 1 flagged.',
    ]);
  });

  it('reports a clean summary when nothing is flagged', () => {
    const lines: string[] = [];
    const reporter = new ConsoleReporter((l) => lines.push(l));
    reporter.report([{ query: query(), verdict: { status: 'pass' } }]);
    expect(lines).toEqual(['1 queries analyzed, 0 flagged.']);
  });
});
