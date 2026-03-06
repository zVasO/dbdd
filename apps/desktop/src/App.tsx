import { useEffect } from "react";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";
import { WelcomePage } from "@/pages/WelcomePage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TitleBar } from "@/components/layout/TitleBar";
import { loadSession } from "@/lib/sessionRecovery";
import { ipc } from "@/lib/ipc";
// Initialize theme store on import (applies saved theme to DOM)
import "@/stores/themeStore";

function App() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  // Restore session on first mount
  useEffect(() => {
    async function restore() {
      const session = loadSession();
      if (!session || session.tabs.length === 0) return;

      // Collect unique connectionIds from saved tabs
      const connectionIds = new Set(
        session.tabs
          .map((t) => t.connectionId)
          .filter((id): id is string => !!id)
      );

      // Load saved connections
      await useConnectionStore.getState().loadSavedConnections();
      const { savedConnections } = useConnectionStore.getState();

      // Try to reconnect to each saved connection
      for (const connId of connectionIds) {
        const saved = savedConnections.find((c) => c.config.id === connId);
        if (saved) {
          try {
            await useConnectionStore.getState().connect(saved.config);
          } catch {
            // Connection failed — tabs will still be restored with their connectionId
          }
        }
      }

      // Restore all tabs across all connections
      useQueryStore.getState().restoreTabs(session.tabs, session.activeTabIds);
    }
    restore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep-alive: ping all active connections every 30 seconds
  const activeConnections = useConnectionStore((s) => s.activeConnections);
  useEffect(() => {
    if (activeConnections.length === 0) return;
    const interval = setInterval(() => {
      for (const conn of activeConnections) {
        ipc.pingConnection(conn.connectionId).catch(() => {
          // Connection lost — silently ignore
        });
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [activeConnections]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col">
        <TitleBar />
        <div className="flex-1 overflow-hidden">
          {activeConnectionId ? <WorkspacePage /> : <WelcomePage />}
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
