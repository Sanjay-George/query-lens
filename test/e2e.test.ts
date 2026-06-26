import { beforeAll, describe, expect, it } from 'vitest';
import { reviewDiff } from '../src/pipeline.js';
import { ContextResolver } from '../src/diff/context.js';
import { RecordedLlmClient } from '../src/llm/recorded.js';
import { ConsoleReporter } from '../src/report/console.js';
import {
  E2E_CONFIG,
  LLM_FIXTURE_DIR,
  loadDiff,
  makeFakeDb,
  readSource,
} from './fixtures/e2e-setup.js';

let resolver: ContextResolver;
beforeAll(async () => {
  resolver = await ContextResolver.create();
});

describe('reviewDiff end-to-end (recorded LLM, fake DB)', () => {
  it('extracts, analyzes, judges, and flags the slow query', async () => {
    const results = await reviewDiff({
      diffText: await loadDiff(),
      config: E2E_CONFIG,
      llm: new RecordedLlmClient(LLM_FIXTURE_DIR),
      db: await makeFakeDb(),
      resolver,
      readFile: readSource,
    });

    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.query.file).toBe('src/users-repo.ts');
    expect(r.query.startLine).toBe(4);
    expect(r.query.sql).toBe('SELECT * FROM users WHERE active = true');
    expect(r.verdict.status).toBe('fail');
    expect(r.verdict.status === 'fail' && r.verdict.reasons.map((x) => x.rule)).toEqual([
      'excessive-rows-filtered',
    ]);
    // The optimizer runs on the failing query and attaches an index suggestion.
    expect(r.suggestion?.indexHints).toEqual([
      'CREATE INDEX CONCURRENTLY idx_users_active ON users (active) WHERE active = true;',
    ]);
  });

  it('renders a console report for the run', async () => {
    const results = await reviewDiff({
      diffText: await loadDiff(),
      config: E2E_CONFIG,
      llm: new RecordedLlmClient(LLM_FIXTURE_DIR),
      db: await makeFakeDb(),
      resolver,
      readFile: readSource,
    });
    const lines: string[] = [];
    new ConsoleReporter((l) => lines.push(l)).report(results);
    expect(lines[0]).toBe('✗ src/users-repo.ts:4');
    expect(lines.at(-1)).toBe('1 queries analyzed, 1 flagged.');
  });
});
