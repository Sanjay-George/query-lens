export interface ReviewComment {
  path: string;
  /** 1-indexed line in the new file. Must be part of the PR diff. */
  line: number;
  side: 'RIGHT';
  body: string;
}

export interface CreateReviewParams {
  owner: string;
  repo: string;
  pullNumber: number;
  body: string;
  comments: ReviewComment[];
}

// The slice of the GitHub REST API the reporter needs. Kept as our own
// interface so the reporter is testable with a plain mock and so we don't pull
// in the whole octokit dependency tree for two endpoints (see DECISIONS §12).
export interface GithubClient {
  fetchPrDiff(owner: string, repo: string, pullNumber: number): Promise<string>;
  createReview(params: CreateReviewParams): Promise<void>;
}

const DEFAULT_API_BASE = 'https://api.github.com';

export function createGithubClient(token: string, apiBase: string = DEFAULT_API_BASE): GithubClient {
  const baseHeaders: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'query-lens',
  };

  return {
    async fetchPrDiff(owner, repo, pullNumber) {
      const res = await fetch(`${apiBase}/repos/${owner}/${repo}/pulls/${pullNumber}`, {
        headers: { ...baseHeaders, accept: 'application/vnd.github.v3.diff' },
      });
      if (!res.ok) {
        throw new Error(`GitHub diff fetch failed (${res.status} ${res.statusText})`);
      }
      return res.text();
    },

    async createReview({ owner, repo, pullNumber, body, comments }) {
      const res = await fetch(`${apiBase}/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
        method: 'POST',
        headers: {
          ...baseHeaders,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
        },
        // event COMMENT keeps this advisory — it never approves or requests changes,
        // and so never blocks the PR (DECISIONS §6).
        body: JSON.stringify({ event: 'COMMENT', body, comments }),
      });
      if (!res.ok) {
        throw new Error(
          `GitHub review post failed (${res.status} ${res.statusText}): ${await res.text()}`,
        );
      }
    },
  };
}
