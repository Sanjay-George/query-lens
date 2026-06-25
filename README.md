# Query Lens

> ⚠️ Early-stage WIP

A CI tool that flags potentially slow SQL in pull requests. It pulls queries out of a PR diff (raw SQL, ORM code, query builders), runs them against a database you provide, and posts inline review comments when a query looks like it needs optimisation.

Supports Postgres, MySQL, and SQL Server. Extractors planned for raw SQL, Eloquent, Prisma, and SQLAlchemy.

## 🚀 Quick Start

#### Prerequisites
- **Node.js** v20 or higher: [Download Node.js](https://nodejs.org/)
- An **Anthropic API key** (only needed once you start running the pipeline against real PRs — not required for tests).

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

## 🧪 Tests

- `npm test` — runs the full Vitest suite once.
- `npm run test:watch` — re-runs on save while you work.
- New tests go in `test/` as `*.test.ts`. They import from `../src/...` directly; no build step required.

Integration tests that hit real databases will be opt-in via env var once the DB adapters land (M3).

## 📦 Project Layout

```
src/
  cli.ts          # commander entry point
  config.ts       # .query-lens.yml loader (Zod-validated)
  types.ts        # shared domain types
  llm/            # LlmClient interface + Vercel AI SDK impl
  diff/           # unified-diff parser + tree-sitter context resolver
action.yml        # GitHub Action wrapper around the CLI
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
