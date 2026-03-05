import { useState, useEffect, useCallback } from 'react';
import {
  ArrowRightLeft,
  Loader2,
  AlertTriangle,
  Copy,
  Download,
  Database,
  GitCompareArrows,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useConnectionStore } from '@/stores/connectionStore';
import { useMigrationStore } from '@/stores/migrationStore';
import { SchemaDiff } from '@/components/migration/SchemaDiff';
import { ipc } from '@/lib/ipc';
import type { DatabaseInfo, SavedConnection } from '@/lib/types';

function ConnectionDatabaseSelector({
  label,
  connections,
  connectionId,
  database,
  databases,
  onConnectionChange,
  onDatabaseChange,
  loadingDatabases,
}: {
  label: string;
  connections: SavedConnection[];
  connectionId: string | null;
  database: string | null;
  databases: DatabaseInfo[];
  onConnectionChange: (id: string) => void;
  onDatabaseChange: (db: string) => void;
  loadingDatabases: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Select
          value={connectionId ?? ''}
          onValueChange={onConnectionChange}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select connection" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((conn) => (
              <SelectItem key={conn.config.id} value={conn.config.id}>
                <div className="flex items-center gap-2">
                  {conn.config.color && (
                    <div
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: conn.config.color }}
                    />
                  )}
                  <span>{conn.config.name || conn.config.host}</span>
                  <span className="text-muted-foreground text-[10px]">
                    {conn.config.db_type}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={database ?? ''}
          onValueChange={onDatabaseChange}
          disabled={!connectionId || loadingDatabases}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue
              placeholder={
                loadingDatabases ? 'Loading...' : 'Select database'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {databases.map((db) => (
              <SelectItem key={db.name} value={db.name}>
                {db.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function SchemaMigrationView() {
  const { savedConnections } = useConnectionStore();
  const {
    sourceConnectionId,
    targetConnectionId,
    sourceDatabase,
    targetDatabase,
    diff,
    migrationSQL,
    loading,
    error,
    setSource,
    setTarget,
    computeDiff,
    reset,
  } = useMigrationStore();

  const [sourceDatabases, setSourceDatabases] = useState<DatabaseInfo[]>([]);
  const [targetDatabases, setTargetDatabases] = useState<DatabaseInfo[]>([]);
  const [loadingSourceDbs, setLoadingSourceDbs] = useState(false);
  const [loadingTargetDbs, setLoadingTargetDbs] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load saved connections on mount
  useEffect(() => {
    useConnectionStore.getState().loadSavedConnections();
  }, []);

  // Load databases when source connection changes
  const loadSourceDatabases = useCallback(
    async (connId: string) => {
      setLoadingSourceDbs(true);
      try {
        const dbs = await ipc.listDatabases(connId);
        setSourceDatabases(dbs);
      } catch {
        setSourceDatabases([]);
      } finally {
        setLoadingSourceDbs(false);
      }
    },
    [],
  );

  // Load databases when target connection changes
  const loadTargetDatabases = useCallback(
    async (connId: string) => {
      setLoadingTargetDbs(true);
      try {
        const dbs = await ipc.listDatabases(connId);
        setTargetDatabases(dbs);
      } catch {
        setTargetDatabases([]);
      } finally {
        setLoadingTargetDbs(false);
      }
    },
    [],
  );

  const handleSourceConnectionChange = (connId: string) => {
    setSource(connId, null);
    setSourceDatabases([]);
    loadSourceDatabases(connId);
  };

  const handleTargetConnectionChange = (connId: string) => {
    setTarget(connId, null);
    setTargetDatabases([]);
    loadTargetDatabases(connId);
  };

  const handleSourceDatabaseChange = (db: string) => {
    setSource(sourceConnectionId, db);
  };

  const handleTargetDatabaseChange = (db: string) => {
    setTarget(targetConnectionId, db);
  };

  const sqlText = migrationSQL.join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sqlText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback — ignore clipboard errors
    }
  };

  const handleExport = () => {
    const blob = new Blob([sqlText], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration_${new Date().toISOString().slice(0, 10)}.sql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const canCompare =
    sourceConnectionId &&
    targetConnectionId &&
    sourceDatabase &&
    targetDatabase;

  if (savedConnections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Database className="size-10 opacity-50" />
        <p className="text-sm">
          Save at least two connections to use schema migration
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <GitCompareArrows className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Schema Migration</h2>
        <div className="flex-1" />
        {diff.length > 0 && (
          <Button size="xs" variant="outline" onClick={reset}>
            Reset
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-4 flex flex-col gap-4">
          {/* Connection Selectors */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Compare Schemas</CardTitle>
              <CardDescription>
                Select source and target connections to compare their database
                schemas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-4">
                <ConnectionDatabaseSelector
                  label="Source (desired state)"
                  connections={savedConnections}
                  connectionId={sourceConnectionId}
                  database={sourceDatabase}
                  databases={sourceDatabases}
                  onConnectionChange={handleSourceConnectionChange}
                  onDatabaseChange={handleSourceDatabaseChange}
                  loadingDatabases={loadingSourceDbs}
                />

                <ArrowRightLeft className="size-5 text-muted-foreground shrink-0 mb-2" />

                <ConnectionDatabaseSelector
                  label="Target (current state)"
                  connections={savedConnections}
                  connectionId={targetConnectionId}
                  database={targetDatabase}
                  databases={targetDatabases}
                  onConnectionChange={handleTargetConnectionChange}
                  onDatabaseChange={handleTargetDatabaseChange}
                  loadingDatabases={loadingTargetDbs}
                />

                <Button
                  onClick={computeDiff}
                  disabled={!canCompare || loading}
                  className="shrink-0 mb-0"
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="size-4" />
                  )}
                  Compare
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm p-3 rounded-md border border-destructive/30 bg-destructive/5">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="size-5 animate-spin mr-2" />
              Comparing schemas...
            </div>
          )}

          {/* Diff Results */}
          {!loading && diff.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">Schema Differences</CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {diff.length} table{diff.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <CardDescription>
                  Changes needed to migrate target to match source schema.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SchemaDiff diff={diff} />
              </CardContent>
            </Card>
          )}

          {/* No diff message after comparison */}
          {!loading &&
            !error &&
            diff.length === 0 &&
            sourceConnectionId &&
            targetConnectionId &&
            sourceDatabase &&
            targetDatabase &&
            migrationSQL.length === 0 && (
              <Card>
                <CardContent className="py-8">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Database className="size-8 opacity-50" />
                    <p className="text-sm">Click "Compare" to analyze schema differences</p>
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Generated SQL */}
          {!loading && migrationSQL.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">Migration SQL</CardTitle>
                  <div className="flex-1" />
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={handleCopy}
                  >
                    <Copy className="size-3" />
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={handleExport}
                  >
                    <Download className="size-3" />
                    Export .sql
                  </Button>
                </div>
                <CardDescription>
                  Review and execute this SQL to migrate the target schema.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[400px] overflow-y-auto rounded-md border bg-muted/30 p-4">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                    {sqlText}
                  </pre>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
