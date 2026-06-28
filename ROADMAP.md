# Roadmap

Small milestones, each shipping something reviewable.

## Status

| ID | Milestone | Status |
|---|---|---|
| M0 | Scaffolding | ✅ |
| M1 | Diff reader + tree-sitter context | ✅ |
| M2 | Raw-SQL E2E against Postgres | ✅ |
| M3 | SQL Server adapter | ✅ |
| M4 | GitHub reporter (optimizer shelved → M4.5) | ✅ |
| M4.5 | LLM judge + composite judge | ⏳ next (MVP) |
| M5 | Eloquent extraction | post-MVP |
| M6 | Prisma + SQLAlchemy extraction | post-MVP |
| M7 | Polish — GH Action wrapper | post-MVP |

## Detail

**M0** — package.json, strict tsconfig, `LlmClient` + Vercel AI SDK, Zod config loader, `commander` CLI.

**M1** — unified-diff parser → `DiffFile[]`; tree-sitter `ContextResolver` (TS/TSX/Python/PHP) for enclosing function + imports. `web-tree-sitter@0.22.6` pinned to grammar ABI; `createRequire` load.

**M2** — regex prefilter; large-tier LLM extractor → `ExtractedQuery[]` (`confidence`, `codeSpan`); `postgres.ts` adapter (`EXPLAIN ANALYZE` in a rolled-back txn, plan-only for writes); plan normalizer; heuristic judge (`seq-scan-on-large-table`, `slow-execution`, `excessive-rows-filtered`, any 1 flags); console reporter. The proof-point.

**M3** — `sqlserver.ts` (`STATISTICS XML` for reads, `SHOWPLAN_XML` otherwise, pinned to one rolled-back txn); showplan XML → `NormalizedPlan` (scans map to canonical `Seq Scan`). `flattenPlan` in `db/plan.ts`; `createDbAdapter` dispatches by dialect.

**M4** — `report/github-client.ts` (thin `fetch` client, no octokit; §12); `GithubReporter` posts one `COMMENT` review, one inline comment per failing query, refuses unanchored lines. CLI `review --pr <n>`.

**M4.5 — LLM judge + composite judge (MVP).** The baseline (`src/baseline/`) showed a heuristic-only judge isn't enough — it needs a wired DB and misses problems an engineer spots on sight. Add two judges behind the existing `Judge` interface:
- **Heuristic** — rule-based, plan-driven; abstains without a plan; no severity.
- **LLM** (`judge/llm.ts`, small tier) — emits severity + explanations + a concrete suggestion, tuned to the dialect; runs with or without a plan (dialect still required).
- **Composite** (`judge/composite.ts`) — runs both, fails if either fails, concatenates reasons, severity = max(LLM severity, "high" floor when a heuristic rule trips), suggestion from the LLM judge.
- `Verdict.fail` gains optional `severity` + `suggestion`; reporter renders both.
- **Optimizer shelved** — the LLM judge produces the suggestion now; code kept in `src/optimize/`, unwired.

**M5/M6** (post-MVP) — Eloquent, then Prisma + SQLAlchemy extractor variants.

**M7** (post-MVP) — `action.yml`, example workflow, dogfood run.

## Out of scope for MVP

MySQL adapter (TREE-format `EXPLAIN ANALYZE` needs its own parser; `createDbAdapter` throws for now); dashboards/history; auto-fix suggestion blocks; self-hosted LLMs; cross-PR caching; GitLab/Bitbucket; NoSQL; strict CI-failing mode (advisory-only for now).
