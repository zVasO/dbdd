import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { providers, getProvidersByCategory } from '@/lib/dataGenProviders';
import { ChevronDown, Search } from 'lucide-react';

interface ProviderSelectProps {
  value: string;
  onValueChange: (providerId: string) => void;
  className?: string;
}

export function ProviderSelect({ value, onValueChange, className }: ProviderSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => getProvidersByCategory(), []);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === value),
    [value]
  );

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return grouped;
    const term = search.toLowerCase();
    const result: Record<string, typeof providers> = {};
    for (const [cat, list] of Object.entries(grouped)) {
      const filtered = list.filter(
        (p) =>
          p.label.toLowerCase().includes(term) ||
          p.id.toLowerCase().includes(term) ||
          cat.toLowerCase().includes(term)
      );
      if (filtered.length > 0) {
        result[cat] = filtered;
      }
    }
    return result;
  }, [grouped, search]);

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-xs transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none',
          'h-7'
        )}
      >
        <span className="truncate">
          {selectedProvider ? selectedProvider.label : 'Select provider...'}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-50" />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false);
              setSearch('');
            }}
          />

          {/* Dropdown */}
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border bg-popover text-popover-foreground shadow-md">
            {/* Search */}
            <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
              <Search className="size-3 text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search providers..."
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                autoFocus
              />
            </div>

            {/* List */}
            <div className="max-h-[250px] overflow-y-auto p-1">
              {Object.keys(filteredGroups).length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No providers found
                </div>
              )}

              {Object.entries(filteredGroups).map(([category, list]) => (
                <div key={category}>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {category}
                  </div>
                  {list.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => {
                        onValueChange(provider.id);
                        setOpen(false);
                        setSearch('');
                      }}
                      className={cn(
                        'flex w-full items-center rounded-sm px-2 py-1 text-xs outline-none transition-colors',
                        provider.id === value
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent hover:text-accent-foreground'
                      )}
                    >
                      {provider.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
