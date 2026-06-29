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
  const lines: string[] = [];
  if (verdict?.severity) {
    lines.push(severityBadge(verdict.severity), '');
  }
  lines.push(
    '**Query Lens — potential slow query**',
    '',
    '```sql',
    r.query.sql,
    '```',
    '',
    ...reasons.map((reason) => `- \`${reason.rule}\`: ${reason.detail}`),
  );
  if (verdict?.suggestion) {
    lines.push('', renderSuggestion(verdict.suggestion));
  }
  return lines.join('\n');
}

// Light tints with auto-picked dark text for a soft, modern badge look.
// True outlined borders aren't achievable — GitHub strips inline CSS from
// markdown, so we lean on shields.io's luminance-based text-color picking.
const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'FECACA',
  HIGH: 'FECACA',
  MEDIUM: 'FDE68A',
  LOW: 'BFDBFE',
};

function severityBadge(severity: string): string {
  const label = severity.toUpperCase();
  const color = SEVERITY_COLORS[label] ?? 'E5E7EB';
  // %20 padding around the label gives the pill extra horizontal breathing room.
  return `<img align="right" src="https://img.shields.io/badge/%20${label}%20-${color}?style=flat-square" alt="${label}" />`;
}

function renderSuggestion(s: Suggestion): string {
  // Each value must be split into individual lines before prefixing — multi-line
  // strings inside a `>` blockquote escape the [!TIP] alert if any line lacks the prefix.
  const inner: string[] = s.rationale.split('\n');
  if (s.rewrittenSql) {
    inner.push('', '```sql', ...s.rewrittenSql.split('\n'), '```');
  }
  if (s.indexHints && s.indexHints.length > 0) {
    inner.push('', '**Index hints:**', ...s.indexHints.map((h) => `- \`${h}\``));
  }
  // Nest <details> *inside* the [!TIP] alert (not the other way around) — GitHub
  // won't render `[!TIP]` if it isn't the first line of a top-level blockquote.
  const body = ['<details>', '<summary>Suggested optimization</summary>', '', ...inner, '', '</details>'];
  const quoted = body.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');
  return `> [!TIP]\n${quoted}`;
}

function summaryBody(posted: number, skipped: number): string {
  const parts = [`Query Lens flagged ${posted} quer${posted === 1 ? 'y' : 'ies'} that may be slow.`];
  if (skipped > 0) {
    parts.push(`${skipped} finding(s) were omitted because their lines aren't in the diff.`);
  }
  return parts.join(' ');
}
