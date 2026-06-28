# Baseline AI-only Query Reviewer

> ⚠️ **Throwaway benchmark.** A pure-LLM baseline kept only to compare against the real pipeline in `src/`. **Nothing in `src/` imports from here**, and it will be deleted. Don't build on it.

One LLM call per changed file, structured findings out. No DB, no extraction, no judge.

```bash
# Anthropic (default)
export ANTHROPIC_API_KEY=sk-ant-...
git diff main > /tmp/pr.diff
npm run baseline -- --diff /tmp/pr.diff

# Azure
export AZURE_API_KEY=...
npm run baseline -- --diff /tmp/pr.diff --provider azure \
  --azure-resource my-resource --model my-deployment
```

Flags: `--diff <path>` (required), `--provider anthropic|azure`, `--model <id>`, `--azure-resource <name>`, `--max-files <n>`, `--json`.

Files: `cli.ts`, `reviewer.ts`, `prompt.ts`, `schema.ts`.
