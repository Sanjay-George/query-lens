# Baseline AI-only Query Reviewer

A deliberately minimal, pure-LLM baseline for reviewing query performance in a
diff. No database, no extraction stage, no judge. One LLM call per changed
file, structured findings out.

This exists as a **comparison point** for the full pipeline in `src/`. Whatever
the smarter system ships, it has to beat this baseline on something —
precision, recall, latency, or cost.

## Run it

### Anthropic (default)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
git diff main > /tmp/pr.diff
npm run baseline -- --diff /tmp/pr.diff
```

### Azure OpenAI

Provide your resource name and a **deployment name** (not a model name):

```bash
export AZURE_API_KEY=...
npm run baseline -- \
  --diff /tmp/pr.diff \
  --provider azure \
  --azure-resource my-azure-resource \
  --model my-gpt-4o-deployment
```

### Flags

| Flag | Default | Notes |
|---|---|---|
| `--diff <path>` | *(required)* | Unified diff to review. |
| `--provider <name>` | `anthropic` | `anthropic` or `azure`. |
| `--model <id>` | `claude-opus-4-8` (Anthropic) | Anthropic model id, or Azure deployment name. Required for Azure. |
| `--azure-resource <name>` | — | Required when `--provider=azure`. |
| `--max-files <n>` | all | Cap to bound the LLM bill on huge PRs. |
| `--json` | off | Machine-readable output. |

## What it does

1. Parses the diff with the shared `parseUnifiedDiff` reader.
2. For each changed file, prompts the LLM as a senior DB engineer with the
   file's hunks (with line numbers annotated).
3. Gets back structured findings: `{ line, severity, title, comment }`.
4. Prints them grouped per file.

That's it. No `EXPLAIN`, no AST, no heuristics — just the model.

## Files

- `cli.ts` — Commander entry point.
- `reviewer.ts` — Loops over files, calls the LLM, returns findings.
- `prompt.ts` — System + user prompt; renders hunks with line numbers.
- `schema.ts` — Zod schema for structured output.
