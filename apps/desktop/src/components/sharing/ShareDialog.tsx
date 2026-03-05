import { useState, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Download,
  Upload,
  FileJson,
  CheckSquare,
  Square,
  LayoutDashboard,
  Code2,
  FileUp,
} from 'lucide-react';
import { useQueryStore } from '@/stores/queryStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useSnippetStore } from '@/stores/snippetStore';
import {
  exportQueries,
  exportDashboard,
  exportSnippets,
  parseSharedFile,
  downloadJSON,
  type SharedFile,
} from '@/lib/sharing';
import { cn } from '@/lib/utils';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({ open, onOpenChange }: ShareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Share & Import</DialogTitle>
          <DialogDescription>
            Export queries, dashboards, and snippets or import shared files.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="queries" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="queries" className="flex-1">
              <Code2 className="mr-1.5 h-3.5 w-3.5" />
              Queries
            </TabsTrigger>
            <TabsTrigger value="dashboard" className="flex-1">
              <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="snippets" className="flex-1">
              <FileJson className="mr-1.5 h-3.5 w-3.5" />
              Snippets
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1">
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="queries">
            <ExportQueriesTab />
          </TabsContent>
          <TabsContent value="dashboard">
            <ExportDashboardTab />
          </TabsContent>
          <TabsContent value="snippets">
            <ExportSnippetsTab />
          </TabsContent>
          <TabsContent value="import">
            <ImportTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ExportQueriesTab() {
  const tabs = useQueryStore((s) => s.tabs);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('My Queries');

  const toggleAll = useCallback(() => {
    if (selected.size === tabs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tabs.map((t) => t.id)));
    }
  }, [tabs, selected]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleExport = useCallback(() => {
    const queries = tabs
      .filter((t) => selected.has(t.id))
      .map((t) => ({ title: t.title, sql: t.sql }));
    if (queries.length === 0) return;
    const json = exportQueries(queries, name);
    const filename = `${name.toLowerCase().replace(/\s+/g, '-')}-queries.json`;
    downloadJSON(json, filename);
  }, [tabs, selected, name]);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="export-name" className="text-xs">Collection Name</Label>
        <Input
          id="export-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Collection name"
          className="h-8 text-sm"
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {selected.size} of {tabs.length} selected
        </span>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={toggleAll}>
          {selected.size === tabs.length ? 'Deselect All' : 'Select All'}
        </Button>
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto max-h-[200px]">
        {tabs.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">
            No open query tabs to export.
          </p>
        ) : (
          tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                selected.has(tab.id) && 'bg-accent/50',
              )}
              onClick={() => toggleOne(tab.id)}
            >
              {selected.has(tab.id) ? (
                <CheckSquare className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <Square className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{tab.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {tab.sql.substring(0, 60) || '(empty)'}
                </p>
              </div>
            </button>
          ))
        )}
      </div>

      <Button
        onClick={handleExport}
        disabled={selected.size === 0 || !name.trim()}
        className="w-full"
      >
        <Download className="mr-2 h-4 w-4" />
        Export {selected.size} {selected.size === 1 ? 'Query' : 'Queries'}
      </Button>
    </div>
  );
}

