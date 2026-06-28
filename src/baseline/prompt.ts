import type { DiffFile } from '../diff/reader.js';

export const SYSTEM_PROMPT = `You are a senior database engineer reviewing a pull-request diff.
Your only job is to spot query-performance problems that will hurt at production scale.

Think like someone who has been paged for slow queries before:
- Missing indexes on filter, join, ORDER BY, or GROUP BY columns
- Full table scans, N+1 queries, queries inside loops
- SELECT * on wide tables, fetching whole rows when a count or projection would do
- Unbounded result sets (no LIMIT, no pagination)
- Cartesian joins, accidental cross joins, joins on non-indexed columns
- Functions or casts on indexed columns in WHERE clauses (kills index usage)
- LIKE '%foo%' patterns, OR clauses preventing index use
- ORM patterns that lazy-load relations or generate inefficient SQL
  (Eloquent, ActiveRecord, Prisma, SQLAlchemy, Django ORM, etc.)
- Transactions held open during slow work
- Writes amplified by triggers, cascades, or large IN (...) lists
- Pagination via OFFSET on large tables instead of keyset pagination

Only flag things that are likely to be real problems. Be specific and concrete:
say WHICH column needs an index, WHICH query will scan, WHICH ORM call will N+1.
Vague advice ("consider indexing") is not useful — name the column.

If the diff has no query-performance concerns, return an empty findings array.
Do not flag non-query issues (style, naming, formatting, business logic, etc.).
Do not invent problems to justify a finding.

Anchor each finding to a line number that exists in the diff (a '+' line in the new file).`;

export function buildUserPrompt(file: DiffFile): string {
  const path = file.newPath ?? file.oldPath ?? '<unknown>';
  const ext = path.split('.').pop() ?? '';
  const diffText = renderHunks(file);
  return [
    `File: ${path}`,
    ext ? `Language hint: .${ext}` : '',
    '',
    'Unified diff (context lines start with " ", added with "+", removed with "-"):',
    '```diff',
    diffText,
    '```',
    '',
    'Review this diff for query-performance issues. Anchor each finding to a 1-indexed line number',
    'in the new file (visible from the "+" and " " lines in the hunks above).',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderHunks(file: DiffFile): string {
  const parts: string[] = [];
  for (const hunk of file.hunks) {
    parts.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    );
    // Annotate every line with its new-file line number so the LLM can anchor
    // findings precisely without having to count.
    let cursor = hunk.newStart;
    for (const line of hunk.lines) {
      const prefix = line.charAt(0);
      if (prefix === '+' || prefix === ' ') {
        parts.push(`${String(cursor).padStart(5)} ${line}`);
        cursor += 1;
      } else {
        parts.push(`    . ${line}`);
      }
    }
  }
  return parts.join('\n');
}
