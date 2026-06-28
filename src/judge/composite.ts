import type { Reason, Severity, Suggestion, Verdict } from '../types.js';
import type { Judge, JudgeInput } from './judge.js';

/**
 * Composite judge that combines a heuristic judge and an LLM judge.
 * TODO: Use LLM to combine verdicts to simplify output. (defer after MVP)
 */
export class CompositeJudge implements Judge {
  constructor(
    private readonly heuristic: Judge,
    private readonly llm: Judge,
  ) {}

  async judge(input: JudgeInput): Promise<Verdict> {
    const [heuristic, llm] = await Promise.all([
      this.heuristic.judge(input),
      this.llm.judge(input),
    ]);
    return combineVerdicts(heuristic, llm);
  }
}

const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high', 'critical'];

export function combineVerdicts(heuristic: Verdict, llm: Verdict): Verdict {
  if (heuristic.status === 'pass' && llm.status === 'pass') return { status: 'pass' };

  const reasons: Reason[] = [
    ...(heuristic.status === 'fail' ? heuristic.reasons : []),
    ...(llm.status === 'fail' ? llm.reasons : []),
  ];

  // A tripped heuristic rule is real-plan evidence, so it floors severity at "high";
  // the LLM contributes its own. Take the max.
  const heuristicFloor: Severity | undefined = heuristic.status === 'fail' ? 'high' : undefined;
  const llmSeverity = llm.status === 'fail' ? llm.severity : undefined;
  const severity = maxSeverity(heuristicFloor, llmSeverity);

  const suggestion: Suggestion | undefined = llm.status === 'fail' ? llm.suggestion : undefined;

  return {
    status: 'fail',
    reasons,
    ...(severity ? { severity } : {}),
    ...(suggestion ? { suggestion } : {}),
  };
}

function maxSeverity(a?: Severity, b?: Severity): Severity | undefined {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}
