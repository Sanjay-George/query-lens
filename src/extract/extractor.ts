import { z } from 'zod';
import type { LlmClient } from '../llm/client.js';
import type { CodeContext } from '../diff/context.js';
import type { Dialect, ExtractedQuery } from '../types.js';

const ExtractedQuerySchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  sql: z.string().min(1),
  confidence: z.number().min(0).max(1),
  codeSpan: z.string().min(1),
});

const ExtractionSchema = z.object({
  queries: z.array(ExtractedQuerySchema),
});

const SYSTEM = `You extract SQL queries from source code for a database performance reviewer.
Rules:
- Only extract queries that appear in the ADDED/CHANGED lines provided. Ignore unchanged context.
- Reconstruct the literal SQL string as it would be sent to the database. Resolve simple string concatenation, but DO NOT invent table or column names you cannot see.
- Do not attempt to parse or fix the queries, even if they are invalid SQL. Just extract them as-is.
- Replace bound parameters with literals of a plausible type ($1, ?, :name → e.g. 1, 'x') so the SQL is EXPLAIN-able.
- Quote the exact source substring you derived each query from in "codeSpan".
- "confidence" reflects how certain you are this is a real, complete query (0–1). Be conservative; emitting nothing is better than emitting a query you are unsure about.
- If there are no queries in the changed lines, return an empty list.`;

export interface ExtractInput {
  file: string;
  dialect: Dialect;
  codeContext: Pick<CodeContext, 'imports' | 'enclosingFunction'>;
  /** The changed lines, each prefixed with its 1-indexed line number. */
  changedCode: string;
  minConfidence: number;
}

export async function extractQueries(
  llm: LlmClient,
  input: ExtractInput,
): Promise<ExtractedQuery[]> {
  const prompt = buildPrompt(input);
  const result = await llm.generate({
    tier: 'small',
    temperature: 0,
    system: SYSTEM,
    prompt,
    schema: ExtractionSchema,
  });

  return result.queries
    .filter((q) => q.confidence >= input.minConfidence)
    .map((q) => ({
      id: `${input.file}:${q.startLine}`,
      file: input.file,
      startLine: q.startLine,
      endLine: q.endLine,
      source: 'raw' as const,
      dialect: input.dialect,
      sql: q.sql,
      confidence: q.confidence,
      codeSpan: q.codeSpan,
    }));
}

function buildPrompt(input: ExtractInput): string {
  const { file, dialect, codeContext } = input;
  const parts: string[] = [
    `File: ${file}`,
    `Dialect: ${dialect}`,
  ];
  if (codeContext.imports.length > 0) {
    parts.push(`\nImports / use statements:\n${codeContext.imports.join('\n')}`);
  }
  if (codeContext.enclosingFunction) {
    parts.push(`\nEnclosing function:\n${codeContext.enclosingFunction.source}`);
  }
  parts.push(`\nChanged lines (line-numbered):\n${input.changedCode}`);
  return parts.join('\n');
}
