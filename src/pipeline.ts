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
import { LlmJudge } from './judge/llm.js';
import { CompositeJudge } from './judge/composite.js';
import { Rules } from './judge/rules.js';
// Optimizer shelved — the LLM judge produces suggestions itself (DECISIONS §13).
import type { ExtractedQuery, NormalizedPlan, ReviewResult } from './types.js';
import chalk from 'chalk';

const EMPTY_CONTEXT: Pick<CodeContext, 'imports' | 'enclosingFunction'> = {
  imports: [],
  enclosingFunction: null,
};


export interface PipelineDeps {
  /** The unified diff text to review. */
  diffText: string;
  /** Configuration for the review run. */
  config: Config;
  /** The LLM client to use for query extraction and optimization. */
  llm: LlmClient;
  /** The database adapter to use for query analysis. */
  db: DbAdapter;
  /** The context resolver to use for extracting code context. */
  resolver: ContextResolver;
  /** The judge to use for evaluating queries. Defaults to the composite (heuristic + LLM). */
  judge?: Judge;
  /** Reads a working-tree file for context resolution. */
  readFile: (path: string) => Promise<string>;
  /** Print per-query error details to stderr. */
  verbose?: boolean;
}

export async function reviewDiff(deps: PipelineDeps): Promise<ReviewResult[]> {
  const { config, llm, db, resolver, readFile, verbose } = deps;

  const judge = deps.judge ?? new CompositeJudge(new HeuristicJudge(), new LlmJudge(llm));
  const files = parseUnifiedDiff(deps.diffText);

  const queries: ExtractedQuery[] = [];

  // Review each file
  for (const file of files) {
    if (!file.newPath || file.hunks.length === 0) continue;
    const changedCode = numberedChangedCode(file);
    if (!changedCode || !hasQueryShape(changedCode)) continue;

    const codeContext = await resolveContext(file, resolver, readFile);
    // Extract queries from the changed code
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

  // TODO: remove logs after testing
  console.log(chalk.blue(`Extracted ${queries.length} queries from diff.`));
  console.log(chalk.blue(JSON.stringify(queries, null, 2)));


  // INFO: Cap number of reviewed queries to avoid excessive LLM calls and DB analysis.
  const capped = queries.slice(0, config.thresholds.maxQueriesPerPr);
  const results: ReviewResult[] = [];

  // Review: analyze (best-effort) then judge.
  for (const query of capped) {
    let result: ReviewResult;
    // A plan sharpens the judge but isn't required (DECISIONS §13).
    let plan: NormalizedPlan | undefined;
    try {
      plan = await analyzeQuery(db, query);
    } catch (err) {
      if (verbose) {
        console.warn(
          chalk.yellow(`No plan for query ${query.id}: ${errorMessage(err)} — judging without it.`),
        );
      }
    }
    const verdict = await judge.judge({
      query,
      thresholds: config.thresholds,
      ...(plan ? { plan } : {}),
    });
    result = { query, verdict, ...(plan ? { plan } : {}) };

    results.push(result);
  }
  return results;
}

async function analyzeQuery(db: DbAdapter, query: ExtractedQuery): Promise<NormalizedPlan> {
  try {
    return await db.analyze(query);
  } catch (err) {
    // Driver errors (e.g. mssql's "'NOW' is not a recognized built-in function
    // name.") carry no context about which query failed. Pinpoint it: where the
    // query came from, its dialect, and the SQL we sent — then preserve the
    // original error as `cause` so the stack/driver detail isn't lost.
    const where = `${query.file}:${query.startLine} [${query.dialect}]`;
    throw new Error(
      `Failed to analyze query at ${where}: ${errorMessage(err)}\n  SQL: ${singleLine(query.sql)}`,
      { cause: err },
    );
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function singleLine(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
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
