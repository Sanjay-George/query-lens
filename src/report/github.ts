import { parseUnifiedDiff } from '../diff/reader.js';
import type { ReviewResult, Suggestion } from '../types.js';
import type { Reporter } from './reporter.js';
import type { GithubClient, ReviewComment } from './github-client.js';

export interface GithubTarget {
  owner: string;
  repo: string;
  pullNumber: number;
  /** The unified diff under review — used to verify line anchors before posting. */
  diffText: string;
}

type Log = (line: string) => void;

// Posts one inline PR review comment per failing query. Refuses to post any
// comment whose line can't be anchored to an added line in the diff — GitHub
// would reject it anyway, and a misanchored comment is worse than silence
// (precision over recall, DECISIONS §5/§9).
export class GithubReporter implements Reporter {
  constructor(
    private readonly client: GithubClient,
    private readonly target: GithubTarget,
    private readonly log: Log = () => {},
  ) {}

  async report(results: ReviewResult[]): Promise<void> {
    const anchors = commentableAnchors(this.target.diffText);
    const comments: ReviewComment[] = [];
    let skipped = 0;

    for (const r of results) {
      if (r.verdict.status !== 'fail') continue;
      const anchor = `${r.query.file}:${r.query.startLine}`;
      if (!anchors.has(anchor)) {
        this.log(`skipping ${anchor}: line not present in the diff, cannot anchor a comment`);
        skipped += 1;
        continue;
      }
      comments.push({
        path: r.query.file,
        line: r.query.startLine,
        side: 'RIGHT',
        body: renderBody(r),
      });
    }

    if (comments.length === 0) {
      this.log(`nothing to post: ${skipped} finding(s) could not be anchored to the diff.`);
      return;
    }

    await this.client.createReview({
      owner: this.target.owner,
      repo: this.target.repo,
      pullNumber: this.target.pullNumber,
      body: summaryBody(comments.length, skipped),
      comments,
    });
    this.log(`posted ${comments.length} comment(s)${skipped > 0 ? `, skipped ${skipped}` : ''}.`);
  }
}

/** The `file:line` anchors GitHub will accept a RIGHT-side comment on — the added lines. */
function commentableAnchors(diffText: string): Set<string> {
  const anchors = new Set<string>();
  for (const file of parseUnifiedDiff(diffText)) {
    if (!file.newPath) continue;
    for (const hunk of file.hunks) {
      for (const added of hunk.addedLines) {
        anchors.add(`${file.newPath}:${added.lineNumber}`);
      }
    }
  }
  return anchors;
}

function renderBody(r: ReviewResult): string {
  const verdict = r.verdict.status === 'fail' ? r.verdict : null;
  const reasons = verdict?.reasons ?? [];
  const heading = verdict?.severity
    ? `**Query Lens — potential slow query (${verdict.severity.toUpperCase()})**`
    : '**Query Lens — potential slow query**';
  const lines = [
    heading,
    '',
    '```sql',
    r.query.sql,
    '```',
    '',
    ...reasons.map((reason) => `- \`${reason.rule}\`: ${reason.detail}`),
  ];
  if (verdict?.suggestion) {
    lines.push('', renderSuggestion(verdict.suggestion));
  }
  lines.push('', '_Advisory only — Query Lens never fails the build._');
  return lines.join('\n');
}

function renderSuggestion(s: Suggestion): string {
  const inner = [s.rationale];
  if (s.rewrittenSql) {
    inner.push('', '```sql', s.rewrittenSql, '```');
  }
  if (s.indexHints && s.indexHints.length > 0) {
    inner.push('', '**Index hints:**', ...s.indexHints.map((h) => `- \`${h}\``));
  }
  return ['<details>', '<summary>Suggested optimization</summary>', '', ...inner, '', '</details>'].join('\n');
}

function summaryBody(posted: number, skipped: number): string {
  const parts = [`Query Lens flagged ${posted} quer${posted === 1 ? 'y' : 'ies'} that may be slow.`];
  if (skipped > 0) {
    parts.push(`${skipped} finding(s) were omitted because their lines aren't in the diff.`);
  }
  return parts.join(' ');
}
