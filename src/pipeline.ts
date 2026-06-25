import type { Config } from './config.js';
import type { LlmClient } from './llm/client.js';
import type { DbAdapter } from './db/adapter.js';
import type { Judge } from './judge/judge.js';
import {
  ContextResolver,
  languageForFile,
  type CodeContext,
} from './diff/context.js';
import { changedLineRanges, parseUnifiedDiff, type DiffFile } from './diff/reader.js';
import { hasQueryShape } from './extract/prefilter.js';
import { extractQueries } from './extract/extractor.js';
import { HeuristicJudge } from './judge/heuristic.js';
import type { ExtractedQuery, ReviewResult } from './types.js';

const EMPTY_CONTEXT: Pick<CodeContext, 'imports' | 'enclosingFunction'> = {
  imports: [],
  enclosingFunction: null,
};

export interface PipelineDeps {
  diffText: string;
  config: Config;
  llm: LlmClient;
  db: DbAdapter;
  resolver: ContextResolver;
  judge?: Judge;
  /** Reads a working-tree file for context resolution. */
  readFile: (path: string) => Promise<string>;
}

export async function reviewDiff(deps: PipelineDeps): Promise<ReviewResult[]> {
  const { config, llm, db, resolver, readFile } = deps;
  const judge = deps.judge ?? new HeuristicJudge();
  const files = parseUnifiedDiff(deps.diffText);

  const queries: ExtractedQuery[] = [];
  for (const file of files) {
    if (!file.newPath || file.hunks.length === 0) continue;
    const changedCode = numberedChangedCode(file);
    if (!changedCode || !hasQueryShape(changedCode)) continue;

    const codeContext = await resolveContext(file, resolver, readFile);
    const extracted = await extractQueries(llm, {
      file: file.newPath,
      dialect: config.db.dialect,
      codeContext,
      changedCode,
      minConfidence: config.thresholds.minExtractorConfidence,
    });
    queries.push(...extracted);
    if (queries.length >= config.thresholds.maxQueriesPerPr) break;
  }

  const capped = queries.slice(0, config.thresholds.maxQueriesPerPr);
  const results: ReviewResult[] = [];
  for (const query of capped) {
    const plan = await db.analyze(query);
    results.push({ query, plan, verdict: judge.judge(plan, config.thresholds) });
  }
  return results;
}

function numberedChangedCode(file: DiffFile): string {
  const lines: string[] = [];
  for (const hunk of file.hunks) {
    for (const added of hunk.addedLines) {
      lines.push(`${added.lineNumber}: ${added.text}`);
    }
  }
  return lines.join('\n');
}

async function resolveContext(
  file: DiffFile,
  resolver: ContextResolver,
  readFile: (path: string) => Promise<string>,
): Promise<Pick<CodeContext, 'imports' | 'enclosingFunction'>> {
  const path = file.newPath;
  if (!path) return EMPTY_CONTEXT;
  const language = languageForFile(path);
  if (!language) return EMPTY_CONTEXT;

  const ranges = changedLineRanges(file);
  if (ranges.length === 0) return EMPTY_CONTEXT;
  const startLine = Math.min(...ranges.map((r) => r.start));
  const endLine = Math.max(...ranges.map((r) => r.end));

  try {
    const source = await readFile(path);
    return await resolver.resolve(language, source, { startLine, endLine });
  } catch {
    // File not in the working tree (e.g. reviewing a remote diff) — fall back
    // to the changed lines alone rather than failing the whole run.
    return EMPTY_CONTEXT;
  }
}
