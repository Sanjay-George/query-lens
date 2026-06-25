import { beforeAll, describe, expect, it } from 'vitest';
import { extractQueries } from '../src/extract/extractor.js';
import { ContextResolver } from '../src/diff/context.js';
import { RecordedLlmClient } from '../src/llm/recorded.js';
import { LLM_FIXTURE_DIR, readSource } from './fixtures/e2e-setup.js';

// Reproduces exactly the prompt the pipeline builds for the e2e fixture so the
// recorded response replays (same diff → same changedCode → same hash).
const CHANGED_CODE = [
  "1: import { pool } from './db';",
  '2: ',
  '3: export async function findActiveUsers() {',
  '4:   const res = await pool.query(',
  '5:     "SELECT * FROM users WHERE active = true",',
  '6:   );',
  '7:   return res.rows;',
  '8: }',
].join('\n');

let resolver: ContextResolver;
beforeAll(async () => {
  resolver = await ContextResolver.create();
});

describe('extractQueries (golden, recorded LLM)', () => {
  it('returns the high-confidence raw query with a stable id', async () => {
    const source = await readSource('src/users-repo.ts');
    const codeContext = await resolver.resolve('typescript', source, { startLine: 1, endLine: 8 });

    const queries = await extractQueries(new RecordedLlmClient(LLM_FIXTURE_DIR), {
      file: 'src/users-repo.ts',
      dialect: 'postgres',
      codeContext,
      changedCode: CHANGED_CODE,
      minConfidence: 0.7,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({
      id: 'src/users-repo.ts:4',
      file: 'src/users-repo.ts',
      source: 'raw',
      dialect: 'postgres',
      sql: 'SELECT * FROM users WHERE active = true',
      confidence: 0.95,
    });
  });

  it('drops queries below the confidence threshold', async () => {
    const source = await readSource('src/users-repo.ts');
    const codeContext = await resolver.resolve('typescript', source, { startLine: 1, endLine: 8 });

    const queries = await extractQueries(new RecordedLlmClient(LLM_FIXTURE_DIR), {
      file: 'src/users-repo.ts',
      dialect: 'postgres',
      codeContext,
      changedCode: CHANGED_CODE,
      minConfidence: 0.99, // above the recorded 0.95
    });

    expect(queries).toHaveLength(0);
  });
});
