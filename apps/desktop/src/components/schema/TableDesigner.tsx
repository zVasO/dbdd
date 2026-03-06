import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  Play,
  Check,
  Key,
  Hash,
  Loader2,
  Table2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { ipc } from '@/lib/ipc';
import { useConnectionStore } from '@/stores/connectionStore';
import {
  useTableDesignerStore,
  COMMON_TYPES,
  type ColumnDefinition,
  type SqlDialect,
} from '@/stores/tableDesignerStore';

// === Props ===

interface TableDesignerProps {
  database?: string;
  table?: string; // if provided, load existing structure for ALTER mode
}

// === Component ===

export function TableDesigner({ database, table }: TableDesignerProps) {
  const connectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeConfig = useConnectionStore((s) => s.activeConfig);

  const {
    tableName,
    columns,
    isEditing,
    dialect,
    setTableName,
    setDialect,
    addColumn,
    removeColumn,
    updateColumn,
    moveColumn,
    loadFromStructure,
    reset,
    generateDDL,
  } = useTableDesignerStore();

  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Auto-detect dialect from connection config
  useEffect(() => {
    if (activeConfig) {
      switch (activeConfig.db_type) {
        case 'mysql':
          setDialect('mysql');
          break;
        case 'postgres':
          setDialect('postgresql');
          break;
        case 'sqlite':
          setDialect('sqlite');
          break;
      }
    }
  }, [activeConfig, setDialect]);

  // Load existing table structure if in edit mode
  useEffect(() => {
    if (table && database && connectionId) {
      setLoading(true);
      setError(null);
      ipc
        .getTableStructure(connectionId, {
          database,
          schema: null,
          table,
        })
        .then((structure) => {
          loadFromStructure(structure);
          setLoading(false);
        })
        .catch((e) => {
          setError(`Failed to load table structure: ${String(e)}`);
          setLoading(false);
        });
    } else {
      reset();
    }
    // Only run on mount or when table/database/connectionId change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, database, connectionId]);

  const ddl = useMemo(() => generateDDL(), [
    tableName,
    columns,
    isEditing,
    dialect,
    generateDDL,
  ]);

  const handleCopyDDL = useCallback(() => {
    navigator.clipboard.writeText(ddl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [ddl]);

  const handleExecute = useCallback(async () => {
    if (!connectionId) {
      setError('No active connection');
      return;
    }
    if (!ddl || ddl.startsWith('--')) {
      setError('No valid DDL to execute');
      return;
    }

    setExecuting(true);
    setError(null);
    setSuccess(null);

    try {
      // Split multi-statement DDL and execute each
      const statements = ddl
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('--'));

      for (const stmt of statements) {
        await ipc.executeQuery(connectionId, stmt + ';');
      }

      setSuccess(
        isEditing
          ? `Table "${tableName}" altered successfully`
          : `Table "${tableName}" created successfully`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setExecuting(false);
    }
  }, [connectionId, ddl, isEditing, tableName]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm">Loading table structure...</span>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border bg-muted px-3 py-2">
          <Table2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isEditing ? 'Alter Table' : 'Create Table'}
          </span>

          <div className="flex items-center gap-2 ml-2">
            <Input
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="table_name"
              className="h-7 w-52 bg-background text-xs font-mono"
            />
            {database && (
              <Badge variant="outline" className="text-[10px] font-normal">
                {database}
              </Badge>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Select value={dialect} onValueChange={(v) => setDialect(v as SqlDialect)}>
              <SelectTrigger className="h-7 w-28 text-xs" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mysql">MySQL</SelectItem>
                <SelectItem value="postgresql">PostgreSQL</SelectItem>
                <SelectItem value="sqlite">SQLite</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Column Grid */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <ScrollArea className="flex-1">
            <table className="w-full text-xs" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
              <thead>
                <tr className="sticky top-0 z-10 bg-muted text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-8 px-2 py-2 font-semibold text-center">#</th>
                  <th className="px-2 py-2 font-semibold min-w-[140px]">Name</th>
                  <th className="px-2 py-2 font-semibold min-w-[120px]">Type</th>
                  <th className="px-2 py-2 font-semibold w-16">Length</th>
                  <th className="px-2 py-2 font-semibold w-16 text-center">Nullable</th>
                  <th className="px-2 py-2 font-semibold min-w-[100px]">Default</th>
                  <th className="px-2 py-2 font-semibold w-10 text-center">PK</th>
                  <th className="px-2 py-2 font-semibold w-14 text-center">Unique</th>
                  <th className="px-2 py-2 font-semibold w-16 text-center">Auto Inc</th>
                  <th className="px-2 py-2 font-semibold min-w-[120px]">Comment</th>
                  <th className="w-24 px-2 py-2 font-semibold text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col, i) => (
                  <ColumnRow
                    key={col.id}
                    column={col}
                    index={i}
                    isFirst={i === 0}
                    isLast={i === columns.length - 1}
                    dialect={dialect}
                    onUpdate={(updates) => updateColumn(col.id, updates)}
                    onRemove={() => removeColumn(col.id)}
                    onMoveUp={() => moveColumn(col.id, 'up')}
                    onMoveDown={() => moveColumn(col.id, 'down')}
                  />
                ))}
              </tbody>
            </table>

            {/* Add column button */}
            <div className="border-t border-border/30 px-2 py-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={addColumn}
              >
                <Plus className="h-3 w-3" />
                Add Column
              </Button>
            </div>
          </ScrollArea>

          <Separator />

          {/* DDL Preview Panel */}
          <div className="flex flex-col border-t border-border" style={{ minHeight: '160px', maxHeight: '300px' }}>
            <div className="flex items-center justify-between bg-muted px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                DDL Preview
              </span>
              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={handleCopyDDL}
                    >
                      {copied ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">{copied ? 'Copied!' : 'Copy DDL'}</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1.5 px-2 text-xs"
                      onClick={handleExecute}
                      disabled={executing || !connectionId || !ddl || ddl.startsWith('--')}
                    >
                      {executing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      Execute
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Execute DDL against the active connection</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Status messages */}
            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 px-3 py-1.5 text-xs text-red-500">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span className="truncate">{error}</span>
                <button
                  className="ml-auto text-[10px] underline"
                  onClick={() => setError(null)}
                >
                  dismiss
                </button>
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 bg-green-500/10 px-3 py-1.5 text-xs text-green-500">
                <Check className="h-3 w-3 shrink-0" />
                <span className="truncate">{success}</span>
                <button
                  className="ml-auto text-[10px] underline"
                  onClick={() => setSuccess(null)}
                >
                  dismiss
                </button>
              </div>
            )}

            {/* DDL Code Block */}
            <ScrollArea className="flex-1">
              <pre
                className="px-3 py-2 text-[11px] leading-relaxed text-foreground/90"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {ddl.split('\n').map((line, i) => (
                  <div key={i} className="flex">
                    <span className="inline-block w-7 shrink-0 select-none text-right text-muted-foreground/40 mr-3">
                      {i + 1}
                    </span>
                    <span>
                      <DDLLine line={line} />
                    </span>
                  </div>
                ))}
              </pre>
            </ScrollArea>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// === Column Row ===

interface ColumnRowProps {
  column: ColumnDefinition;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  dialect: SqlDialect;
  onUpdate: (updates: Partial<ColumnDefinition>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function ColumnRow({
  column,
  index,
  isFirst,
  isLast,
  dialect,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ColumnRowProps) {
  const [showTypeSuggestions, setShowTypeSuggestions] = useState(false);
  const typeSuggestions = COMMON_TYPES[dialect];

  const filteredSuggestions = column.type
    ? typeSuggestions.filter((t) =>
        t.toLowerCase().startsWith(column.type.toLowerCase()),
      )
    : typeSuggestions;

  return (
    <tr
      className={cn(
        'border-b border-border/30 group',
        index % 2 === 1 && 'bg-muted/20',
      )}
    >
      {/* # */}
      <td className="px-2 py-1 text-center text-muted-foreground/60">
        {index + 1}
      </td>

      {/* Name */}
      <td className="px-1 py-1">
        <Input
          value={column.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="column_name"
          className="h-6 border-transparent bg-transparent px-1.5 text-xs font-mono focus:border-border focus:bg-background"
        />
      </td>

      {/* Type */}
      <td className="px-1 py-1 relative">
        <Input
          value={column.type}
          onChange={(e) => onUpdate({ type: e.target.value.toUpperCase() })}
          onFocus={() => setShowTypeSuggestions(true)}
          onBlur={() => {
            // Small delay to allow click on suggestion
            setTimeout(() => setShowTypeSuggestions(false), 150);
          }}
          placeholder="VARCHAR"
          className="h-6 border-transparent bg-transparent px-1.5 text-xs font-mono focus:border-border focus:bg-background"
        />
        {showTypeSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute left-0 top-full z-50 mt-0.5 max-h-40 w-44 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {filteredSuggestions.slice(0, 12).map((type) => (
              <button
                key={type}
                className="flex w-full items-center px-2 py-1 text-left text-[11px] font-mono hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onUpdate({ type });
                  setShowTypeSuggestions(false);
                }}
              >
                {type}
              </button>
            ))}
          </div>
        )}
      </td>

      {/* Length */}
      <td className="px-1 py-1">
        <Input
          value={column.length}
          onChange={(e) => onUpdate({ length: e.target.value })}
          placeholder=""
          className="h-6 w-14 border-transparent bg-transparent px-1.5 text-xs font-mono text-center focus:border-border focus:bg-background"
        />
      </td>

      {/* Nullable */}
      <td className="px-1 py-1 text-center">
        <button
          onClick={() => onUpdate({ nullable: !column.nullable })}
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold transition-colors',
            column.nullable
              ? 'border-green-500/40 bg-green-500/10 text-green-500'
              : 'border-border bg-transparent text-muted-foreground/40',
          )}
          title={column.nullable ? 'Nullable (click to toggle)' : 'Not Null (click to toggle)'}
        >
          {column.nullable ? 'N' : ''}
        </button>
      </td>

      {/* Default */}
      <td className="px-1 py-1">
        <Input
          value={column.defaultValue}
          onChange={(e) => onUpdate({ defaultValue: e.target.value })}
          placeholder=""
          className="h-6 border-transparent bg-transparent px-1.5 text-xs font-mono focus:border-border focus:bg-background"
        />
      </td>

      {/* PK */}
      <td className="px-1 py-1 text-center">
        <button
          onClick={() => onUpdate({ isPrimaryKey: !column.isPrimaryKey })}
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded transition-colors',
            column.isPrimaryKey
              ? 'text-primary'
              : 'text-muted-foreground/20 hover:text-muted-foreground/50',
          )}
          title={column.isPrimaryKey ? 'Primary Key (click to remove)' : 'Set as Primary Key'}
        >
          <Key className="h-3 w-3" />
        </button>
      </td>

      {/* Unique */}
      <td className="px-1 py-1 text-center">
        <button
          onClick={() => onUpdate({ isUnique: !column.isUnique })}
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold transition-colors',
            column.isUnique
              ? 'border-blue-500/40 bg-blue-500/10 text-blue-500'
              : 'border-border bg-transparent text-muted-foreground/40',
          )}
          title={column.isUnique ? 'Unique (click to remove)' : 'Set as Unique'}
        >
          {column.isUnique ? 'U' : ''}
        </button>
      </td>

      {/* Auto Increment */}
      <td className="px-1 py-1 text-center">
        <button
          onClick={() => onUpdate({ autoIncrement: !column.autoIncrement })}
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded transition-colors',
            column.autoIncrement
              ? 'text-amber-500'
              : 'text-muted-foreground/20 hover:text-muted-foreground/50',
          )}
          title={column.autoIncrement ? 'Auto Increment (click to remove)' : 'Set Auto Increment'}
        >
          <Hash className="h-3 w-3" />
        </button>
      </td>

      {/* Comment */}
      <td className="px-1 py-1">
        <Input
          value={column.comment}
          onChange={(e) => onUpdate({ comment: e.target.value })}
          placeholder=""
          className="h-6 border-transparent bg-transparent px-1.5 text-xs focus:border-border focus:bg-background"
        />
      </td>

      {/* Actions */}
      <td className="px-1 py-1">
        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onMoveUp}
                disabled={isFirst}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Move up</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onMoveDown}
                disabled={isLast}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Move down</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onRemove}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Remove column</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}

