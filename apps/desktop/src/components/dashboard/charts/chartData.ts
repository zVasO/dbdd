import type { QueryResult } from '@/lib/types';

/**
 * Max rows a plotted chart or table widget renders. Beyond this, recharts (SVG)
 * and un-virtualized tables freeze, so we truncate and surface a notice rather
 * than lock the dashboard tab.
 */
export const MAX_WIDGET_ROWS = 2000;

export function capRows(
  result: QueryResult,
  max: number,
): { result: QueryResult; capped: boolean; total: number } {
  const total = result.rows.length;
  if (total <= max) return { result, capped: false, total };
  return { result: { ...result, rows: result.rows.slice(0, max) }, capped: true, total };
}
