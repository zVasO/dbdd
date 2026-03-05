import { useEffect } from "react";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";
import { WelcomePage } from "@/pages/WelcomePage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { loadSession, clearSession } from "@/lib/sessionRecovery";
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

      if (session.connectionId) {
        // Ensure saved connections are loaded before looking up
        await useConnectionStore.getState().loadSavedConnections();
        const { savedConnections } = useConnectionStore.getState();
        const saved = savedConnections.find(
          (c) => c.config.id === session.connectionId
        );
        if (saved) {
          try {
            await useConnectionStore.getState().connect(saved.config);
            useQueryStore.getState().restoreTabs(session.tabs, session.activeTabId);
          } catch {
            // Connection failed — still restore tabs for the SQL content
            useQueryStore.getState().restoreTabs(session.tabs, session.activeTabId);
          }
          return;
        }
      }

      // No connection to restore, just restore tabs
      useQueryStore.getState().restoreTabs(session.tabs, session.activeTabId);
    }
    restore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep-alive: ping the active connection every 30 seconds
  useEffect(() => {
    if (!activeConnectionId) return;
    const interval = setInterval(() => {
      ipc.pingConnection(activeConnectionId).catch(() => {
        // Connection lost — silently ignore; user will see errors on next action
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [activeConnectionId]);

  return (
    <ErrorBoundary>
      {activeConnectionId ? <WorkspacePage /> : <WelcomePage />}
    </ErrorBoundary>
  );
}

export default App;
