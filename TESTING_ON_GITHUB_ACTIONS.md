# Testing Query Lens on GitHub Actions

This is the **first MVP**. There's no published Marketplace action yet (that's M7) — you test it by running the CLI directly from a workflow. End to end, a run does this:

```
PR opened ─▶ fetch the PR diff ─▶ extract SQL ─▶ EXPLAIN it against your DB
         ─▶ judge the plan ─▶ optimize the slow ones ─▶ post inline PR comments
```

Comments are **advisory only**: the review is posted with `event: COMMENT`, so it never approves, requests changes, or fails the build.

---

## What you need

1. **A target database the runner can reach, with a realistic schema and data.** This is the whole point — `EXPLAIN ANALYZE` on an empty table tells you nothing. Either:
   - a **service container** seeded from a SQL file in the workflow (shown below), or
   - an **external staging DB** reachable from the runner, with its URL in a secret.
   Postgres and SQL Server are supported (`mysql` is not yet).
2. **An AI provider key** → a repo secret. The examples below use Anthropic (`ANTHROPIC_API_KEY`); for Azure OpenAI use `AZURE_API_KEY` and adjust the config. See [AI Providers](README.md#-ai-providers).
3. **The built-in `GITHUB_TOKEN`** — no setup needed, but the job must grant it `pull-requests: write` so it can post the review.

## 1. Add `.query-lens.yml` to the repo root

```yaml
db:
  dialect: postgres
  # Read from an env var by your workflow; do NOT commit a real URL.
  url: ${DATABASE_URL}
thresholds:
  slowQueryMs: 200
  largeTableRows: 10000
llm:
  provider: anthropic   # or "azure" — see AI Providers in the README
```

> The config loader does **not** expand `${...}` for you. Either hard-code a non-secret dev URL, or have the workflow write the real URL into the file / pass it another way. The simplest path is a service container with a fixed, non-secret local URL (next step), since `127.0.0.1` credentials for an ephemeral CI database aren't sensitive.

## 2. Add the workflow

`.github/workflows/query-lens.yml`:

```yaml
name: Query Lens
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write   # required so the job can post the review

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
          DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/app
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # GITHUB_REPOSITORY is set automatically by Actions.
        run: |
          node dist/cli.js review \
            --pr "${{ github.event.pull_request.number }}" \
            --config .query-lens.yml
```

A few notes on the run step:

- `--pr <n>` makes the CLI fetch the diff from the GitHub API and post a review. `GITHUB_TOKEN` and `GITHUB_REPOSITORY` (auto-set by Actions) supply auth and the `owner/repo`. Use `--repo owner/name` to override.
- The CLI reads the DB URL from your config. If you keep `url: ${DATABASE_URL}` in the file you must substitute it before this step; the easy alternative is to hard-code the local service-container URL in `.query-lens.yml` (it's not a secret) and drop the `DATABASE_URL` env entirely.
- Want a dry run without posting? Use `--diff <path>` instead of `--pr` — it runs the whole pipeline and prints to the console only.
- **Using Azure OpenAI?** Swap the secret in the `env:` block from `ANTHROPIC_API_KEY` to `AZURE_API_KEY: ${{ secrets.AZURE_API_KEY }}`, and set `provider: azure` + `resourceName` + deployment names in `.query-lens.yml`. Full config in [AI Providers](README.md#-ai-providers).

## 3. (Optional) `ci/seed.sql`

Make it resemble production cardinalities — that's what surfaces the seq-scans and bad filters the judge looks for:

```sql
CREATE TABLE users (id serial PRIMARY KEY, name text, active boolean);
INSERT INTO users (name, active)
SELECT 'user_' || g, (g % 50 = 0)            -- ~2% active, the rest filtered out
FROM generate_series(1, 20000) AS g;
```

## What a run looks like

- **A query the judge flags** → an inline comment on the exact changed line, with the rule(s) that fired and, when the optimizer finds one, a suggested rewrite or index in a collapsed `<details>` block.
- **A flagged query whose line isn't in the diff** → *skipped*, never posted to a wrong line (precision over recall). You'll see a `skipping …` line in the job log.
- **Nothing flagged** → no review is posted.

## SQL Server instead of Postgres

Swap the service container for `mcr.microsoft.com/mssql/server`, set `db.dialect: sqlserver`, and use an `mssql://user:pass@host:1433/db` URL. Everything downstream (judge, optimizer, reporter) is dialect-agnostic.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `GITHUB_TOKEN is not set` | The run step didn't pass it through `env:`. |
| `GitHub review post failed (403 …)` | The job is missing `permissions: pull-requests: write`. |
| `ECONNREFUSED` / DB connection errors | DB not ready or URL wrong. Check the service `health-cmd` and that the seed step succeeded. |
| Comments never appear, log says `skipping …` | The flagged line isn't an added line in the diff — by design, the reporter won't anchor a comment there. |
| Empty/garbage plans, nothing flagged | The DB has no data. Seed it with production-like volume. |
| `mysql … is not yet supported` | MySQL adapter is deferred (ROADMAP "Out of scope"). Use Postgres or SQL Server. |

## Running it locally first

You don't need Actions to smoke-test the pipeline. Against a local diff file:

```bash
npm run build
node dist/cli.js review --diff some.diff   # console output only, no GitHub calls
```

Or hit a real PR from your machine:

```bash
export ANTHROPIC_API_KEY=...        # your key
export GITHUB_TOKEN=...             # a PAT with repo / pull-requests scope
node dist/cli.js review --pr 123 --repo your-org/your-repo
```