// === DDL Syntax Highlighting (lightweight) ===

const SQL_KEYWORDS = new Set([
  'CREATE', 'TABLE', 'ALTER', 'ADD', 'DROP', 'COLUMN', 'MODIFY',
  'PRIMARY', 'KEY', 'NOT', 'NULL', 'DEFAULT', 'UNIQUE', 'AUTO_INCREMENT',
  'AUTOINCREMENT', 'COMMENT', 'CONSTRAINT', 'RENAME', 'TO', 'SET',
  'TYPE', 'GENERATED', 'ALWAYS', 'AS', 'IDENTITY', 'ON', 'IF', 'EXISTS',
]);

const SQL_TYPES = new Set([
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
  'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL', 'PRECISION',
  'BOOLEAN', 'BOOL', 'BIT',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIME', 'TIMETZ', 'YEAR', 'INTERVAL',
  'JSON', 'JSONB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BYTEA',
  'UUID', 'SERIAL', 'BIGSERIAL',
  'ENUM', 'BINARY', 'VARBINARY', 'MONEY', 'XML',
  'INET', 'CIDR', 'MACADDR', 'ARRAY', 'HSTORE',
]);

function DDLLine({ line }: { line: string }) {
  if (line.startsWith('--')) {
    return <span className="text-muted-foreground/60 italic">{line}</span>;
  }

  // Tokenize and highlight
  const tokens = line.split(/(\s+|[(),;]|'[^']*')/g).filter(Boolean);

  return (
    <>
      {tokens.map((token, i) => {
        const upper = token.toUpperCase();
        if (SQL_KEYWORDS.has(upper)) {
          return (
            <span key={i} className="text-blue-400 font-semibold">
              {token}
            </span>
          );
        }
        if (SQL_TYPES.has(upper)) {
          return (
            <span key={i} className="text-emerald-400">
              {token}
            </span>
          );
        }
        if (token.startsWith("'") && token.endsWith("'")) {
          return (
            <span key={i} className="text-amber-400">
              {token}
            </span>
          );
        }
        if (/^\d+$/.test(token)) {
          return (
            <span key={i} className="text-orange-400">
              {token}
            </span>
          );
        }
        return <span key={i}>{token}</span>;
      })}
    </>
  );
}
