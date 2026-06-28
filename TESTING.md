# Testing Query Lens

Run it **locally** (`--diff`, console output) or **on GitHub Actions** (`--pr`, inline comments).

Pipeline: `diff → extract SQL → EXPLAIN (if DB wired) → judge (heuristic + LLM) → report`.

## Local

Needs an AI provider key (and a seeded local DB for plan-grounded judging).

```bash
# 1. Link the CLI (re-run `npm run build` after editing source)
npm install && npm run build && npm link

# 2. In the repo you want to review, add .query-lens.yml:
#    db:  { dialect: postgres, url: postgres://user:pass@localhost:5432/db }
#    llm: { provider: anthropic }   # or azure — see README

# 3. Diff your branch and review it
git diff main...HEAD > /tmp/changes.diff
export ANTHROPIC_API_KEY=sk-ant-...
query-lens review --diff /tmp/changes.diff --config .query-lens.yml
```

Notes:
- **Run from the repo root** with the branch checked out — the extractor reads working-tree files via diff paths (degrades gracefully if missing).
- **Only added lines are analyzed.** Commit your changes first.
- **Seed the DB with realistic cardinalities** — plans on empty tables are meaningless. Without a DB the LLM judge still reviews from the SQL alone.

To post inline comments from your laptop, open a PR and add `GITHUB_TOKEN`, then use `--pr 123 --repo org/repo`.

## GitHub Actions

Comments are advisory only (`event: COMMENT` — never blocks the build). You need: a DB the runner can reach **seeded with realistic data**, an AI key in a secret, and `GITHUB_TOKEN` with `pull-requests: write`.

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
      # Optional step: Seed database. Alternatively, point to existing DB or skip.
      # - name: Seed database
      #   env: { PGPASSWORD: postgres }
      #   run: psql -h 127.0.0.1 -U postgres -d app -f ci/seed.sql
      - name: Review PR
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node dist/cli.js review --pr "${{ github.event.pull_request.number }}" --config .query-lens.yml
```

Matching `.query-lens.yml`: `db.url: postgres://postgres:postgres@127.0.0.1:5432/app`.

- **Azure?** Use `AZURE_API_KEY` and set `provider: azure` + `resourceName` + deployment names (README).
- **SQL Server?** Use the `mcr.microsoft.com/mssql/server` container, `dialect: sqlserver`, `mssql://...` URL.

A flagged query → an inline comment on the changed line (severity, reasons, and a suggested rewrite/index in a `<details>`). Unanchored findings are skipped; nothing flagged → no review posted.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `GITHUB_TOKEN is not set` | Not passed through `env:`. |
| `403` posting review | Missing `permissions: pull-requests: write`. |
| `ECONNREFUSED` / DB errors | DB not ready or URL wrong; check `health-cmd` and seed step. |
| TLS error (SQL Server) | Append `?encrypt=false` or `?trustServerCertificate=true`. |
| Comments never appear, log says `skipping …` | Flagged line isn't an added line — won't anchor there by design. |
| Nothing flagged, plans empty | DB has no data — seed it. |
| `mysql … not yet supported` | Deferred; use Postgres or SQL Server. |
