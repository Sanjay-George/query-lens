import { z } from 'zod';
import type { LlmClient } from '../llm/client.js';
import type { ExtractedQuery, NormalizedPlan, PlanNode, Reason, Suggestion } from '../types.js';

const SuggestionSchema = z.object({
  hasSuggestion: z.boolean(),
  rationale: z.string(),
  rewrittenSql: z.string().optional(),
  indexHints: z.array(z.string()).optional(),
});

export interface OptimizeInput {
  query: ExtractedQuery;
  plan: NormalizedPlan;
  reasons: Reason[];
}

export interface Optimizer {
  /** Propose a better query, or `null` when there's no meaningful improvement. */
  optimize(input: OptimizeInput): Promise<Suggestion | null>;
}

const SYSTEM = `You are a senior database performance engineer reviewing one SQL query that an automated judge flagged as potentially slow.
Your job: propose a concretely better version, or decline.
Rules:
- Only suggest a change you are confident is a real improvement for THIS plan and dialect. Reordering clauses without changing the plan is NOT an improvement.
- Preserve result semantics exactly. Do not change which rows or columns are returned.
- Prefer the smallest effective change. An index alone is fine; a rewrite alone is fine; both is fine.
- If you cannot find a meaningfully better query or a clearly useful index, set hasSuggestion to false. Returning nothing is strictly better than weak "consider adding an index" filler.
- "rewrittenSql", when present, must be a complete, runnable statement in the same dialect.
- "indexHints", when present, are DDL statements (e.g. CREATE INDEX ...) that would help this query.`;

export class LlmOptimizer implements Optimizer {
  constructor(private readonly llm: LlmClient) {}

  async optimize(input: OptimizeInput): Promise<Suggestion | null> {
    const result = await this.llm.generate({
      tier: 'large',
      temperature: 0,
      system: SYSTEM,
      prompt: buildPrompt(input),
      schema: SuggestionSchema,
    });

    if (!result.hasSuggestion) return null;

    const rewrittenSql = result.rewrittenSql?.trim();
    const indexHints = (result.indexHints ?? []).map((h) => h.trim()).filter((h) => h.length > 0);
    // A "suggestion" with neither a rewrite nor an index is filler — drop it.
    if (!rewrittenSql && indexHints.length === 0) return null;

    return {
      rationale: result.rationale,
      ...(rewrittenSql ? { rewrittenSql } : {}),
      ...(indexHints.length > 0 ? { indexHints } : {}),
    };
  }
}

export function buildPrompt(input: OptimizeInput): string {
  const { query, plan, reasons } = input;
  return [
    `Dialect: ${query.dialect}`,
    `\nFlagged SQL:\n${query.sql}`,
    `\nWhy it was flagged:\n${reasons.map((r) => `- [${r.rule}] ${r.detail}`).join('\n')}`,
    `\nQuery plan summary:\n${summarizePlan(plan)}`,
  ].join('\n');
}

function summarizePlan(plan: NormalizedPlan): string {
  const lines: string[] = [];
  if (plan.totalCostEstimate !== undefined) lines.push(`total cost estimate: ${plan.totalCostEstimate}`);
  if (plan.actualTimeMs !== undefined) lines.push(`actual time: ${plan.actualTimeMs} ms`);
  if (plan.rowsReturned !== undefined) lines.push(`rows returned: ${plan.rowsReturned}`);
  for (const op of plan.ops) describeOp(op, 0, lines);
  return lines.join('\n');
}

function describeOp(op: PlanNode, depth: number, out: string[]): void {
  const parts = [op.kind];
  if (op.table) parts.push(`on ${op.table}`);
  if (op.indexUsed) parts.push(`using ${op.indexUsed}`);
  if (op.rowsRemovedByFilter !== undefined) parts.push(`rowsRemovedByFilter=${op.rowsRemovedByFilter}`);
  out.push(`${'  '.repeat(depth)}- ${parts.join(' ')}`);
  for (const child of op.children) describeOp(child, depth + 1, out);
}
