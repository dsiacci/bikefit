// Published reference ranges. Every entry names its source; an angle without a
// published range we could check is shown without a verdict. These are ranges
// for groups of riders, not targets for one person.

export const RANGES = [];

/**
 * Compare a summary ({median, q1, q3, n}) with a range {metric, low, high}.
 * The verdict uses the median: below, within or above.
 */
export function compareToRange(range, summary) {
  if (!summary || !Number.isFinite(summary.median)) return null;
  const m = summary.median;
  const verdict = m < range.low ? 'below' : m > range.high ? 'above' : 'within';
  return { metric: range.metric, low: range.low, high: range.high, median: m, verdict, kind: range.kind, source: range.source, note: range.note ?? null };
}
