import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Config } from '../../src/config.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import { normalizePostgresPlan } from '../../src/db/normalize-postgres.js';
import type { ExtractedQuery, NormalizedPlan } from '../../src/types.js';

export const LLM_FIXTURE_DIR = fileURLToPath(new URL('./llm', import.meta.url));

export const E2E_CONFIG: Config = {
  db: { dialect: 'postgres', url: 'postgres://unused/in-tests' },
  thresholds: {
    slowQueryMs: 200,
    largeTableRows: 10_000,
    maxQueriesPerPr: 20,
    minExtractorConfidence: 0.7,
    rowsFilteredRatio: 0.9,
  },
  ignore: [],
};

export function loadDiff(): Promise<string> {
  return readFile(fileURLToPath(new URL('./diffs/add-user-query.diff', import.meta.url)), 'utf8');
}

// Maps the diff's file path to its working-tree source for context resolution.
const SOURCE_BY_PATH: Record<string, URL> = {
  'src/users-repo.ts': new URL('./sources/users-repo.ts', import.meta.url),
};

export async function readSource(path: string): Promise<string> {
  const url = SOURCE_BY_PATH[path];
  if (!url) throw new Error(`no fixture source for ${path}`);
  return readFile(fileURLToPath(url), 'utf8');
}

/** Returns the captured seq-scan-with-filter plan for every query. */
export async function makeFakeDb(): Promise<DbAdapter> {
  const json = JSON.parse(
    await readFile(fileURLToPath(new URL('./plans/seq-scan-filter.json', import.meta.url)), 'utf8'),
  );
  const plan: NormalizedPlan = normalizePostgresPlan(json);
  return {
    analyze: (_q: ExtractedQuery) => Promise.resolve(plan),
    close: () => Promise.resolve(),
  };
}

/** The canned extractor output recorded as the LLM fixture. */
export const CANNED_EXTRACTION = {
  queries: [
    {
      startLine: 4,
      endLine: 6,
      sql: 'SELECT * FROM users WHERE active = true',
      confidence: 0.95,
      codeSpan: 'pool.query(\n    "SELECT * FROM users WHERE active = true",\n  )',
    },
  ],
};
