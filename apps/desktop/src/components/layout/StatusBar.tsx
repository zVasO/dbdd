import { useQueryStore } from '@/stores/queryStore';
import { useUIStore } from '@/stores/uiStore';
import { useChangeStore } from '@/stores/changeStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { ConnectionStatus } from '@/components/connection/ConnectionStatus';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Moon, Sun } from 'lucide-react';

interface Props {
  connected: boolean;
  dbType?: string;
  onDisconnect: () => void;
}

export function StatusBar({ connected, dbType, onDisconnect }: Props) {
  const activeTabId = useQueryStore((s) => s.activeTabId);
  const tabs = useQueryStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const theme = usePreferencesStore((s) => s.theme);
  const pendingCount = useChangeStore((s) => s.pendingCount());
  const hasPending = pendingCount > 0;

  return (
    <div
      className="flex items-center justify-between border-t border-border bg-muted px-3 text-[11px] text-muted-foreground"
      style={{ height: 'var(--statusbar-height)' }}
    >
      <div className="flex items-center gap-2">
        <ConnectionStatus connected={connected} dbType={dbType} />
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
        {activeTab?.result && (
          <>
            <span>{activeTab.result.rows.length} rows</span>
            <span>{activeTab.result.execution_time_ms}ms</span>
          </>
        )}
        {activeTab?.isExecuting && <span>Executing...</span>}
        <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-muted-foreground">Ctrl+K</kbd>
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
