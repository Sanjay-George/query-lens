# Roadmap

Milestones are intentionally small. Each one ships something reviewable.

## Status

| ID | Milestone | Status |
|---|---|---|
| M0 | Scaffolding | ✅ done |
| M1 | Diff reader + tree-sitter context | ✅ done |
| M2 | Raw-SQL E2E against Postgres | ✅ done |
| M3 | SQL Server + MySQL adapters | ⏳ next |
| M4 | Optimizer + GitHub reporter | ⏳ |
| M5 | Eloquent extraction | ⏳ |
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

### M3 — SQL Server + MySQL adapters
- `sqlserver.ts` — `SET STATISTICS XML ON` / `SET SHOWPLAN_XML`. XML → `NormalizedPlan`.
- `mysql.ts` — `EXPLAIN FORMAT=JSON` and `EXPLAIN ANALYZE` (MySQL ≥ 8.0.18). JSON → `NormalizedPlan`.

### M4 — Optimizer + GitHub reporter
- `optimize/optimizer.ts` — large-tier (Opus) LLM. Strict instruction to return `null` if no meaningfully better query exists.
- `report/github.ts` — single PR review, one inline comment per failing query. **Refuses to post** if the line anchor can't be verified against the diff (precision over recall).

### M5 — Eloquent extraction
PHP extractor prompt variant. Tests with recorded LLM responses, no live calls.

### M6 — Prisma + SQLAlchemy extraction
Same recipe per ORM.

### M7 — Polish
Final `action.yml`, example workflow, dogfood run on a real test repo. README done already.

## Out of scope for MVP

Each is one config flag or one adapter away once users ask.

- Dashboard, history, trends
- Auto-fix / GitHub suggestion blocks
- Self-hosted LLM support
- Query result caching across PRs
- GitLab / Bitbucket
- NoSQL
- Strict-mode failing CI check (start advisory-only)

## Phase ordering

- **Phase 1 (MVP)** = M0–M4: enough to advisory-review a Postgres PR end-to-end.
- **Phase 2** = M5–M6: ORM coverage.
- **Phase 3** = M7 + the out-of-scope list, driven by user feedback.
