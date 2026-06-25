// Cheap, dependency-free gate so files with no query-shaped tokens never hit
// the LLM extractor. Errs toward letting things through — a false positive just
// costs one small-tier call; a false negative silently drops a real query.

const SQL_VERB = /\b(select|insert\s+into|update|delete\s+from|with)\b/i;
const QUERY_CALLSITE = /(->|\.|::)\s*(query|execute|raw|prepare|exec|select|statement)\s*\(/i;

export function hasQueryShape(text: string): boolean {
  return SQL_VERB.test(text) || QUERY_CALLSITE.test(text);
}
