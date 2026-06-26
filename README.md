# Query Lens

> ⚠️ Early-stage WIP

A CI tool that flags potentially slow SQL in pull requests. It pulls queries out of a PR diff (raw SQL, ORM code, query builders), runs them against a database you provide, and posts inline review comments when a query looks like it needs optimisation.

Supports Postgres and SQL Server (MySQL planned). Raw-SQL extraction works now, with Eloquent, Prisma, and SQLAlchemy extractors planned.

## 🚀 Quick Start

#### Prerequisites
- **Node.js** v20 or higher: [Download Node.js](https://nodejs.org/)
- An API key for one of the [supported AI providers](#-ai-providers) — Anthropic (default) or Azure OpenAI. Only needed once you start running the pipeline against real PRs; not required for tests.

### Get the project running

#### 1. Clone the repo
```bash
git clone <your-fork-url> query-lens
cd query-lens
```

#### 2. Install dependencies
```bash
npm install
```

#### 3. Typecheck and run the tests
```bash
npm run typecheck
npm test
```

If both pass, you're set. That's it.

#### 4. Run the CLI locally
```bash
npm run dev -- review --help
```

`npm run dev` uses `tsx` so you don't need to build first. To produce a real `dist/` bundle for the GitHub Action:

```bash
npm run build
```

#### 5. Review a diff or a PR
```bash
# Console-only dry run against a saved diff (no GitHub calls):
node dist/cli.js review --diff some.diff

# Review a real PR and post inline comments (needs an AI provider key + GITHUB_TOKEN):
node dist/cli.js review --pr 123 --repo your-org/your-repo
```

The provider key is `ANTHROPIC_API_KEY` by default, or `AZURE_API_KEY` for Azure OpenAI — see [AI Providers](#-ai-providers).

To test locally or wire this into CI, see **[TESTING.md](TESTING.md)**.

## 🤖 AI Providers

Query Lens talks to LLMs through one `LlmClient` interface, so the provider is a config choice. The extractor runs on a cheap **`small`** tier; the optimizer runs on a stronger **`large`** tier. Two providers are supported today; adding a third is one `case` in [src/llm/factory.ts](src/llm/factory.ts). The "why" behind this design is in [DECISIONS.md](DECISIONS.md) §7.

| Provider | `llm.provider` | API key (env) | Extra config |
|---|---|---|---|
| Anthropic *(default)* | `anthropic` | `ANTHROPIC_API_KEY` | none — built-in model defaults |
| Azure OpenAI | `azure` | `AZURE_API_KEY` | `resourceName` + per-tier deployment names |

> API keys should **never** live in config — they're read from the environment. Everything else goes in `.query-lens.yml` under the `llm` key.

### Anthropic (default)

If you set nothing, you get Anthropic with sensible model defaults (`claude-haiku-4-5` for `small`, `claude-opus-4-8` for `large`). Just provide the key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

To pin specific models, override them in config:

```yaml
llm:
  provider: anthropic        # optional; this is the default
  models:                    # optional; omit to use the defaults above
    small: claude-haiku-4-5-20251001
    large: claude-opus-4-8
```

### Azure OpenAI

Point Query Lens at your Azure resource and your **deployment names** (not model names). Both tiers are required for Azure — there are no defaults, since deployment names are account-specific.

```bash
export AZURE_API_KEY=...
```

```yaml
llm:
  provider: azure
  resourceName: my-azure-resource   # the <name> in https://<name>.openai.azure.com
  models:
    small: my-gpt-4o-mini-deployment
    large: my-gpt-4o-deployment
```

The config schema validates this for you: with `provider: azure`, a missing `resourceName` or either deployment name is a load-time error.

## 🧪 Tests

- `npm test` — runs the full Vitest suite once.
- `npm run test:watch` — re-runs on save while you work.
- New tests go in `test/` as `*.test.ts`. They import from `../src/...` directly; no build step required.

Integration tests that hit real databases (Postgres, SQL Server) are opt-in: `RUN_DB_TESTS=1 npm test` after `docker compose up -d`. They're skipped by default so the suite stays fast and offline.

## 📦 Project Layout

```
src/
  cli.ts          # commander entry point
  config.ts       # .query-lens.yml loader (Zod-validated)
  types.ts        # shared domain types
  pipeline.ts     # ties the stages together: diff → extract → analyze → judge
  llm/            # LlmClient interface + Vercel AI SDK impl
  diff/           # unified-diff parser + tree-sitter context resolver
  extract/        # regex prefilter + LLM query extractor
  db/             # DbAdapter impls (postgres, sqlserver) + plan normalizers
  judge/          # heuristic judge over normalized plans
  optimize/       # LLM optimizer (suggests rewrites / index hints, or nothing)
  report/         # Reporter interface + console + GitHub PR reporters
test/             # Vitest specs
```

Each subsystem is abstracted behind a small interface (`LlmClient`, `DbAdapter`, `Judge`, `Optimizer`, `Reporter`) so implementations can be swapped easily.

## 🛠️ Useful Commands

| Command | What it does |
|---|---|
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run build` | Compile to `dist/` |
| `npm run dev -- <args>` | Run the CLI from source |

## 🤝 Contributing

- [ROADMAP.md](ROADMAP.md) — milestones (`M0`–`M7`) and what's in/out of scope.
- [DECISIONS.md](DECISIONS.md) — the "why" behind the architecture. Read this before changing anything load-bearing.

Pick a milestone, send a PR. Keep the design KISS — interfaces over abstractions, no speculative features.
