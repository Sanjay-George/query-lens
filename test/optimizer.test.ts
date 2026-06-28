import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizePostgresPlan } from '../src/db/normalize-postgres.js';
import { HeuristicJudge } from '../src/judge/heuristic.js';
import { LlmOptimizer, type OptimizeInput } from '../src/optimize/optimizer.js';
import { RecordedLlmClient } from '../src/llm/recorded.js';
import type { GenerateOptions, LlmClient } from '../src/llm/client.js';
import type { ModelChoice, ModelTier } from '../src/llm/models.js';
import { DEFAULT_MODELS } from '../src/llm/models.js';
import type { ExtractedQuery } from '../src/types.js';
import { E2E_CONFIG, LLM_FIXTURE_DIR } from './fixtures/e2e-setup.js';

const QUERY: ExtractedQuery = {
  id: 'src/users-repo.ts:4',
  file: 'src/users-repo.ts',
  startLine: 4,
  endLine: 6,
  source: 'raw',
  dialect: 'postgres',
  sql: 'SELECT * FROM users WHERE active = true',
  confidence: 0.95,
  codeSpan: 'pool.query(\n    "SELECT * FROM users WHERE active = true",\n  )',
};

async function seqScanInput(): Promise<OptimizeInput> {
  const json = JSON.parse(
    await readFile(
      fileURLToPath(new URL('./fixtures/plans/seq-scan-filter.json', import.meta.url)),
      'utf8',
    ),
  );
  const plan = normalizePostgresPlan(json);
  const verdict = await new HeuristicJudge().judge({
    query: QUERY,
    plan,
    thresholds: E2E_CONFIG.thresholds,
  });
  if (verdict.status !== 'fail') throw new Error('fixture plan should fail the judge');
  return { query: QUERY, plan, reasons: verdict.reasons };
}

/** Returns whatever object it's constructed with, regardless of request. */
class StubLlm implements LlmClient {
  constructor(private readonly response: unknown) {}
  modelFor(tier: ModelTier): ModelChoice {
    return DEFAULT_MODELS[tier];
  }
  async generate<T>(_opts: GenerateOptions<T>): Promise<T> {
    return this.response as T;
  }
}

describe('LlmOptimizer', () => {
  it('returns a suggestion for the recorded seq-scan plan (golden)', async () => {
    const optimizer = new LlmOptimizer(new RecordedLlmClient(LLM_FIXTURE_DIR));
    const suggestion = await optimizer.optimize(await seqScanInput());

    expect(suggestion).not.toBeNull();
    expect(suggestion!.indexHints).toEqual([
      'CREATE INDEX CONCURRENTLY idx_users_active ON users (active) WHERE active = true;',
    ]);
    expect(suggestion!.rewrittenSql).toBeUndefined();
    expect(suggestion!.rationale).toMatch(/partial index/i);
  });

  it('uses the large tier', async () => {
    let seenTier: ModelTier | undefined;
    const llm: LlmClient = {
      modelFor: (t) => DEFAULT_MODELS[t],
      async generate<T>(opts: GenerateOptions<T>): Promise<T> {
        seenTier = opts.tier;
        return { hasSuggestion: false } as T;
      },
    };
    await new LlmOptimizer(llm).optimize(await seqScanInput());
    expect(seenTier).toBe('large');
  });

  it('returns null when the model declines', async () => {
    const optimizer = new LlmOptimizer(new StubLlm({ hasSuggestion: false, rationale: 'looks fine' }));
    expect(await optimizer.optimize(await seqScanInput())).toBeNull();
  });

  it('drops filler suggestions with neither a rewrite nor an index', async () => {
    const optimizer = new LlmOptimizer(
      new StubLlm({ hasSuggestion: true, rationale: 'consider an index maybe' }),
    );
    expect(await optimizer.optimize(await seqScanInput())).toBeNull();
  });

  it('keeps a rewrite-only suggestion and trims whitespace', async () => {
    const optimizer = new LlmOptimizer(
      new StubLlm({
        hasSuggestion: true,
        rationale: 'select only needed columns',
        rewrittenSql: '  SELECT id, name FROM users WHERE active = true  ',
        indexHints: ['   '],
      }),
    );
    const suggestion = await optimizer.optimize(await seqScanInput());
    expect(suggestion).toEqual({
      rationale: 'select only needed columns',
      rewrittenSql: 'SELECT id, name FROM users WHERE active = true',
    });
  });
});
