import { useEffect, useRef } from "react";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useThemeStore } from "@/stores/themeStore";
import { WelcomePage } from "@/pages/WelcomePage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { loadSession } from "@/lib/sessionRecovery";
import { ipc } from "@/lib/ipc";
import { setupMenuBridge, teardownMenuBridge } from "@/lib/menuBridge";
// Initialize theme store on import (applies saved theme to DOM)
import "@/stores/themeStore";

/** Only ping connections that have been idle for this long */
const IDLE_THRESHOLD_MS = 60_000;
const PING_INTERVAL_MS = 30_000;

function App() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  // Bridge native menu events to frontend store actions
  useEffect(() => {
    setupMenuBridge().catch((err) => {
      console.error('[App] Failed to initialize menu bridge:', err);
    });
    return () => teardownMenuBridge();
  }, []);

  // Track last activity per connection
  const lastActivityRef = useRef<Map<string, number>>(new Map());

  // Update last activity on any query execution
  useEffect(() => {
    const unsub = useQueryStore.subscribe((state) => {
      const executing = state.allTabs.filter((t) => t.isExecuting);
      const now = Date.now();
      for (const tab of executing) {
        if (tab.connectionId) {
          lastActivityRef.current.set(tab.connectionId, now);
        }
      }
    });
    return unsub;
  }, []);

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

      // Try to reconnect to all saved connections in parallel
      await Promise.allSettled(
        [...connectionIds].map((connId) => {
          const saved = savedConnections.find((c) => c.config.id === connId);
          if (saved) {
            return useConnectionStore.getState().connect(saved.config);
          }
          return Promise.resolve();
        })
      );

      // Restore all tabs across all connections
      useQueryStore.getState().restoreTabs(session.tabs, session.activeTabIds);
    }
    restore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Dark mode scheduling: system preference or time-based schedule
  const darkModeSchedule = usePreferencesStore((s) => s.darkModeSchedule);
  useEffect(() => {
    const { setDarkMode } = useThemeStore.getState();

    if (darkModeSchedule.mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        setDarkMode(mq.matches);
      };
      handler(); // Apply current system preference immediately
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }

    if (darkModeSchedule.mode === 'schedule') {
      const check = () => {
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const { lightFrom = '07:00', darkFrom = '19:00' } = darkModeSchedule;
        const shouldBeDark = time >= darkFrom || time < lightFrom;
        useThemeStore.getState().setDarkMode(shouldBeDark);
      };
      check(); // Apply immediately
      const interval = setInterval(check, 60_000);
      return () => clearInterval(interval);
    }
  }, [darkModeSchedule]);

  // Keep-alive: ping idle connections every 30 seconds
  const activeConnections = useConnectionStore((s) => s.activeConnections);
  useEffect(() => {
    if (activeConnections.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      for (const conn of activeConnections) {
        const lastActive = lastActivityRef.current.get(conn.connectionId) ?? 0;
        if (now - lastActive > IDLE_THRESHOLD_MS) {
          ipc.pingConnection(conn.connectionId).catch(() => {
            // Connection lost — silently ignore
          });
        }
      }
    }, PING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeConnections]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col">
        <div className="flex-1 overflow-hidden">
          {activeConnectionId ? <WorkspacePage /> : <WelcomePage />}
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