function ExportDashboardTab() {
  const dashboards = useDashboardStore((s) => s.dashboards);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    dashboards.length > 0 ? dashboards[0].id : undefined,
  );

  const handleExport = useCallback(() => {
    if (!selectedId) return;
    const dashboard = dashboards.find((d) => d.id === selectedId);
    if (!dashboard) return;
    const json = exportDashboard(dashboard);
    const filename = `${dashboard.name.toLowerCase().replace(/\s+/g, '-')}-dashboard.json`;
    downloadJSON(json, filename);
  }, [dashboards, selectedId]);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Select Dashboard</Label>
        {dashboards.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">
            No dashboards available to export.
          </p>
        ) : (
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-full h-8 text-sm">
              <SelectValue placeholder="Choose a dashboard" />
            </SelectTrigger>
            <SelectContent>
              {dashboards.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  <span className="flex items-center gap-2">
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    {d.name}
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">
                      {d.widgets.length} widgets
                    </Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {selectedId && (
        <>
          <Separator />
          {(() => {
            const dashboard = dashboards.find((d) => d.id === selectedId);
            if (!dashboard) return null;
            return (
              <div className="rounded-md border border-border p-3">
                <p className="text-sm font-medium">{dashboard.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {dashboard.widgets.length} widget{dashboard.widgets.length !== 1 ? 's' : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {dashboard.widgets.map((w) => (
                    <Badge key={w.id} variant="outline" className="text-[10px] h-5">
                      {w.title}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      )}

      <Button onClick={handleExport} disabled={!selectedId} className="w-full">
        <Download className="mr-2 h-4 w-4" />
        Export Dashboard
      </Button>
    </div>
  );
}

function ExportSnippetsTab() {
  const snippets = useSnippetStore((s) => s.snippets);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('My Snippets');

  const toggleAll = useCallback(() => {
    if (selected.size === snippets.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(snippets.map((s) => s.id)));
    }
  }, [snippets, selected]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleExport = useCallback(() => {
    const selectedSnippets = snippets.filter((s) => selected.has(s.id));
    if (selectedSnippets.length === 0) return;
    const json = exportSnippets(selectedSnippets, name);
    const filename = `${name.toLowerCase().replace(/\s+/g, '-')}-snippets.json`;
    downloadJSON(json, filename);
  }, [snippets, selected, name]);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="snippet-export-name" className="text-xs">Collection Name</Label>
        <Input
          id="snippet-export-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Collection name"
          className="h-8 text-sm"
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {selected.size} of {snippets.length} selected
        </span>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={toggleAll}>
          {selected.size === snippets.length ? 'Deselect All' : 'Select All'}
        </Button>
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto max-h-[200px]">
        {snippets.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">
            No snippets available to export.
          </p>
        ) : (
          snippets.map((snippet) => (
            <button
              key={snippet.id}
              type="button"
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                selected.has(snippet.id) && 'bg-accent/50',
              )}
              onClick={() => toggleOne(snippet.id)}
            >
              {selected.has(snippet.id) ? (
                <CheckSquare className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <Square className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{snippet.name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  {snippet.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[9px] h-4 px-1">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <Button
        onClick={handleExport}
        disabled={selected.size === 0 || !name.trim()}
        className="w-full"
      >
        <Download className="mr-2 h-4 w-4" />
        Export {selected.size} Snippet{selected.size !== 1 ? 's' : ''}
      </Button>
    </div>
  );
}

function ImportTab() {
  const [parsedFile, setParsedFile] = useState<SharedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [imported, setImported] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createTab = useQueryStore((s) => s.createTab);
  const updateSql = useQueryStore((s) => s.updateSql);
  const createDashboard = useDashboardStore((s) => s.createDashboard);
  const addWidget = useDashboardStore((s) => s.addWidget);
  const updateLayout = useDashboardStore((s) => s.updateLayout);
  const createSnippet = useSnippetStore((s) => s.createSnippet);

  const handleFile = useCallback((file: File) => {
    setError(null);
    setParsedFile(null);
    setImported(false);

    if (!file.name.endsWith('.json')) {
      setError('Please select a .json file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = parseSharedFile(content);
        setParsedFile(parsed);
      } catch (err) {
        setError(String(err));
      }
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleImport = useCallback(() => {
    if (!parsedFile) return;

    switch (parsedFile.type) {
      case 'query-collection': {
        for (const query of parsedFile.queries) {
          const tabId = createTab(query.title);
          updateSql(tabId, query.sql);
        }
        break;
      }
      case 'dashboard': {
        const { dashboard } = parsedFile;
        const dashboardId = createDashboard(dashboard.name);
        const idMap = new Map<string, string>();

        for (const widget of dashboard.widgets) {
          const widgetId = addWidget(dashboardId, {
            type: widget.type as 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'kpi' | 'table' | 'text',
            title: widget.title,
            sql: widget.sql,
            config: widget.config,
          });
          // Map old widget layout id to new id
          const oldId = dashboard.layout.find((l) =>
            !idMap.has(l.i),
          )?.i;
          if (oldId) {
            idMap.set(oldId, widgetId);
          }
        }

        // Re-map layout items with new widget IDs
        const mappedLayout = dashboard.layout.map((l) => ({
          ...l,
          i: idMap.get(l.i) ?? l.i,
        }));
        updateLayout(dashboardId, mappedLayout);
        break;
      }
      case 'snippet-collection': {
        for (const snippet of parsedFile.snippets) {
          createSnippet({
            name: snippet.name,
            sql: snippet.sql,
            description: snippet.description,
            tags: snippet.tags,
          });
        }
        break;
      }
    }

    setImported(true);
  }, [parsedFile, createTab, updateSql, createDashboard, addWidget, updateLayout, createSnippet]);

  const getItemCount = (file: SharedFile): number => {
    switch (file.type) {
      case 'query-collection':
        return file.queries.length;
      case 'dashboard':
        return file.dashboard.widgets.length;
      case 'snippet-collection':
        return file.snippets.length;
    }
  };

  const getTypeLabel = (file: SharedFile): string => {
    switch (file.type) {
      case 'query-collection':
        return 'Query Collection';
      case 'dashboard':
        return 'Dashboard';
      case 'snippet-collection':
        return 'Snippet Collection';
    }
  };

  return (
    <div className="flex flex-col gap-3 pt-3">
      {/* Drop zone */}
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer',
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/30',
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <FileUp className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drop a .json file here or click to browse
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Preview */}
      {parsedFile && (
        <>
          <Separator />
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{parsedFile.name}</p>
              <Badge variant="secondary" className="text-[10px]">
                {getTypeLabel(parsedFile)}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {getItemCount(parsedFile)} item{getItemCount(parsedFile) !== 1 ? 's' : ''} &middot;
              Exported {new Date(parsedFile.exportedAt).toLocaleDateString()}
            </p>

            {/* Item list preview */}
            <div className="mt-2 flex flex-wrap gap-1">
              {parsedFile.type === 'query-collection' &&
                parsedFile.queries.slice(0, 5).map((q, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] h-5">
                    {q.title}
                  </Badge>
                ))}
              {parsedFile.type === 'dashboard' &&
                parsedFile.dashboard.widgets.slice(0, 5).map((w, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] h-5">
                    {w.title}
                  </Badge>
                ))}
              {parsedFile.type === 'snippet-collection' &&
                parsedFile.snippets.slice(0, 5).map((s, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] h-5">
                    {s.name}
                  </Badge>
                ))}
              {getItemCount(parsedFile) > 5 && (
                <Badge variant="secondary" className="text-[10px] h-5">
                  +{getItemCount(parsedFile) - 5} more
                </Badge>
              )}
            </div>
          </div>

          {imported ? (
            <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3">
              <p className="text-sm text-green-700 dark:text-green-400">
                Successfully imported {getItemCount(parsedFile)} items!
              </p>
            </div>
          ) : (
            <Button onClick={handleImport} className="w-full">
              <Upload className="mr-2 h-4 w-4" />
              Import {getItemCount(parsedFile)} {parsedFile.type === 'dashboard' ? 'Dashboard' : 'Items'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
