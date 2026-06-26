# Roadmap

Milestones are intentionally small. Each one ships something reviewable.

## Status

| ID | Milestone | Status |
|---|---|---|
| M0 | Scaffolding | ✅ done |
| M1 | Diff reader + tree-sitter context | ✅ done |
| M2 | Raw-SQL E2E against Postgres | ✅ done |
| M3 | SQL Server adapter | ✅ done |
| M4 | Optimizer + GitHub reporter | ✅ done |
| M5 | Eloquent extraction | ⏳ next |
| M6 | Prisma + SQLAlchemy extraction | ⏳ |
| M7 | Polish — GH Action wrapper + README | ⏳ (README done early) |

## Milestone detail

### M0 — Scaffolding ✅
package.json, tsconfig (strict + `exactOptionalPropertyTypes`), Vitest, `LlmClient` interface with Vercel AI SDK impl, config loader (Zod-validated YAML), CLI skeleton (`commander`).

### M1 — Diff reader + tree-sitter context ✅
- Unified-diff parser → `DiffFile[]` with hunks and added-line ranges.
- Tree-sitter (WASM) `ContextResolver` for TypeScript/TSX/Python/PHP that returns the enclosing function and top-level imports for a given line range.
- Note: `web-tree-sitter` pinned to `0.22.6` to match `tree-sitter-wasms@0.1.13` grammar ABI. Load via `createRequire` (ESM default import resolves to the Emscripten module under Vitest's transformer).

### M2 — Raw-SQL E2E against Postgres ✅
- Regex prefilter — files with no query-shaped tokens skip the LLM.
- LLM extractor for raw SQL (small-tier model) that emits `ExtractedQuery[]` with `confidence` and the originating `codeSpan`.
- `postgres.ts` `DbAdapter` — `EXPLAIN (ANALYZE, FORMAT JSON)` inside `BEGIN; … ROLLBACK;`; plan-only `EXPLAIN` for non-SELECT (never executes writes).
- Plan normalizer → `NormalizedPlan` with flattened `PlanNode[]`.
- Heuristic judge with three rules: `seq-scan-on-large-table`, `slow-execution`, `excessive-rows-filtered`. **Any 1 failing rule flags a query** (advisory-only, see [DECISIONS.md](DECISIONS.md) §3/§9).
- Console reporter.
- End-to-end test on a fixture PR with recorded LLM responses + fake DB adapter; opt-in live Postgres integration test via `docker-compose.yml` (gated by `RUN_DB_TESTS=1`).
**This was the proof-point milestone.**

### M3 — SQL Server adapter ✅
- `sqlserver.ts` `DbAdapter` — `SET STATISTICS XML ON` (actual stats) for read-only SELECT/WITH, `SET SHOWPLAN_XML ON` (estimated, never executes) for everything else. Both batches pinned to one connection via a rolled-back transaction.
- `normalize-sqlserver.ts` — showplan XML → `NormalizedPlan` via `fast-xml-parser`. Full-table scans (`Table Scan`, `Clustered/non-clustered Index Scan`) map to the canonical `Seq Scan` kind so the heuristic judge stays dialect-agnostic; rows-removed-by-filter derived from `RowsRead − Rows`.
- Generic `flattenPlan` moved to `db/plan.ts`; `createDbAdapter` factory dispatches by dialect.
- Unit tests on a captured showplan fixture; opt-in live SQL Server integration test (`docker-compose.yml` `sqlserver` service, gated by `RUN_DB_TESTS=1`).

### M4 — Optimizer + GitHub reporter ✅
- `optimize/optimizer.ts` — `Optimizer` interface + `LlmOptimizer` (large-tier/Opus, `temperature: 0`, Zod schema). The schema carries a `hasSuggestion` flag; the client maps a declined or filler-only response (no rewrite, no index) to `null` so weak "consider an index" comments never reach the PR. Wired into the pipeline: runs only on failing queries, attaches `suggestion` to the `ReviewResult`.
- `report/github-client.ts` — a thin `GithubClient` (`fetchPrDiff` + `createReview`) over `fetch`; no octokit dependency for two endpoints (see [DECISIONS.md](DECISIONS.md) §12).
- `report/github.ts` — `GithubReporter`: one `COMMENT` review (never blocks CI), one inline comment per failing query, suggestion in a collapsed `<details>`. **Refuses to post** any comment whose `file:line` isn't an added line in the diff (precision over recall).
- CLI `review --pr <n>` now fetches the PR diff, runs the pipeline, and posts the review. Repo from `--repo`/`GITHUB_REPOSITORY`, token from `GITHUB_TOKEN`.
- Tests: optimizer golden test (recorded fixture) + mapping branches; `GithubReporter` against a mock client asserting exact comment path/line/side/body and the refuse-to-anchor path; e2e extended to assert the attached suggestion.
- **This closes the first vertical: extract → analyze → judge → optimize → report.** See [TESTING.md](TESTING.md) to run it locally or on a real PR.

### M5 — Eloquent extraction
PHP extractor prompt variant. Tests with recorded LLM responses, no live calls.

### M6 — Prisma + SQLAlchemy extraction
Same recipe per ORM.

### M7 — Polish
Final `action.yml`, example workflow, dogfood run on a real test repo. README done already.

## Out of scope for MVP

Each is one config flag or one adapter away once users ask.

- MySQL adapter — deferred until after the first vertical ships on Postgres + SQL Server. `EXPLAIN FORMAT=JSON` + `EXPLAIN ANALYZE` (TREE-format *text*, so it needs its own parser); `mysql` is already a valid `dialect` but `createDbAdapter` throws until then.
- Dashboard, history, trends
- Auto-fix / GitHub suggestion blocks
- Self-hosted LLM support
- Query result caching across PRs
- GitLab / Bitbucket
- NoSQL
- Strict-mode failing CI check (start advisory-only)

## Phase ordering

- **Phase 1 (MVP)** = M0–M4: enough to advisory-review a Postgres or SQL Server PR end-to-end. **This is the first vertical** — MySQL and further ORMs wait behind it.
- **Phase 2** = M5–M6: ORM coverage.
- **Phase 3** = M7 + the out-of-scope list (MySQL adapter included), driven by user feedback.
