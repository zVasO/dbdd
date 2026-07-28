import type { ColumnData } from '@/lib/types';

// Stable empty-array identity for the columnar-data fallback, so downstream
// useMemo/useCallback hooks keyed on this value don't invalidate every render.
export const EMPTY_COLUMNS: ColumnData[] = [];

/**
 * Resolves the grid's columnar data source: an explicit `data` prop (e.g. from
 * TableStructureView's synthetic results) takes priority over the active tab's
 * result-store data.
 */
export function resolveColumnarSource(
  explicitData: ColumnData[] | undefined,
  explicitRowCount: number | undefined,
  storeData: ColumnData[] | undefined,
  storeRowCount: number | undefined,
  fallbackRowCount: number,
): { data: ColumnData[]; rowCount: number } {
  if (explicitData) {
    return { data: explicitData, rowCount: explicitRowCount ?? fallbackRowCount };
  }
  return { data: storeData ?? EMPTY_COLUMNS, rowCount: storeRowCount ?? fallbackRowCount };
}
