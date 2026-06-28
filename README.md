<table><tr>
  <td><img src="assets/icon.svg" alt="Query Lens logo" width="48" height="48" /></td>
  <td><h1>Query Lens</h1></td>
</tr></table>


> ⚠️ Early-stage WIP

A CI tool that flags potentially slow SQL in pull requests. It pulls queries out of a PR diff (raw SQL, ORM code, query builders), judges them for performance — with a heuristic plan check when a DB is wired and an LLM acting as a senior DB engineer — and posts inline review comments.

Supports Postgres and SQL Server (MySQL planned). Raw-SQL extraction works now; Eloquent, Prisma, and SQLAlchemy planned.

<img src="assets/example-review.svg" alt="Query Lens posting an inline review comment on a SQL query, citing the SQL Server execution plan: a clustered index scan, a tempdb sort spill, and a missing-index suggestion." width="820" />


## Quick start

Requires Node 20+ and an AI provider key (Anthropic default, or Azure OpenAI) — only needed when running against real PRs.

```bash
npm install
npm run typecheck

# Run the CLI from source (no build needed):
npm run dev -- review --help

# Console-only review of a saved diff:
node dist/cli.js review --diff some.diff        # after `npm run build`

# Review a real PR and post comments (needs provider key + GITHUB_TOKEN):
node dist/cli.js review --pr 123 --repo your-org/your-repo
```

See **[TESTING.md](TESTING.md)** for local + CI setup.

## AI Providers

One `LlmClient` interface, provider chosen in config. The extractor runs on a cheap `small` tier, the LLM judge on a stronger `large` tier. Keys come from the **environment, never config**. Adding a provider = one `case` in [factory.ts](src/llm/factory.ts) (DECISIONS §7).

| Provider | `llm.provider` | Key (env) | Extra |
|---|---|---|---|
| Anthropic *(default)* | `anthropic` | `ANTHROPIC_API_KEY` | none |
| Azure OpenAI | `azure` | `AZURE_API_KEY` | `resourceName` + per-tier deployment names |

```yaml
# Anthropic — defaults to claude-haiku-4-5 (small) / claude-opus-4-8 (large)
llm:
  provider: anthropic
  models:               # optional
    small: claude-haiku-4-5-20251001
    large: claude-opus-4-8

# Azure — deployment names required (no defaults)
llm:
  provider: azure
  resourceName: my-azure-resource
  models:
    small: my-gpt-4o-mini-deployment
    large: my-gpt-4o-deployment
```

## Configuration

`.query-lens.yml` (override with `--config <path>`), Zod-validated at load — unknown keys and bad types are errors. Only `db` is required:

```yaml
db:
  dialect: postgres                                   # postgres | sqlserver (mysql planned)
  url: postgres://user:pass@localhost:5432/mydb
```

Optional blocks:

| Key | Default | Description |
|---|---|---|
| `thresholds.slowQueryMs` | `200` | Execution time at/above this (ms) is flagged. |
| `thresholds.largeTableRows` | `1000000` | Seq scan over at least this many rows is flagged. |
| `thresholds.maxQueriesPerPr` | `20` | Cap on queries reviewed per PR (bounds LLM/DB cost). |
| `thresholds.minExtractorConfidence` | `0.7` | Drop extracted queries below this confidence. |
| `thresholds.rowsFilteredRatio` | `0.9` | Flag when this fraction of scanned rows is filtered out. |
| `llm.*` | — | Provider/models (see above). |
| `ignore` | `[]` | Glob patterns to skip (accepted by schema; not yet wired). |

## Layout

```
src/
  cli.ts        commander entry point
  config.ts     .query-lens.yml loader (Zod)
  pipeline.ts   diff → extract → analyze → judge → report
  llm/          LlmClient + Vercel AI SDK impl
  diff/         unified-diff parser + tree-sitter context
  extract/      regex prefilter + LLM extractor
  db/           DbAdapter impls + plan normalizers
  judge/        heuristic + LLM + composite judges
  optimize/     (shelved — superseded by the LLM judge)
  report/       console + GitHub PR reporters
  baseline/     standalone AI-only reviewer (comparison benchmark; not used by the pipeline)
```

See [ROADMAP.md](ROADMAP.md) for milestones and [DECISIONS.md](DECISIONS.md) for the "why".
