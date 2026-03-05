import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Columns2 } from 'lucide-react';

const appWindow = getCurrentWindow();

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const unlisten = appWindow.onResized(async () => {
      setMaximized(await appWindow.isMaximized());
    });
    // Check initial state
    appWindow.isMaximized().then(setMaximized);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 select-none items-center justify-between bg-sidebar border-b border-sidebar-border"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3">
        <span data-tauri-drag-region className="text-xs font-semibold text-sidebar-foreground/80">
          DataForge
        </span>
      </div>

      <div className="flex h-full">
        <button
          onClick={() => appWindow.minimize()}
          className="inline-flex h-full w-11 items-center justify-center text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          aria-label="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="inline-flex h-full w-11 items-center justify-center text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          aria-label="Maximize"
        >
          {maximized ? <Columns2 className="h-3 w-3 rotate-90" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          onClick={() => appWindow.close()}
          className="inline-flex h-full w-11 items-center justify-center text-sidebar-foreground/60 hover:bg-destructive hover:text-destructive-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
