# CLAUDE.md

Guidance for Claude (or any AI collaborator) working in this repo.

For *what* was decided and *why*, read [DECISIONS.md](DECISIONS.md). For *what's next*, read [ROADMAP.md](ROADMAP.md). This file is about *how to work here*.

## Philosophy

**KISS and YAGNI are non-negotiable.** This project exists because CI tools tend to balloon. Don't help it balloon.

- Three similar lines beats a premature abstraction.
- No speculative features. No "we might need this later." If the current milestone doesn't need it, don't write it.
- No design patterns chosen for their own sake. Interfaces exist for the seams listed in [DECISIONS.md](DECISIONS.md) — `LlmClient`, `DbAdapter`, `Judge`, `Optimizer`, `Reporter`. Don't add more without a concrete second impl in mind.
- No backwards-compat shims, deprecation paths, or feature flags. Pre-1.0 — break things when the change is right.
- No comments explaining *what* code does. Add a comment only when the *why* is non-obvious (hidden constraint, workaround, subtle invariant). See the WASM-loading comment in [src/diff/context.ts](src/diff/context.ts) for the bar.

When in doubt, ask: *does this milestone need this?* If no, cut it.

## Testing

Tests are mandatory for anything load-bearing. The bar:

- **Pure logic** (parsers, normalizers, judge rules, prompt-construction helpers) → unit tests, full branch coverage. Fast, no LLM, no network.
- **LLM-driven components** (extractor, optimizer) → golden tests with **recorded LLM responses** checked into `test/fixtures/`. Re-record with `UPDATE_FIXTURES=1`. Never call a live LLM in CI.
- **DB adapters** → integration tests against dockerized Postgres/MySQL/SQL Server. Opt-in via env var; skipped by default locally so `npm test` stays fast.
- **Reporter** → mock `octokit`, assert exact API calls (path, position, body).

Tests live in `test/` as `*.test.ts`, mirroring `src/` structure. Run before claiming work is done:

```bash
npm run typecheck && npm test
```

If you can't write a test for it, that's a signal the design is wrong — not a reason to skip the test.

## Workflow expectations

1. **Steelman before deciding.** For any non-trivial choice, lay out the for/against. The user explicitly asks for this. Don't present a single option as if it's obvious.
2. **Ask before pivoting.** If you discover the chosen approach won't work, surface it — don't silently switch.
3. **One milestone at a time.** Don't start M3 work while M2 is half-done. The roadmap exists for a reason.
4. **Verify, don't assume.** Run `npm run typecheck && npm test` after changes. If a test fails, fix the root cause — don't relax the assertion.
5. **Match the precision-over-recall principle in code too.** Better to do less and be right than do more and be wrong. This applies to *what we ship*, but also to *what you do in a session*.

## Things to avoid

- **LangChain.** Rejected; see [DECISIONS.md](DECISIONS.md). Use the Vercel AI SDK through the `LlmClient` interface.
- **Upgrading `web-tree-sitter` or `tree-sitter-wasms` in isolation.** They're pinned together; the prebuilt grammars target an older runtime ABI. See [DECISIONS.md](DECISIONS.md) gotchas.
- **Changing the default import of `web-tree-sitter`** to ESM-style. The `createRequire` form in [src/diff/context.ts](src/diff/context.ts) is load-bearing.
- **Adding new top-level config keys** without updating the Zod schema in [src/config.ts](src/config.ts) — the schema is the contract.
- **Writing LLM judges, dashboards, or auto-fix logic.** These are explicitly out of scope for MVP. If the user asks, point at [ROADMAP.md](ROADMAP.md) and confirm before building.

## Cost-awareness

Different agents use different model tiers (see [DECISIONS.md](DECISIONS.md)). When adding a new LLM call:

- Default to `small` (Haiku). Only escalate to `large` (Opus) if you can articulate why the small tier won't work.
- Always pass a Zod schema via `generate({ schema, ... })` — structured output is cheaper and more reliable than free-form parsing.
- Set `temperature: 0` unless you have a specific reason not to.

## Quick reference

| If you're about to… | Read first |
|---|---|
| Add a new dependency | [DECISIONS.md](DECISIONS.md) — check we haven't already rejected it |
| Change DB adapter behavior | [DECISIONS.md](DECISIONS.md) §1 (real DB) and §3 (judge rules) |
| Change extractor behavior | [DECISIONS.md](DECISIONS.md) §2 (LLM extraction) and §9 (precision over recall) |
| Add a new milestone | [ROADMAP.md](ROADMAP.md) — update the status table |
| Skip writing tests | Don't |
