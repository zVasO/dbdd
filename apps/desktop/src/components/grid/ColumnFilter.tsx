import { useFilterStore } from '@/stores/filterStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ColumnMeta } from '@/lib/types';

interface ColumnFilterProps {
  columns: ColumnMeta[];
}

export function ColumnFilter({ columns }: ColumnFilterProps) {
  const columnFilterOpen = useFilterStore((s) => s.columnFilterOpen);
  const setColumnFilterOpen = useFilterStore((s) => s.setColumnFilterOpen);
  const columnVisibility = useFilterStore((s) => s.columnVisibility);
  const setColumnVisibility = useFilterStore((s) => s.setColumnVisibility);
  const resetColumnVisibility = useFilterStore((s) => s.resetColumnVisibility);

  const isVisible = (col: string) => columnVisibility[col] !== false;

  const toggleAll = (visible: boolean) => {
    columns.forEach((col) => setColumnVisibility(col.name, visible));
  };

  return (
    <Dialog open={columnFilterOpen} onOpenChange={setColumnFilterOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Column Visibility</DialogTitle>
          <DialogDescription>
            Select which columns to display in the grid.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 mb-2">
          <Button variant="outline" size="xs" onClick={() => toggleAll(true)} className="text-xs">
            Show All
          </Button>
          <Button variant="outline" size="xs" onClick={() => toggleAll(false)} className="text-xs">
            Hide All
          </Button>
          <Button variant="outline" size="xs" onClick={resetColumnVisibility} className="text-xs">
            Reset
          </Button>
        </div>
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-1">
            {columns.map((col) => (
              <label
                key={col.name}
                className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isVisible(col.name)}
                  onChange={(e) => setColumnVisibility(col.name, e.target.checked)}
                  className="h-3 w-3 rounded border-border"
                />
                <span className="flex-1 truncate">{col.name}</span>
                <span className="text-[10px] text-muted-foreground">{typeof col.data_type === 'string' ? col.data_type : Object.keys(col.data_type)[0]}</span>
              </label>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setColumnFilterOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
