# Testing

Pipeline: `diff → extract SQL → EXPLAIN (if DB reachable) → judge (heuristic + LLM) → report`.

Every run needs an AI provider key and a `.query-lens.yml`. Minimal config:

```yaml
db:
  dialect: postgres
  url: postgres://app:${DB_PASSWORD}@localhost:5432/mydb   # ${VAR} pulled from env
llm:
  provider: anthropic
  models:
    small: claude-haiku-4-5
    large: claude-opus-4-8
```

`db.url` supports `${VAR}` env-var substitution so credentials stay out of the committed file
(a whole-URL form like `url: ${DATABASE_URL}` works too).

The `db` block is required by the schema. If the DB is unreachable the judge falls back to
reviewing from the SQL text alone — but plans are where the real signal is, so seed it with
**realistic row counts** (an empty DB gives meaningless plans). 
`docker-compose.yml` contains postgres and sql server images to quickly get started.

> **Tip:** Run `npm link` to put a `query-lens` binary on your PATH so you can run it from any repo.
> Re-run `npm run build` before `query-lens` if you used `npm link`.

---

## 1. Local, from a diff file — fastest, no GitHub

The quickest loop. Reviews a unified diff and prints findings to the console.

```bash
# Any git repo with query changes
git diff main...HEAD > /tmp/changes.diff      # commit first — only added lines are analyzed
export ANTHROPIC_API_KEY=sk-ant-...

# This repo
npm run dev -- review --diff /tmp/changes.diff --config .query-lens.yml
```


## 2. Local, against a real PR (uses Github reporter)

Same pipeline, but fetches the diff from the GitHub API and posts inline comments back to the PR.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GITHUB_TOKEN=ghp_...        # needs pull-requests: write to post comments

npm run dev -- review --pr 123 --repo org/repo --config .query-lens.yml
```

`--repo` defaults to `$GITHUB_REPOSITORY` if set. 

## 3. GitHub Actions, on a test repo

Drop this workflow into a **target repository** and open a PR there. Add `ANTHROPIC_API_KEY`
as a repo secret; `GITHUB_TOKEN` is provided automatically.

> ⚠️ WIP

```yaml
# .github/workflows/query-lens.yml
name: Query Lens
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: app }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build
 
      - name: Review PR
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node dist/cli.js review --pr "${{ github.event.pull_request.number }}" --config .query-lens.yml
```


## 4. Troubleshooting

| Symptom | Cause |
|---|---|
| `Config file not found` | Wrong `--config` path, or not running from the repo root. |
| `GITHUB_TOKEN is not set` | Not exported (local) or not passed through `env:` (Actions). |
| `403` posting review | Missing `permissions: pull-requests: write`. |
| `ECONNREFUSED` / DB errors | DB not up or URL wrong; check the container and the `url`. |
| TLS error (SQL Server) | Append `?encrypt=false` or `?trustServerCertificate=true` to the URL. |
| Comments never appear, log says `skipping …` | Flagged line isn't an added line — won't anchor there by design. |
| Nothing flagged, plans empty | DB has no data — seed it with realistic cardinalities. |
| `mysql … not yet supported` | Deferred; use Postgres or SQL Server. |
