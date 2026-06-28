import { z } from 'zod';
import type { LlmClient } from '../llm/client.js';
import type { CodeContext } from '../diff/context.js';
import type { Dialect, ExtractedQuery } from '../types.js';

const ExtractedQuerySchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  source: z.enum([
    'raw',
    'eloquent',
    'prisma',
    'sqlalchemy',
    'typeorm',
    'drizzle',
    'sequelize',
    'django',
  ]),
  sql: z.string().min(1),
  confidence: z.number().min(0).max(1),
  codeSpan: z.string().min(1),
});

const ExtractionSchema = z.object({
  queries: z.array(ExtractedQuerySchema),
});

const SYSTEM = `You extract database queries from source code for a database performance reviewer.
Queries appear in two forms, and you handle both:
- Raw SQL: literal SQL strings (possibly built via concatenation).
- Query builders / ORMs: method chains that generate SQL (Eloquent, Prisma, SQLAlchemy, TypeORM, Drizzle, Sequelize, Django ORM). Translate the chain into the literal SQL it would emit.
Rules:
- Only extract queries that appear in the ADDED/CHANGED lines provided. Ignore unchanged context.
- Reconstruct the literal SQL string as it would be sent to the database. Resolve simple string concatenation, but DO NOT invent table or column names you cannot see. For builder chains, infer table/column names only from the chain itself and the imports/enclosing function provided — if a model maps to an unseen table, prefer a lower confidence over guessing.
- For query builders, only translate parts of the chain you are confident about (where, select, join, orderBy, limit, etc.). Do not invent clauses the chain does not express.
- Do not attempt to fix queries, even if the resulting SQL is invalid. Extract/translate them as-is.
- Replace bound parameters and builder arguments with literals of a plausible type ($1, ?, :name, variables → e.g. 1, 'x') so the SQL is EXPLAIN-able.
- Set "source" to the query's origin: "raw" for literal SQL, or the matching builder.
- Quote the exact source substring you derived each query from in "codeSpan" (for a builder, the method chain).
- "confidence" reflects how certain you are this is a real, complete query and — for builders — that your SQL translation is faithful (0–1). Be conservative; emitting nothing is better than emitting a query you are unsure about.
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
    tier: 'large',
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
      source: q.source,
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
