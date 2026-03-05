import { useCallback, useState, useMemo } from 'react';
import { Copy, CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useQueryBuilderStore } from '@/stores/queryBuilderStore';

// Simple SQL keyword highlighting
const SQL_KEYWORDS = new Set([
  'SELECT', 'DISTINCT', 'FROM', 'AS', 'WHERE', 'AND', 'OR', 'NOT',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON',
  'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'EXISTS',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX',
  'HAVING', 'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
]);

function highlightSQL(sql: string): React.ReactNode[] {
  const lines = sql.split('\n');
  return lines.map((line, lineIdx) => {
    // Tokenize the line
    const tokens: React.ReactNode[] = [];
    // Split by word boundaries while preserving whitespace and punctuation
    const parts = line.split(/(\s+|[(),.*=<>!]+|'[^']*')/g);
    let keyIdx = 0;

    for (const part of parts) {
      if (!part) continue;
      const key = `${lineIdx}-${keyIdx++}`;

      if (SQL_KEYWORDS.has(part.toUpperCase())) {
        // SQL keyword
        tokens.push(
          <span key={key} className="text-blue-400 font-semibold">
            {part}
          </span>
        );
      } else if (/^'[^']*'$/.test(part)) {
        // String literal
        tokens.push(
          <span key={key} className="text-green-400">
            {part}
          </span>
        );
      } else if (/^\d+$/.test(part)) {
        // Number
        tokens.push(
          <span key={key} className="text-orange-400">
            {part}
          </span>
        );
      } else if (/^[(),.*=<>!]+$/.test(part)) {
        // Operator/punctuation
        tokens.push(
          <span key={key} className="text-muted-foreground">
            {part}
          </span>
        );
      } else {
        // Identifier (table name, column name, alias)
        tokens.push(
          <span key={key} className="text-foreground">
            {part}
          </span>
        );
      }
    }

    return (
      <div key={lineIdx} className="leading-6">
        {tokens}
      </div>
    );
  });
}

export function SQLPreview() {
  const [copied, setCopied] = useState(false);
  const generateSQL = useQueryBuilderStore((s) => s.generateSQL);
  const nodes = useQueryBuilderStore((s) => s.nodes);
  const joins = useQueryBuilderStore((s) => s.joins);
  const whereFilters = useQueryBuilderStore((s) => s.whereFilters);
  const groupByColumns = useQueryBuilderStore((s) => s.groupByColumns);
  const orderByColumns = useQueryBuilderStore((s) => s.orderByColumns);
  const limit = useQueryBuilderStore((s) => s.limit);
  const distinct = useQueryBuilderStore((s) => s.distinct);

  // Regenerate SQL whenever dependencies change
  const sql = useMemo(() => {
    return generateSQL();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, joins, whereFilters, groupByColumns, orderByColumns, limit, distinct, generateSQL]);

  const handleCopy = useCallback(async () => {
    if (!sql) return;
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [sql]);

  const highlighted = useMemo(() => {
    if (!sql) return null;
    return highlightSQL(sql);
  }, [sql]);

  return (
    <div className="relative h-full flex flex-col">
      {/* Copy button */}
      <div className="absolute top-2 right-2 z-10">
        <Button
          variant="ghost"
          size="xs"
          onClick={handleCopy}
          disabled={!sql}
          className="opacity-70 hover:opacity-100"
        >
          {copied ? (
            <CheckSquare className="size-3 text-green-500" />
          ) : (
            <Copy className="size-3" />
          )}
        </Button>
      </div>

      {/* SQL code */}
      <div className="flex-1 overflow-y-auto p-3">
        {sql ? (
          <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
            {highlighted}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-muted-foreground">
              Add tables and select columns to generate SQL
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
