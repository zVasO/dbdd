import { useState, useRef, useEffect } from 'react';
import { useQueryStore } from '@/stores/queryStore';
import { useResultStore } from '@/stores/resultStore';
import { useUIStore } from '@/stores/uiStore';
import { useChangeStore } from '@/stores/changeStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useConnectionStore, type ActiveConnection } from '@/stores/connectionStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useThemeStore } from '@/stores/themeStore';
import { ConnectionStatus } from '@/components/connection/ConnectionStatus';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Moon, Sun, Palette, ChevronDown, Unplug, ArrowRightLeft, Database, Plus, Check, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  connected: boolean;
  dbType?: string;
  onDisconnect: () => void;
  onOpenConnectionDialog?: () => void;
}

export function StatusBar({ connected, dbType, onDisconnect, onOpenConnectionDialog }: Props) {
  const activeTabId = useQueryStore((s) => s.activeTabId);
  const tabs = useQueryStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const tabResult = useResultStore((s) => activeTab ? s.results[activeTab.id] : undefined);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const theme = usePreferencesStore((s) => s.theme);
  const pendingCount = useChangeStore((s) => s.pendingCount());
  const hasPending = pendingCount > 0;

  const activeConnections = useConnectionStore((s) => s.activeConnections);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeConfig = useConnectionStore((s) => s.activeConfig);
  const switchConnection = useConnectionStore((s) => s.switchConnection);
  const disconnectById = useConnectionStore((s) => s.disconnectById);

  const activeDatabase = useSchemaStore((s) => s.activeDatabase);

  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const themeDropdownRef = useRef<HTMLDivElement>(null);

  // Close switcher on outside click
  useEffect(() => {
    if (!switcherOpen) return;
    const handler = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [switcherOpen]);

  // Close theme dropdown on outside click
  useEffect(() => {
    if (!themeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node)) {
        setThemeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [themeDropdownOpen]);

  return (
    <div
      className="flex items-center justify-between border-t border-border bg-muted px-3 text-[11px] text-muted-foreground"
      style={{ height: 'var(--statusbar-height)' }}
    >
      <div className="flex items-center gap-2">
        {/* Connection switcher */}
        {activeConnections.length > 1 ? (
          <div className="relative" ref={switcherRef}>
            <button
              onClick={() => setSwitcherOpen(!switcherOpen)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-accent transition-colors"
              style={activeConfig?.color ? { borderLeft: `3px solid ${activeConfig.color}`, paddingLeft: '6px' } : undefined}
            >
              <ConnectionStatus connected={connected} dbType={dbType} />
              <span className="font-medium text-foreground/80">
                {activeConfig?.name || activeConfig?.host}
              </span>
              <ChevronDown className="h-3 w-3" />
            </button>

            {switcherOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-64 rounded-md border border-border bg-popover p-1 shadow-lg z-50">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Active Connections ({activeConnections.length})
                </div>
                {activeConnections.map((conn) => (
                  <ConnectionSwitchItem
                    key={conn.connectionId}
                    conn={conn}
                    isActive={conn.connectionId === activeConnectionId}
                    onSwitch={() => {
                      switchConnection(conn.connectionId);
                      setSwitcherOpen(false);
                    }}
                    onDisconnect={() => {
                      disconnectById(conn.connectionId);
                      setSwitcherOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <ConnectionStatus connected={connected} dbType={dbType} />
            {connected && activeConfig && (
              <span
                className="font-medium text-foreground/70"
                style={activeConfig.color ? { color: activeConfig.color } : undefined}
              >
                {activeConfig.name || activeConfig.host}
              </span>
            )}
          </>
        )}

        {connected && activeDatabase && (
          <>
            <Separator orientation="vertical" className="h-3" />
            <span className="flex items-center gap-1 text-foreground/60">
              <Database className="h-3 w-3" />
              {activeDatabase}
            </span>
          </>
        )}

        {connected && (
          <>
            <Separator orientation="vertical" className="h-3" />
            <Button
              variant="ghost"
              size="xs"
              onClick={onDisconnect}
              className="text-muted-foreground hover:text-foreground"
            >
              Disconnect
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onOpenConnectionDialog}
              className="text-muted-foreground hover:text-foreground"
              title="Add connection"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
      {hasPending && (
        <div className="flex items-center gap-1.5 text-xs">
          <div className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
          <span className="text-muted-foreground">
            {pendingCount} unsaved change{pendingCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}
      <div className="flex items-center gap-4">
        {tabResult && tabResult.rowCount > 0 && (
          <>
            <span>{tabResult.totalRows} rows</span>
            <span>{tabResult.executionTimeMs ?? 0}ms</span>
          </>
        )}
        {activeTab?.isExecuting && <span>Executing...</span>}
        <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-muted-foreground">Ctrl+K</kbd>
        {/* Theme selector dropdown */}
        <div className="relative" ref={themeDropdownRef}>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setThemeDropdownOpen(!themeDropdownOpen)}
            className="text-muted-foreground hover:text-foreground"
            title="Select theme"
          >
            <Palette className="h-3.5 w-3.5" />
          </Button>

          {themeDropdownOpen && (
            <div className="absolute bottom-full right-0 mb-1 w-52 rounded-md border border-border bg-popover p-1 shadow-lg z-50">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Themes
              </div>
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTheme(t.id);
                    setThemeDropdownOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors',
                    t.id === activeThemeId ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                  )}
                >
                  <span className="flex-1 text-left truncate">{t.name}</span>
                  {t.id === activeThemeId && <Check className="h-3 w-3 shrink-0" />}
                </button>
              ))}

              <div className="my-1 border-t border-border" />

              <button
                onClick={() => {
                  useUIStore.getState().setSettingsOpen(true);
                  setThemeDropdownOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors text-muted-foreground"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Customize...</span>
              </button>
            </div>
          )}
        </div>

        {/* Light/Dark toggle */}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={toggleTheme}
          className="text-muted-foreground hover:text-foreground"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function ConnectionSwitchItem({
  conn,
  isActive,
  onSwitch,
  onDisconnect,
}: {
  conn: ActiveConnection;
  isActive: boolean;
  onSwitch: () => void;
  onDisconnect: () => void;
}) {
  const dbLabel = conn.config.db_type === 'mysql' ? 'MySQL'
    : conn.config.db_type === 'postgres' ? 'PostgreSQL'
    : conn.config.db_type === 'sqlite' ? 'SQLite'
    : conn.config.db_type;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors group',
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted cursor-pointer',
      )}
    >
      <button
        onClick={onSwitch}
        className="flex flex-1 items-center gap-2 text-left min-w-0"
      >
        {conn.config.color && (
          <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: conn.config.color }} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {conn.config.name || `${conn.config.host}:${conn.config.port}`}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {dbLabel} {conn.config.database ? `\u2014 ${conn.config.database}` : ''}
          </div>
        </div>
        {isActive && (
          <ArrowRightLeft className="h-3 w-3 text-primary shrink-0" />
        )}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDisconnect();
        }}
        className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
        title="Disconnect"
      >
        <Unplug className="h-3 w-3" />
      </button>
    </div>
  );
}
