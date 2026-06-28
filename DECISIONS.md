# Design Decisions

The "why" behind the architecture. Read before changing anything load-bearing.

## Locked decisions

| Area | Decision |
|---|---|
| Databases (MVP) | Postgres + SQL Server. MySQL deferred (§11) |
| ORMs (Phase 1) | Eloquent, Prisma, SQLAlchemy, raw SQL |
| CI host | GitHub only |
| Language | TypeScript, Node 20+, single package; GH Action + standalone CLI |
| DB provisioning | User's responsibility — connection string via secret |
| Reporting | Inline PR comments, advisory/neutral, never fails CI |
| LLM SDK | Vercel AI SDK behind `LlmClient`; `anthropic` (default) + `azure`, by `llm.provider` |
| Tree-sitter | `web-tree-sitter@0.22.6` + `tree-sitter-wasms@0.1.13`, pinned together |
| DB drivers | `pg`, `mssql` (showplan XML via `fast-xml-parser`); `mysql2` deferred |

## Tradeoffs (steelmanned)

**1. Real DB vs. synthetic schema.** Require a real DB; non-SELECT gets plan-only `EXPLAIN` (no `ANALYZE`); `EXPLAIN ANALYZE` wrapped in `BEGIN; … ROLLBACK;`. Real plans need real stats; cost is CI friction (user seeds the DB).

**2. LLM extraction vs. static parsing.** LLM-first; extractor quotes the source span, reporter re-checks it before posting, regex prefilter skips trivial files. One component covers every ORM; risk is hallucinated SQL, mitigated by span re-check + confidence floor.

**3. Heuristic vs. LLM judge → both (see §13).** Heuristic judge: code-based, inputs from the plan (`Seq Scan` on large tables, `actual_time_ms`, rows-removed-by-filter ratio), thresholds in config, any 1 rule flags. Deterministic and free, but only fires with a wired DB and misses what an engineer reads off the SQL — §13 closes that gap.

**4. Model tiers.** Two: Haiku (`small`) for extraction (every PR), Opus (`large`) for the LLM judge (the high-value reasoning step, also produces suggestions). The `large` tier moved from the shelved optimizer to the judge — one fewer LLM stage.

**5. Inline comments vs. dashboard.** Inline only: one review/PR, one comment per failing query, suggestion in a `<details>`. Refuse to post if the line can't be anchored to the diff.

**6. Advisory vs. failing check.** Advisory for MVP (`event: COMMENT`). A `strict` flag can come later once heuristics are tuned — false positives in a gate erode trust fast.

**7. LLM SDK.** Internal `LlmClient` over the Vercel AI SDK. LangChain rejected (heavy, leaky). `createLlmClient(config.llm)` picks provider at runtime; one `VercelLlmClient` holds the structured-output logic. Keys from env. Adding a provider = one `case` in [factory.ts](src/llm/factory.ts).

**8. Extractor context.** Tree-sitter for enclosing function + imports (ORM model classes live in other files). 2-hop resolution deferred.

**9. Precision over recall.** Missing a slow query is acceptable; flagging a fine one is not. Drop extractions below `minExtractorConfidence` (0.7); LLM judge passes on non-concerns and drops filler suggestions; reporter never posts an unanchored comment.

**10. Canonical plan vocabulary.** Normalizers emit canonical `PlanNode.kind`; judge stays dialect-agnostic. SQL Server scans map to `Seq Scan`; rows-removed-by-filter derived from `RowsRead − Rows`. Adding a dialect = one normalizer, zero judge changes. Native op preserved in `plan.raw`.

**11. SQL Server plans + deferring MySQL.** `STATISTICS XML` (actual) for read-only SELECT/WITH, `SHOWPLAN_XML` (estimate, never executes) otherwise; both on one pinned, rolled-back connection. MySQL deferred — its `EXPLAIN ANALYZE` returns TREE-format text needing a bespoke parser; `createDbAdapter` throws on `mysql` until built.

**12. GitHub: thin `fetch` client vs. octokit.** Hand-rolled `GithubClient` over two endpoints (`GET pulls/:n.diff`, `POST pulls/:n/reviews`). octokit's extras buy nothing here. The interface is the test seam; `event: COMMENT` enforces the advisory stance.

**13. Two judges + a composite; optimizer folded in.** Keep the heuristic judge, add an LLM judge, merge in `CompositeJudge`. All three implement `judge(JudgeInput): Promise<Verdict>`, so the pipeline is agnostic.
- *Why:* the baseline (`src/baseline/`) proved heuristic-only has a ceiling — it needs a wired DB and misses on-sight problems (N+1, `LIKE '%x%'`, unbounded results). The LLM judge works with or without a plan; **dialect required, live DB not**, and it tunes suggestions to the dialect.
- *Division of labor:* heuristic emits reasons, no severity. LLM judge emits severity (critical/high/medium/low) + explanations + suggestion. Composite: fail if either fails; reasons concatenated; severity = max(LLM severity, "high" floor when a heuristic rule trips — a tripped rule is real-plan evidence); suggestion from the LLM judge.
- *Optimizer shelved:* the LLM judge already proposes the rewrite/index, so a separate Opus optimizer was a duplicate pass. Code kept in `src/optimize/`, unwired.
- *Verdict owns the suggestion:* criticality and fix are one judgment; the `fail` verdict carries `severity` + `suggestion` next to `reasons`.
- *Risks:* per-PR variance and Opus cost per flagged query (mitigated by §6/§9); the severity-merge rule and the `Composite` name are provisional.

## Hidden gotchas (load-bearing)

- **`exactOptionalPropertyTypes: true`** — can't pass `system: undefined` to the SDK; spread-only-when-defined (see [vercel.ts](src/llm/vercel.ts)).
- **`web-tree-sitter@0.22.6`** — newer versions fail to load the pinned prebuilt grammars (`getDylinkMetadata`). Don't upgrade either in isolation.
- **`createRequire` for `web-tree-sitter`** — the ESM default import lacks `Parser.Language` under Vitest; the CJS form works in both. See [context.ts](src/diff/context.ts).

## Costs (MVP, per PR)

- Extractor (Haiku): ~1 call per changed file with queries. Pennies.
- Heuristic judge: free.
- LLM judge (Opus): one call per extracted query (capped by `maxQueriesPerPr`). Dominant cost — the confidence filter and cap are the levers.

## Not designing for

- Agentic self-reflection loops. Deterministic calls (extract, judge), `temperature: 0`.
- Backwards compatibility — pre-1.0, break freely.
