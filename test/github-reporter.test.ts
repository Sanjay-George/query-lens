import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GithubReporter } from '../src/report/github.js';
import type { CreateReviewParams, GithubClient } from '../src/report/github-client.js';
import type { ExtractedQuery, ReviewResult, Suggestion } from '../src/types.js';

let DIFF: string;
beforeAll(async () => {
  DIFF = await readFile(
    fileURLToPath(new URL('./fixtures/diffs/add-user-query.diff', import.meta.url)),
    'utf8',
  );
});

class FakeGithub implements GithubClient {
  reviews: CreateReviewParams[] = [];
  fetchPrDiff(): Promise<string> {
    throw new Error('not used in reporter tests');
  }
  async createReview(params: CreateReviewParams): Promise<void> {
    this.reviews.push(params);
  }
}

function failing(startLine: number, suggestion?: Suggestion): ReviewResult {
  const query: ExtractedQuery = {
    id: `src/users-repo.ts:${startLine}`,
    file: 'src/users-repo.ts',
    startLine,
    endLine: startLine + 2,
    source: 'raw',
    dialect: 'postgres',
    sql: 'SELECT * FROM users WHERE active = true',
    confidence: 0.95,
    codeSpan: 'pool.query(...)',
  };
  return {
    query,
    verdict: {
      status: 'fail',
      reasons: [{ rule: 'excessive-rows-filtered', detail: 'Filter discarded 19600/20000 rows scanned (98%).' }],
      ...(suggestion ? { suggestion } : {}),
    },
  };
}

const target = (diffText: string) => ({ owner: 'acme', repo: 'app', pullNumber: 7, diffText });

describe('GithubReporter', () => {
  it('posts one anchored comment per failing query with the suggestion in a details block', async () => {
    const gh = new FakeGithub();
    const logs: string[] = [];
    const suggestion: Suggestion = {
      rationale: 'Add a partial index.',
      indexHints: ['CREATE INDEX idx_users_active ON users (active) WHERE active = true;'],
    };
    // Line 4 is an added line in the diff (the `pool.query(` call).
    await new GithubReporter(gh, target(DIFF), (l) => logs.push(l)).report([failing(4, suggestion)]);

    expect(gh.reviews).toHaveLength(1);
    const review = gh.reviews[0]!;
    expect(review).toMatchObject({ owner: 'acme', repo: 'app', pullNumber: 7 });
    expect(review.comments).toHaveLength(1);

    const comment = review.comments[0]!;
    expect(comment.path).toBe('src/users-repo.ts');
    expect(comment.line).toBe(4);
    expect(comment.side).toBe('RIGHT');
    expect(comment.body).toContain('excessive-rows-filtered');
    expect(comment.body).toContain('SELECT * FROM users WHERE active = true');
    expect(comment.body).toContain('<details>');
    expect(comment.body).toContain('CREATE INDEX idx_users_active');
    expect(comment.body).toContain('Advisory only');
  });

  it('refuses to post a comment whose line is not in the diff', async () => {
    const gh = new FakeGithub();
    const logs: string[] = [];
    // Line 99 is not present in the diff — must be skipped, not anchored elsewhere.
    await new GithubReporter(gh, target(DIFF), (l) => logs.push(l)).report([failing(99)]);

    expect(gh.reviews).toHaveLength(0);
    expect(logs.join('\n')).toMatch(/skipping src\/users-repo\.ts:99/);
  });

  it('posts the anchorable findings and notes the skipped ones in the summary', async () => {
    const gh = new FakeGithub();
    await new GithubReporter(gh, target(DIFF)).report([failing(4), failing(99)]);

    expect(gh.reviews).toHaveLength(1);
    expect(gh.reviews[0]!.comments).toHaveLength(1);
    expect(gh.reviews[0]!.comments[0]!.line).toBe(4);
    expect(gh.reviews[0]!.body).toMatch(/omitted/);
  });

  it('does not post when there are no failing queries', async () => {
    const gh = new FakeGithub();
    const passing: ReviewResult = {
      query: failing(4).query,
      verdict: { status: 'pass' },
    };
    await new GithubReporter(gh, target(DIFF)).report([passing]);
    expect(gh.reviews).toHaveLength(0);
  });
});
