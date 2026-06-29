import { z } from 'zod';
import type { LlmClient } from '../llm/client.js';
import type { Dialect, NormalizedPlan, PlanNode, Reason, Severity, Suggestion, Verdict } from '../types.js';
import type { Judge, JudgeInput } from './judge.js';
import { Rules } from './rules.js';

const SYSTEM= `You are a senior database engineer reviewing a pull-request diff.
Your only job is to spot query-performance problems that will hurt at production scale.

Think like someone who has been paged for slow queries before

Reporting rules
- Set isConcern false with empty findings if the query is fine at scale.
- severity = production impact: critical/high/medium/low.
- Tune fixes to the stated dialect. Offer a concrete rewrite or suggestion. Otherwise set hasSuggestion
  false rather than emiting a filler. Preserve result semantics.
- Return similar issues as a single string rather than breaking into multiple strings in findings array. 
  Break up findings only when they are distinct issues.
- Break distinct rationale (suggestion) into bullet points, if that makes it clearer. Use markdown bullets, not numbers.
`

const JudgeSchema = z.object({
  isConcern: z.boolean(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  findings: z.array(z.string()),
  suggestion: z.object({
    hasSuggestion: z.boolean(),
    rationale: z.string(),
    // rewrittenSql: z.string().nullable(),
    // indexHints: z.array(z.string()).nullable(),
  }),
});

/**
 * LLM-based judge that evaluates a query and its execution plan (if present) for scaling risk.
 */
export class LlmJudge implements Judge {
  constructor(private readonly llm: LlmClient) {}

  async judge({ query, plan }: JudgeInput): Promise<Verdict> {
    const result = await this.llm.generate({
      tier: 'small',
      temperature: 0,
      system: SYSTEM,
      prompt: buildPrompt(query.dialect, query.sql, query.codeSpan, plan),
      schema: JudgeSchema,
    });

    if (!result.isConcern || result.findings.length === 0) return { status: 'pass' };

    const reasons: Reason[] = result.findings
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .map((detail) => ({ rule: Rules.llmReview, detail }));
    if (reasons.length === 0) return { status: 'pass' };

    const suggestion = toSuggestion(result.suggestion);
    return {
      status: 'fail',
      reasons,
      severity: result.severity as Severity,
      ...(suggestion ? { suggestion } : {}),
    };
  }
}

function toSuggestion(s: z.infer<typeof JudgeSchema>['suggestion']): Suggestion | undefined {
  if (!s.hasSuggestion) return undefined;
  // const rewrittenSql = s.rewrittenSql?.trim() || undefined;
  // const indexHints = (s.indexHints ?? []).map((h) => h.trim()).filter((h) => h.length > 0);
  // if (!rewrittenSql && indexHints.length === 0) return undefined;
  return {
    rationale: s.rationale,
    // ...(rewrittenSql ? { rewrittenSql } : {}),
    // ...(indexHints.length > 0 ? { indexHints } : {}),
  };
}

export function buildPrompt(
  dialect: Dialect,
  sql: string,
  codeSpan: string,
  plan?: NormalizedPlan,
): string {
  return [
    `Dialect: ${dialect}`,
    `\nQuery:\n${sql}`,
    `\nOriginating code:\n${codeSpan}`,
    plan ? `\nExecution plan:\n${summarizePlan(plan)}` : '\nExecution plan: none (judge from the SQL).',
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
  if (op.actualRows !== undefined) parts.push(`rows=${op.actualRows}`);
  if (op.rowsRemovedByFilter !== undefined) parts.push(`rowsRemovedByFilter=${op.rowsRemovedByFilter}`);
  out.push(`${'  '.repeat(depth)}- ${parts.join(' ')}`);
  for (const child of op.children) describeOp(child, depth + 1, out);
}
