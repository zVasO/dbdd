import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { QueryResult, CellValue } from '@/lib/types';

interface Props {
  result: QueryResult;
}

export function DataGrid({ result }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 20,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 flex" style={{ background: 'var(--color-bg-secondary)' }}>
        <div
          className="flex-shrink-0 border-b border-r px-2 py-1 text-right font-medium"
          style={{
            width: '50px',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-disabled)',
          }}
        >
          #
        </div>
        {result.columns.map((col) => (
          <div
            key={col.name}
            className="flex-shrink-0 border-b border-r px-2 py-1 font-medium"
            style={{
              width: '180px',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          >
            <div className="truncate">{col.name}</div>
            <div className="truncate text-[10px]" style={{ color: 'var(--color-text-disabled)' }}>
              {col.native_type}
            </div>
          </div>
        ))}
      </div>

      {/* Body */}
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = result.rows[virtualRow.index];
          const isAlt = virtualRow.index % 2 === 1;
          return (
            <div
              key={virtualRow.index}
              className="absolute left-0 top-0 flex w-full"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                background: isAlt ? 'var(--color-grid-row-alt)' : 'transparent',
              }}
            >
              <div
                className="flex-shrink-0 border-r px-2 py-1 text-right"
                style={{
                  width: '50px',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                {virtualRow.index + 1}
              </div>
              {row.cells.map((cell, colIdx) => (
                <div
                  key={colIdx}
                  className="flex-shrink-0 truncate border-r px-2 py-1"
                  style={{
                    width: '180px',
                    borderColor: 'var(--color-border)',
                    color: cell.type === 'Null' ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
                    fontStyle: cell.type === 'Null' ? 'italic' : 'normal',
                    background: cell.type === 'Null' ? 'var(--color-grid-cell-null)' : undefined,
                  }}
                >
                  {formatCell(cell)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatCell(cell: CellValue): string {
  switch (cell.type) {
    case 'Null':
      return 'NULL';
    case 'Integer':
    case 'Float':
      return String(cell.value);
    case 'Boolean':
      return cell.value ? 'true' : 'false';
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid':
      return cell.value;
    case 'Json':
      return JSON.stringify(cell.value);
    case 'Bytes':
      return `[${cell.value.size} bytes]`;
    case 'Array':
      return JSON.stringify(cell.value);
    default:
      return '';
  }
}
