# Testing Query Lens

Two ways to run Query Lens: **locally** (fastest feedback, no PR needed) and **on GitHub Actions** (posts inline comments on real PRs). Start local, move to Actions when you're happy with the results.

End to end, a run does this:

```
diff ─▶ extract SQL ─▶ EXPLAIN it against your DB
     ─▶ judge the plan ─▶ optimize the slow ones ─▶ report
```

With `--diff` the report goes to the console. With `--pr` it becomes inline PR comments.

---

## Local testing

No PR, no push, no GitHub token required. You only need a local DB and an AI provider key.

### 1. Install the `query-lens` command

Link it globally once so you can call `query-lens` from any directory:

```bash
cd /path/to/query-lens
npm install && npm run build
npm link            # registers a global `query-lens` command
```

> The linked command points at `dist/cli.js`, so re-run `npm run build` here after editing Query Lens source. To unlink later: `npm rm -g query-lens`.

### 2. Add `.query-lens.yml` to the repo you want to review

```yaml
db:
  dialect: sqlserver          # or "postgres"
  url: mssql://sa:Your_Password123@localhost:1433/yourdb
  # Postgres: url: postgres://user:pass@localhost:5432/yourdb
  # SQL Server TLS tip: append ?encrypt=false if you get a self-signed-cert error
llm:
  provider: anthropic         # or "azure" — see AI Providers in README.md
```

### 3. Generate a diff and review it

From the other repo with your branch checked out:

```bash
cd /path/to/other-repo

# Diff your branch vs its base — the same view a PR shows:
git diff main...HEAD > /tmp/changes.diff

# Review (the LLM key is needed even here — extraction + optimizer are LLM calls):
export ANTHROPIC_API_KEY=sk-ant-...
query-lens review --diff /tmp/changes.diff --config .query-lens.yml
```

You'll get a console report: each flagged query, the rule(s) that fired, and any suggested rewrite or index.

A few things worth knowing:

- **Run from the repo root.** The extractor reads your working-tree files (imports, enclosing function) using the paths from the diff. Paths resolve relative to your current directory, so run from the root with the branch checked out. If a file can't be read, it degrades gracefully — less context, never a crash.
- **Only added lines are analyzed.** Commit your SQL changes onto the branch first, or use a plain `git diff` for unstaged changes.
- **The DB is hit for real `EXPLAIN`/showplan.** Seed it with production-like cardinalities — plans on an empty table are meaningless.

### 4. (Optional) See inline PR comments from your laptop

Open a PR on the remote, then run:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GITHUB_TOKEN=...     # PAT with repo + pull-requests scope
query-lens review --pr 123 --repo your-org/your-repo --config .query-lens.yml
```

This fetches the diff from GitHub and posts the review from your machine. Your local DB is still the one being explained.

---

## GitHub Actions

Comments posted to PRs are **advisory only**: the review uses `event: COMMENT`, so it never approves, requests changes, or fails the build.

### What you need

1. **A DB the runner can reach, seeded with realistic data** — `EXPLAIN` on an empty table tells you nothing. Options: a service container seeded in the workflow (shown below), or an external staging DB with its URL in a secret. Postgres and SQL Server are supported; MySQL is not yet.
2. **An AI provider key** in a repo secret. The examples use Anthropic (`ANTHROPIC_API_KEY`); for Azure OpenAI use `AZURE_API_KEY` and adjust the config. See [AI Providers](README.md#-ai-providers).
3. **The built-in `GITHUB_TOKEN`** with `pull-requests: write` permission.

### 1. Add `.query-lens.yml` to the repo root

```yaml
db:
  dialect: postgres
  # Hard-code the service-container URL (not a secret — ephemeral CI credentials):
  url: postgres://postgres:postgres@127.0.0.1:5432/app
thresholds:
  slowQueryMs: 200
  largeTableRows: 10000
llm:
  provider: anthropic   # or "azure" — see AI Providers in README.md
```

### 2. Add the workflow

`.github/workflows/query-lens.yml`:

```yaml
name: Query Lens
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write   # required to post the review

jobs:
  review:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: app
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run build

      # Seed a realistic schema + data so EXPLAIN plans are meaningful.
      - name: Seed database
        env:
          PGPASSWORD: postgres
        run: psql -h 127.0.0.1 -U postgres -d app -f ci/seed.sql

      - name: Review PR
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # GITHUB_REPOSITORY is set automatically by Actions.
        run: |
          node dist/cli.js review \
            --pr "${{ github.event.pull_request.number }}" \
            --config .query-lens.yml
```

Notes:

- `--pr <n>` fetches the diff from the GitHub API and posts the review. `GITHUB_TOKEN` and `GITHUB_REPOSITORY` (auto-set by Actions) supply auth and `owner/repo`. Override the latter with `--repo owner/name` if needed.
- **Using Azure OpenAI?** Swap `ANTHROPIC_API_KEY` for `AZURE_API_KEY: ${{ secrets.AZURE_API_KEY }}` and set `provider: azure` + `resourceName` + deployment names in `.query-lens.yml`. Full config in [AI Providers](README.md#-ai-providers).
- **Using SQL Server?** Swap the service container for `mcr.microsoft.com/mssql/server`, set `db.dialect: sqlserver`, and use an `mssql://user:pass@host:1433/db` URL.

### 3. (Optional) `ci/seed.sql`

Cardinalities matter — that's what surfaces seq-scans and bad filter ratios:

```sql
CREATE TABLE users (id serial PRIMARY KEY, name text, active boolean);
INSERT INTO users (name, active)
SELECT 'user_' || g, (g % 50 = 0)   -- ~2% active, the rest filtered out
FROM generate_series(1, 20000) AS g;
```

### What a run looks like

- **A query the judge flags** → an inline comment on the exact changed line, with the rule(s) that fired and, when the optimizer finds one, a suggested rewrite or index in a collapsed `<details>` block.
- **A flagged query whose line isn't in the diff** → skipped, never anchored to the wrong line. A `skipping …` line appears in the job log.
- **Nothing flagged** → no review is posted.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `GITHUB_TOKEN is not set` | The run step didn't pass it through `env:`. |
| `GitHub review post failed (403 …)` | The job is missing `permissions: pull-requests: write`. |
| `ECONNREFUSED` / DB connection errors | DB not ready or URL wrong. Check the service `health-cmd` and that the seed step ran. |
| TLS error connecting to SQL Server | Append `?encrypt=false` (or `?trustServerCertificate=true`) to the URL. |
| Comments never appear, log says `skipping …` | The flagged line isn't an added line in the diff — by design, the reporter won't anchor there. |
| Nothing flagged, plans look empty | The DB has no data. Seed it with production-like volume. |
| `mysql … is not yet supported` | MySQL is deferred (see ROADMAP). Use Postgres or SQL Server. |
