import { useState, useRef, useEffect, useCallback } from 'react';
import {
  type FontEntry,
  searchFonts,
  getPrimaryFontName,
  loadGoogleFont,
  saveImportedFont,
  makeFontEntry,
  preloadCuratedGoogleFonts,
} from '@/lib/fonts';
import { Label } from '@/components/ui/label';
import { ChevronDown, Cloud, Monitor, Package, Check, Loader2, Plus } from 'lucide-react';

interface Props {
  label: string;
  value: string;
  category: 'sans' | 'mono' | 'serif';
  readOnly?: boolean;
  onChange: (stack: string) => void;
}

export function FontSelect({ label, value, category, readOnly, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [loadingFont, setLoadingFont] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const primaryName = getPrimaryFontName(value);
  const results = searchFonts(search, category);

  // Check if the search term doesn't match any existing font exactly
  const searchTrimmed = search.trim();
  const hasExactMatch = searchTrimmed
    ? results.some((f) => f.name.toLowerCase() === searchTrimmed.toLowerCase())
    : true;

  // Preload curated Google Fonts when dropdown opens
  useEffect(() => {
    if (open) preloadCuratedGoogleFonts();
  }, [open]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
    setLoadingFont(null);
  }, []);

  const handleSelect = async (font: FontEntry) => {
    if (font.source === 'google') {
      setLoadingFont(font.name);
      const ok = await loadGoogleFont(font.name);
      setLoadingFont(null);
      if (ok) {
        saveImportedFont(font);
      }
    }
    onChange(font.stack);
    close();
  };

  const handleCustomImport = async () => {
    if (!searchTrimmed) return;
    const entry = makeFontEntry(searchTrimmed, category);
    setLoadingFont(searchTrimmed);
    const ok = await loadGoogleFont(searchTrimmed);
    setLoadingFont(null);
    if (ok) {
      saveImportedFont(entry);
      onChange(entry.stack);
      close();
    }
  };

  const sourceIcon = (source: FontEntry['source']) => {
    switch (source) {
      case 'bundled': return <Package className="size-2.5 text-primary" />;
      case 'system': return <Monitor className="size-2.5 text-muted-foreground" />;
      case 'google': return <Cloud className="size-2.5 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <div className="relative" ref={containerRef}>
        {/* Trigger */}
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setOpen(!open)}
          className="flex items-center w-full h-7 px-2 rounded-md border border-input bg-background text-xs hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="flex-1 text-left truncate" style={{ fontFamily: value }}>
            {primaryName}
          </span>
          <ChevronDown className={`size-3 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute z-50 top-full left-0 mt-1 w-64 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
            {/* Search */}
            <div className="p-2 border-b border-border">
              <input
                ref={searchRef}
                type="text"
                placeholder="Search or type a Google Font name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !hasExactMatch && searchTrimmed) {
                    handleCustomImport();
                  }
                  if (e.key === 'Escape') close();
                }}
                className="w-full h-7 px-2.5 rounded-md bg-muted/50 text-xs outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Font list */}
            <div className="max-h-56 overflow-y-auto p-1">
              {results.map((font) => {
                const isActive = primaryName === font.name;
                const isLoading = loadingFont === font.name;
                return (
                  <button
                    key={font.name}
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleSelect(font)}
                    className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-accent text-foreground'
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 className="size-2.5 animate-spin text-muted-foreground" />
                    ) : (
                      sourceIcon(font.source)
                    )}
                    <span className="flex-1 text-left truncate" style={{ fontFamily: font.stack }}>
                      {font.name}
                    </span>
                    <span
                      className="text-muted-foreground/50 text-sm leading-none"
                      style={{ fontFamily: font.stack }}
                    >
                      Aa
                    </span>
                    {isActive && <Check className="size-3 text-primary shrink-0" />}
                  </button>
                );
              })}

              {/* No results + custom import suggestion */}
              {results.length === 0 && searchTrimmed && (
                <div className="px-3 py-3 text-center">
                  <p className="text-[10px] text-muted-foreground mb-2">No fonts match "{searchTrimmed}"</p>
                  <button
                    type="button"
                    onClick={handleCustomImport}
                    disabled={!!loadingFont}
                    className="flex items-center gap-1.5 w-full justify-center px-2.5 py-1.5 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    {loadingFont ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Cloud className="size-3" />
                    )}
                    Try loading "{searchTrimmed}" from Google Fonts
                  </button>
                </div>
              )}
            </div>

            {/* Custom import hint when search has results but no exact match */}
            {searchTrimmed && !hasExactMatch && results.length > 0 && (
              <div className="border-t border-border p-1.5">
                <button
                  type="button"
                  onClick={handleCustomImport}
                  disabled={!!loadingFont}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {loadingFont === searchTrimmed ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Plus className="size-3" />
                  )}
                  Load "{searchTrimmed}" from Google Fonts
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
