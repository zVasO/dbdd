import { useMemo } from 'react';
import { Command } from 'cmdk';
import { useUIStore } from '@/stores/uiStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useQueryStore } from '@/stores/queryStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { Database, Table2, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface SearchItem {
  type: 'database' | 'table' | 'view';
  name: string;
  database: string;
  rowCount: number | null;
}

export function OpenAnything() {
  const open = useUIStore((s) => s.openAnythingOpen);
  const setOpen = useUIStore((s) => s.setOpenAnythingOpen);
  const databases = useSchemaStore((s) => s.databases);
  const tables = useSchemaStore((s) => s.tables);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  const items = useMemo(() => {
    const result: SearchItem[] = [];

    for (const db of databases) {
      result.push({ type: 'database', name: db.name, database: db.name, rowCount: null });
      const dbTables = tables[db.name];
      if (dbTables) {
        for (const t of dbTables) {
          result.push({
            type: t.table_type === 'View' ? 'view' : 'table',
            name: t.name,
            database: db.name,
            rowCount: t.row_count_estimate,
          });
        }
      }
    }

    return result;
  }, [databases, tables]);

  function handleSelect(item: SearchItem) {
    setOpen(false);
    if (!activeConnectionId) return;

    if (item.type === 'table' || item.type === 'view') {
      const { createTab, updateSql, executeQuery } = useQueryStore.getState();
      const pageSize = usePreferencesStore.getState().defaultPageSize;
      const sql = pageSize > 0
        ? `SELECT * FROM \`${item.name}\` LIMIT ${pageSize}`
        : `SELECT * FROM \`${item.name}\``;
      const tabId = createTab(item.name, {
        editorVisible: false,
        database: item.database,
        table: item.name,
      });
      updateSql(tabId, sql);
      executeQuery(activeConnectionId, tabId);
    }
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Open Anything"
      className="fixed inset-0 z-50"
    >
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />

      <div className="fixed inset-0 flex items-start justify-center pt-[20vh]">
        <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
          <Command.Input
            placeholder="Search tables, views, databases... (Ctrl+P)"
            className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {items.filter((i) => i.type === 'table').length > 0 && (
              <Command.Group
                heading="Tables"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {items
                  .filter((i) => i.type === 'table')
                  .map((item) => (
                    <SearchResultItem key={`table-${item.database}-${item.name}`} item={item} onSelect={handleSelect} />
                  ))}
              </Command.Group>
            )}

            {items.filter((i) => i.type === 'view').length > 0 && (
              <Command.Group
                heading="Views"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {items
                  .filter((i) => i.type === 'view')
                  .map((item) => (
                    <SearchResultItem key={`view-${item.database}-${item.name}`} item={item} onSelect={handleSelect} />
                  ))}
              </Command.Group>
            )}

            {items.filter((i) => i.type === 'database').length > 0 && (
              <Command.Group
                heading="Databases"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {items
                  .filter((i) => i.type === 'database')
                  .map((item) => (
                    <SearchResultItem key={`db-${item.name}`} item={item} onSelect={handleSelect} />
                  ))}
              </Command.Group>
            )}
          </Command.List>
        </div>
      </div>
    </Command.Dialog>
  );
}

function SearchResultItem({ item, onSelect }: { item: SearchItem; onSelect: (item: SearchItem) => void }) {
  const Icon = item.type === 'database' ? Database : item.type === 'view' ? Eye : Table2;

  return (
    <Command.Item
      value={`${item.database} ${item.name}`}
      onSelect={() => onSelect(item)}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-popover-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 truncate">{item.name}</span>
      {item.type !== 'database' && (
        <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[9px] font-normal">
          {item.database}
        </Badge>
      )}
      {item.rowCount != null && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          ~{item.rowCount.toLocaleString()}
        </span>
      )}
    </Command.Item>
  );
}
