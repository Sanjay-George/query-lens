# Design Decisions

The "why" behind the architecture. If you're picking this up cold, read this before changing anything load-bearing.

## Locked decisions

| Area | Decision |
|---|---|
| Databases (MVP) | Postgres, MySQL, SQL Server — all in Phase 1 |
| ORMs (Phase 1) | Eloquent (PHP), Prisma (TS), SQLAlchemy (Py), raw SQL across all langs |
| ORMs (Phase 2) | TypeORM, Drizzle, Sequelize, Django ORM |
| CI host | GitHub only |
| Language | TypeScript, Node 20+, single package, packaged as a GH Action + standalone CLI |
| DB provisioning | User's responsibility — connection string via GitHub secret |
| Reporting | Inline PR review comments. **Advisory check (neutral) for MVP**, never fails CI |
| LLM SDK | Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) behind our own `LlmClient` interface |
| Tree-sitter | `web-tree-sitter@0.22.6` + `tree-sitter-wasms@0.1.13` (single WASM runtime, prebuilt grammars) |

## Tradeoffs that were steelmanned

### 1. Run queries against a real DB vs. plan-only / synthetic schema
**Decision:** require a real DB; refuse to run non-SELECT without `EXPLAIN` (no `ANALYZE`); wrap `EXPLAIN ANALYZE` in `BEGIN; … ROLLBACK;`.
- **For:** real plans need real stats; synthetic schemas miss the cardinalities and indexes that cause slow queries — the whole point.
- **Against:** CI friction (users must wire up an ephemeral, seeded, or staging DB). Plans on an empty DB are useless, so seeding burden is on the user.

### 2. LLM-based query extraction vs. per-language static parsing
**Decision:** LLM-first; extractor must quote the source span it derived each query from; reporter re-checks the span before posting; raw-SQL path uses a regex prefilter so trivial cases never hit the model.
- **For LLM:** one component handles every ORM/builder. Returns `{file, line, sql}` directly. Cheap with a small model.
- **Against:** hallucinated SQL is the worst possible failure mode — we'd analyse code the user didn't write. Diffs are partial; LLM may need surrounding files.

### 3. Heuristic judge in code vs. LLM judge
**Decision:** code. Inputs: `total_cost`, `actual_time_ms`, `Seq Scan` on large tables, join count, rows-removed-by-filter ratio. Thresholds in `.query-lens.yml`. **Require ≥2 failing rules** to fail a query.
- **For code:** deterministic, free, reviewable, no per-PR variance. Plan JSON from Postgres is structured.
- **Against:** heuristics will be wrong on edge cases; tuning never ends.

### 4. Three model tiers vs. one model
**Decision:** two tiers — Haiku (`small`) for extract, Opus (`large`) for optimize. Judge is code, no LLM.
- **For tiered:** extractor runs every PR; cheap model is 10× cheaper. Optimizer runs only on fails; Opus is worth it.
- **Against:** more glue, more failure modes.

### 5. Inline PR comments vs. dashboard
**Decision:** inline only for MVP. One review per PR, one comment per failing query, suggestion in a collapsed `<details>`. **Refuse to post if line anchor can't be verified against the diff** (no "somewhere in this file" comments).
- **For inline:** zero new infra, lives where devs already work.
- **Against:** long suggestions get noisy; no plan-diff visualisation; no history.

### 6. Fail PR check vs. advisory-only
**Decision:** advisory only for MVP. Add `strict: true` config flag later once heuristics are tuned.
- **For fail:** forces attention.
- **Against:** false positives in a CI gate erode trust fast; ORM extraction is fuzzy.

### 7. LangChain vs. Vercel AI SDK vs. tiny internal interface
**Decision:** internal `LlmClient` interface with Vercel AI SDK as the first impl.
- LangChain rejected: heavy, churny, abstraction leaks at tool use / structured output / caching.
- Vercel SDK chosen: provider-agnostic, structured output via Zod, ~10% of LangChain's surface area.
- The internal interface keeps us free to swap to a 30-line direct adapter later if Vercel becomes a problem.

### 8. Extractor context: tree-sitter vs. naive ±N lines
**Decision:** tree-sitter for enclosing function + top-level imports. 2-hop import resolution deferred until an extractor actually needs it.
- **For:** ORM cases (model class in another file) need cross-file context; naive line windows miss it.
- **Against:** install complexity (see WASM pinning note below).

### 9. Precision over recall
**Decision:** missing a slow query is acceptable; flagging a fine query is not.
- Extractor emits `confidence`; we drop anything below `thresholds.minExtractorConfidence` (default `0.7`).
- Judge requires **≥2 independent failing rules** before failing a query.
- Optimizer instructed to return `null` rather than emit weak "consider an index" filler.
- Reporter never posts a comment without a verified line anchor.

## Hidden gotchas (load-bearing)

- **`exactOptionalPropertyTypes: true`** in `tsconfig.json` — means you can't pass `system: undefined` to the Vercel SDK. Spread-only-when-defined pattern is used in [src/llm/vercel.ts](src/llm/vercel.ts).
- **`web-tree-sitter@0.22.6`** — the prebuilt `tree-sitter-wasms` grammars target an older runtime ABI. Newer `web-tree-sitter` versions silently fail to load the grammars (`getDylinkMetadata` error). Don't upgrade either dependency in isolation.
- **`createRequire` for `web-tree-sitter`** — the ESM default import resolves to the Emscripten module under Vitest's Vite transformer, which lacks `Parser.Language`. The CJS form via `createRequire` yields the right constructor in both Node and Vitest. See [src/diff/context.ts](src/diff/context.ts).

## Costs (MVP, per PR)

- Extractor (Haiku): ~1 call per changed file with potential queries, ~5k in / 1k out. Pennies.
- Judge: free.
- Optimizer (Opus): only on failures. ~3k in / 1k out per failing query.

Dominant cost is Opus, gated by judge precision. If precision is good, this stays cheap.

## What we are explicitly NOT designing for

- A fully agentic workflow that loops on its own output. Three deterministic LLM calls (extract, optimize) plus a code judge.
- LLM-based judging. If we ever want it, drop a new `Judge` impl alongside the heuristic one — that's exactly why `Judge` is an interface.
- Backwards compatibility. We're pre-1.0; break things freely when the change is right.
