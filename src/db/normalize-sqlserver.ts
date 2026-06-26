import { XMLParser } from 'fast-xml-parser';
import type { NormalizedPlan, PlanNode } from '../types.js';

// SQL Server SHOWPLAN_XML / STATISTICS XML normalizer. The estimated plan
// (SET SHOWPLAN_XML ON) and the actual plan (SET STATISTICS XML ON) share the
// same element tree; the only difference is that the actual plan carries
// `<RunTimeInformation>` with real row counts and timing. We read actuals when
// present and fall back to estimates otherwise.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

// PhysicalOps that read an entire table — the cross-dialect equivalent of a
// Postgres "Seq Scan", which is the string the heuristic judge keys on. An
// "Index Seek" / "Clustered Index Seek" is a targeted lookup and is left alone.
const FULL_SCAN_OPS = new Set(['Table Scan', 'Clustered Index Scan', 'Index Scan']);

interface RawRelOp {
  '@_PhysicalOp'?: string;
  '@_EstimateRows'?: string;
  '@_EstimateRowsRead'?: string;
  '@_EstimatedTotalSubtreeCost'?: string;
  RunTimeInformation?: { RunTimeCountersPerThread?: RawThread | RawThread[] };
  [key: string]: unknown;
}

interface RawThread {
  '@_ActualRows'?: string;
  '@_ActualRowsRead'?: string;
  '@_ActualElapsedms'?: string;
}

interface RawObject {
  '@_Table'?: string;
  '@_Index'?: string;
}

export function normalizeSqlServerPlan(showplanXml: string): NormalizedPlan {
  const root = extractRootRelOp(parser.parse(showplanXml));
  const ops = root ? [toNode(root)] : [];
  const plan: NormalizedPlan = { ops, raw: showplanXml };
  if (root) {
    const cost = num(root['@_EstimatedTotalSubtreeCost']);
    if (cost !== undefined) plan.totalCostEstimate = cost;
    const actualRows = threadSum(root, '@_ActualRows');
    if (actualRows !== undefined) plan.rowsReturned = actualRows;
    const elapsed = threadMax(root, '@_ActualElapsedms');
    if (elapsed !== undefined) plan.actualTimeMs = elapsed;
  }
  return plan;
}

function extractRootRelOp(parsed: unknown): RawRelOp | null {
  const stmt = pick(parsed, [
    'ShowPlanXML',
    'BatchSequence',
    'Batch',
    'Statements',
    'StmtSimple',
    'QueryPlan',
  ]);
  const relOp = first(record(stmt)?.['RelOp']);
  return relOp ? (relOp as RawRelOp) : null;
}

function toNode(relOp: RawRelOp): PlanNode {
  const physicalOp = relOp['@_PhysicalOp'] ?? 'Unknown';
  const node: PlanNode = {
    kind: FULL_SCAN_OPS.has(physicalOp) ? 'Seq Scan' : physicalOp,
    children: childRelOps(relOp).map(toNode),
  };

  const obj = findObject(relOp);
  if (obj?.['@_Table']) node.table = stripBrackets(obj['@_Table']);
  if (obj?.['@_Index']) node.indexUsed = stripBrackets(obj['@_Index']);

  const estRows = num(relOp['@_EstimateRows']);
  if (estRows !== undefined) node.estimatedRows = estRows;

  const actualRows = threadSum(relOp, '@_ActualRows');
  if (actualRows !== undefined) node.actualRows = actualRows;

  const elapsed = threadMax(relOp, '@_ActualElapsedms');
  if (elapsed !== undefined) node.actualTimeMs = elapsed;

  // SQL Server reports rows read by a scan separately from rows it emits; the
  // gap is rows discarded by a pushed-down predicate — the Postgres "Rows
  // Removed by Filter" analog. Prefer actuals; fall back to the estimate.
  const rowsRead = threadSum(relOp, '@_ActualRowsRead') ?? num(relOp['@_EstimateRowsRead']);
  const rowsOut = actualRows ?? estRows;
  if (rowsRead !== undefined && rowsOut !== undefined && rowsRead > rowsOut) {
    node.rowsRemovedByFilter = rowsRead - rowsOut;
  }

  return node;
}

// The child RelOps live nested under the operator-specific element (e.g.
// <Hash>, <NestedLoops>), which varies per physical op. Rather than enumerate
// every op type, walk the RelOp's value tree for the next layer of RelOps and
// stop there — those are the direct children.
function childRelOps(relOp: RawRelOp): RawRelOp[] {
  const out: RawRelOp[] = [];
  const visit = (val: unknown): void => {
    if (Array.isArray(val)) {
      val.forEach(visit);
      return;
    }
    if (!val || typeof val !== 'object') return;
    const rec = val as Record<string, unknown>;
    if ('RelOp' in rec) {
      for (const child of arr(rec['RelOp'])) out.push(child as RawRelOp);
      return;
    }
    for (const [key, child] of Object.entries(rec)) {
      if (key.startsWith('@_')) continue;
      visit(child);
    }
  };
  for (const [key, val] of Object.entries(relOp)) {
    if (key.startsWith('@_') || key === 'RunTimeInformation' || key === 'OutputList') continue;
    visit(val);
  }
  return out;
}

function findObject(relOp: RawRelOp): RawObject | null {
  let found: RawObject | null = null;
  const visit = (val: unknown): void => {
    if (found) return;
    if (Array.isArray(val)) {
      val.forEach(visit);
      return;
    }
    if (!val || typeof val !== 'object') return;
    const rec = val as Record<string, unknown>;
    if ('Object' in rec) {
      const obj = first(rec['Object']) as RawObject | undefined;
      if (obj?.['@_Table']) {
        found = obj;
        return;
      }
    }
    if ('RelOp' in rec) return; // don't descend into child operators
    for (const [key, child] of Object.entries(rec)) {
      if (key.startsWith('@_')) continue;
      visit(child);
    }
  };
  for (const [key, val] of Object.entries(relOp)) {
    if (key.startsWith('@_') || key === 'RunTimeInformation') continue;
    visit(val);
  }
  return found;
}

function threads(relOp: RawRelOp): RawThread[] {
  return arr(relOp.RunTimeInformation?.RunTimeCountersPerThread) as RawThread[];
}

function threadSum(relOp: RawRelOp, attr: keyof RawThread): number | undefined {
  const values = threads(relOp)
    .map((t) => num(t[attr]))
    .filter((n): n is number => n !== undefined);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) : undefined;
}

function threadMax(relOp: RawRelOp, attr: keyof RawThread): number | undefined {
  const values = threads(relOp)
    .map((t) => num(t[attr]))
    .filter((n): n is number => n !== undefined);
  return values.length > 0 ? Math.max(...values) : undefined;
}

function stripBrackets(name: string): string {
  return name.replace(/^\[|\]$/g, '');
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

function arr<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pick(parsed: unknown, path: string[]): unknown {
  let current: unknown = parsed;
  for (const key of path) {
    const rec = record(first(current));
    if (!rec) return null;
    current = rec[key];
  }
  return first(current);
}
