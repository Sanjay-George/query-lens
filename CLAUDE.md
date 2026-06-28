# CLAUDE.md

How to work in this repo. *What/why* is in [DECISIONS.md](DECISIONS.md); *what's next* is in [ROADMAP.md](ROADMAP.md).

## Philosophy

**KISS and YAGNI are non-negotiable.** CI tools tend to balloon — don't help.

- Three similar lines beats a premature abstraction.
- No speculative features. If the current milestone doesn't need it, don't write it.
- Interfaces exist only for the seams in [DECISIONS.md](DECISIONS.md) (`LlmClient`, `DbAdapter`, `Judge`, `Reporter`). Don't add more without a concrete second impl in mind.
- No backwards-compat shims or feature flags. Pre-1.0 — break things when the change is right.
- No comments explaining *what* code does — only *why*, when non-obvious (constraint, workaround, invariant). See the WASM comment in [src/diff/context.ts](src/diff/context.ts) for the bar.

## Testing

**Not a priority yet.** Requirements churn this early; don't sink time into tests or recorded fixtures until the design settles. Don't add tests proactively — only when asked. When we do invest (later milestone): pure logic → unit tests; LLM components → golden tests with recorded responses (`UPDATE_FIXTURES=1`), never live in CI; DB adapters → opt-in dockerized integration tests.

Always run `npm run typecheck` after changes.

## Workflow

1. **Steelman before deciding.** Lay out for/against for non-trivial choices — don't present one option as obvious.
2. **Ask before pivoting** if the chosen approach won't work.
3. **One milestone at a time.**
4. **Precision over recall, in code and in sessions.** Do less and be right.

## Things to avoid

- **`src/baseline/` is comparison-only scratch code.** Never import from it in `src/`. It's a throwaway benchmark and will be deleted — keep the real pipeline independent of it.
- **LangChain.** Rejected; use the Vercel AI SDK via `LlmClient`.
- **Upgrading `web-tree-sitter` / `tree-sitter-wasms` in isolation** — pinned together (ABI). And keep the `createRequire` import in [src/diff/context.ts](src/diff/context.ts).
- **New top-level config keys** without updating the Zod schema in [src/config.ts](src/config.ts) — the schema is the contract.
- **Dashboards or auto-fix logic** — out of scope for MVP; confirm first. (LLM judging *is* in scope — [DECISIONS.md](DECISIONS.md) §13 — behind the `Judge` interface.)

## Cost-awareness

When adding an LLM call: default to `small` (Haiku), escalate to `large` (Opus) only with a reason; always pass a Zod `schema`; set `temperature: 0`.
