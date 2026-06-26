# Design Decisions

The "why" behind the architecture. If you're picking this up cold, read this before changing anything load-bearing.

## Locked decisions

| Area | Decision |
|---|---|
| Databases (MVP) | Postgres + SQL Server for the first vertical. MySQL is still a target but deferred until after that ships (see §11) |
| ORMs (Phase 1) | Eloquent (PHP), Prisma (TS), SQLAlchemy (Py), raw SQL across all langs |
| ORMs (Phase 2) | TypeORM, Drizzle, Sequelize, Django ORM |
| CI host | GitHub only |
| Language | TypeScript, Node 20+, single package, packaged as a GH Action + standalone CLI |
| DB provisioning | User's responsibility — connection string via GitHub secret |
| Reporting | Inline PR review comments. **Advisory check (neutral) for MVP**, never fails CI |
| LLM SDK | Vercel AI SDK behind our own `LlmClient` interface. Providers: `@ai-sdk/anthropic` (default) and `@ai-sdk/azure` (Azure OpenAI), selected at runtime by `llm.provider` in config |
| Tree-sitter | `web-tree-sitter@0.22.6` + `tree-sitter-wasms@0.1.13` (single WASM runtime, prebuilt grammars) |
| DB drivers | `pg` (Postgres), `mssql` (SQL Server). SQL Server showplan XML parsed with `fast-xml-parser`. MySQL (`mysql2`) deferred — see §11 |

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
**Decision:** code. Inputs: `total_cost`, `actual_time_ms`, `Seq Scan` on large tables, join count, rows-removed-by-filter ratio. Thresholds in `.query-lens.yml`. **Any 1 failing rule flags a query** — the tool is advisory-only for MVP (§6), so a noisy comment is low-stakes, and single-rule logic is simpler and more predictable than a ≥2 quorum. Revisit if false positives become a problem.
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
- **Multi-provider:** `createLlmClient(config.llm)` ([src/llm/factory.ts](src/llm/factory.ts)) picks the impl at runtime from `llm.provider` (`anthropic` | `azure`). One provider-parameterized `VercelLlmClient` holds the structured-output logic; the factory only differs in which Vercel provider it instantiates and the model/deployment map. API keys come from env (`ANTHROPIC_API_KEY` / `AZURE_API_KEY`); Azure also needs `llm.resourceName` + per-tier deployment names in `llm.models`. Adding a third provider = one more `case` in the factory.

### 8. Extractor context: tree-sitter vs. naive ±N lines
**Decision:** tree-sitter for enclosing function + top-level imports. 2-hop import resolution deferred until an extractor actually needs it.
- **For:** ORM cases (model class in another file) need cross-file context; naive line windows miss it.
- **Against:** install complexity (see WASM pinning note below).

### 9. Precision over recall
**Decision:** missing a slow query is acceptable; flagging a fine query is not.
- Extractor emits `confidence`; we drop anything below `thresholds.minExtractorConfidence` (default `0.7`).
- Judge flags on **any 1 failing rule** (advisory-only, so favor catching over silence — see §3); each rule is independently tunable via `.query-lens.yml` thresholds.
- Optimizer instructed to return `null` rather than emit weak "consider an index" filler.
- Reporter never posts a comment without a verified line anchor.

### 10. Canonical plan vocabulary vs. dialect-aware judge
**Decision:** normalizers emit a canonical `PlanNode.kind`; the judge stays dialect-agnostic. Each `DbAdapter`/normalizer is responsible for translating its native plan into the shared `NormalizedPlan` shape — that's the whole point of "Normalized".
- Concretely: the heuristic judge keys the seq-scan rule on `kind === 'Seq Scan'` (a Postgres term we adopt as the canonical name for "reads the whole table"). SQL Server's `Table Scan` / `Clustered Index Scan` / non-clustered `Index Scan` all map to `Seq Scan`; seeks pass through unchanged.
- "Rows removed by filter" isn't a native SQL Server field — it's derived from `RowsRead − Rows` (actuals if a STATISTICS XML plan, else the estimates), which is the same quantity Postgres reports directly.
- **For:** one judge, one vocabulary, no dialect branching in the rules. Adding a dialect = one normalizer, zero judge changes.
- **Against:** the canonical names lean Postgres-ish; a reader of a SQL Server plan sees `Seq Scan` where SSMS would say `Table Scan`. Acceptable — the native op is still in `plan.raw`.

### 11. SQL Server: STATISTICS XML vs. SHOWPLAN_XML, deferring MySQL
**Decision:** mirror the Postgres SELECT/write split — `STATISTICS XML` (executes, actual counters) only for read-only SELECT/WITH, `SHOWPLAN_XML` (estimate-only, never executes) otherwise. Both batches run on one pinned connection inside a rolled-back transaction.
- The two `SET` statements are connection-scoped and must each be their own batch, so a `mssql` `Transaction` pins both to the same connection; the rollback also reverts any side effects of an executed SELECT.
- **MySQL deferred until after the first vertical:** the goal is one complete vertical (extract → analyze → judge → optimize → report) on Postgres + SQL Server before widening DB coverage. MySQL's `EXPLAIN ANALYZE` also returns TREE-format *text*, not JSON, so actual-stat extraction needs a bespoke text parser unrelated to SQL Server's XML work — no reason to pull it forward. `mysql` stays a valid `dialect` in the config/types, but `createDbAdapter` throws until the adapter is built.

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
