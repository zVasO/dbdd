import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { sendNotification } from '@/lib/notifications';

export interface ScheduledQuery {
  id: string;
  name: string;
  sql: string;
  connectionId: string;
  intervalMs: number;
  condition: {
    type: 'row_count_exceeds' | 'value_exceeds' | 'value_below' | 'result_changed';
    threshold?: number;
    column?: string;
  };
  enabled: boolean;
  lastResult?: string;
  lastRunAt?: number;
  lastAlertAt?: number;
}

export interface Alert {
  id: string;
  scheduledQueryId: string;
  queryName: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  read: boolean;
}

interface AlertState {
  scheduledQueries: ScheduledQuery[];
  alerts: Alert[];

  addScheduledQuery: (query: Omit<ScheduledQuery, 'id'>) => void;
  updateScheduledQuery: (id: string, updates: Partial<ScheduledQuery>) => void;
  removeScheduledQuery: (id: string) => void;
  toggleScheduledQuery: (id: string) => void;

  startScheduler: () => void;
  stopScheduler: () => void;

  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAlerts: () => void;

  getUnreadCount: () => number;
}

const QUERIES_STORAGE_KEY = 'vasodb:scheduled-queries';
const ALERTS_STORAGE_KEY = 'vasodb:alerts';

// Module-level timers map (not in state since timers are not serializable)
const timers = new Map<string, ReturnType<typeof setInterval>>();

function stopTimer(id: string): void {
  const existing = timers.get(id);
  if (existing) {
    clearInterval(existing);
    timers.delete(id);
  }
}

function startTimer(id: string, intervalMs: number): void {
  stopTimer(id);
  timers.set(id, setInterval(() => executeAndCheck(id), intervalMs));
}

function loadScheduledQueries(): ScheduledQuery[] {
  try {
    const raw = localStorage.getItem(QUERIES_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ScheduledQuery[];
  } catch {
    return [];
  }
}

function persistScheduledQueries(queries: ScheduledQuery[]): void {
  localStorage.setItem(QUERIES_STORAGE_KEY, JSON.stringify(queries));
}

function loadAlerts(): Alert[] {
  try {
    const raw = localStorage.getItem(ALERTS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Alert[];
  } catch {
    return [];
  }
}

function persistAlerts(alerts: Alert[]): void {
  localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
}

function hashResult(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

async function executeAndCheck(id: string): Promise<void> {
  const state = useAlertStore.getState();
  const query = state.scheduledQueries.find((q) => q.id === id);
  if (!query) return;

  try {
    const result = await ipc.executeQuery(query.connectionId, query.sql);
    const resultStr = JSON.stringify(result.rows);
    const resultHash = hashResult(resultStr);
    let conditionMet = false;
    let message = '';
    let severity: Alert['severity'] = 'info';

    switch (query.condition.type) {
      case 'row_count_exceeds': {
        const threshold = query.condition.threshold ?? 0;
        if (result.rows.length > threshold) {
          conditionMet = true;
          message = `Row count (${result.rows.length}) exceeds threshold (${threshold})`;
          severity = result.rows.length > threshold * 2 ? 'critical' : 'warning';
        }
        break;
      }
      case 'value_exceeds': {
        const col = query.condition.column;
        const threshold = query.condition.threshold ?? 0;
        if (col && result.rows.length > 0) {
          const colIndex = result.columns.findIndex((c) => c.name === col);
          if (colIndex >= 0) {
            const cell = result.rows[0].cells[colIndex];
            const val = cell.type === 'Integer' || cell.type === 'Float' ? cell.value : null;
            if (val !== null && val > threshold) {
              conditionMet = true;
              message = `Value of "${col}" (${val}) exceeds threshold (${threshold})`;
              severity = val > threshold * 2 ? 'critical' : 'warning';
            }
          }
        }
        break;
      }
      case 'value_below': {
        const col = query.condition.column;
        const threshold = query.condition.threshold ?? 0;
        if (col && result.rows.length > 0) {
          const colIndex = result.columns.findIndex((c) => c.name === col);
          if (colIndex >= 0) {
            const cell = result.rows[0].cells[colIndex];
            const val = cell.type === 'Integer' || cell.type === 'Float' ? cell.value : null;
            if (val !== null && val < threshold) {
              conditionMet = true;
              message = `Value of "${col}" (${val}) is below threshold (${threshold})`;
              severity = 'warning';
            }
          }
        }
        break;
      }
      case 'result_changed': {
        if (query.lastResult && query.lastResult !== resultHash) {
          conditionMet = true;
          message = 'Query result has changed since last check';
          severity = 'info';
        }
        break;
      }
    }

    // Update the scheduled query with last run info
    state.updateScheduledQuery(query.id, {
      lastRunAt: Date.now(),
      lastResult: resultHash,
    });

    // Create alert if condition met and not too recent (5 min cooldown)
    const COOLDOWN_MS = 5 * 60 * 1000;
    if (conditionMet && (!query.lastAlertAt || Date.now() - query.lastAlertAt > COOLDOWN_MS)) {
      const alert: Alert = {
        id: crypto.randomUUID(),
        scheduledQueryId: query.id,
        queryName: query.name,
        message,
        severity,
        timestamp: Date.now(),
        read: false,
      };

      const updatedAlerts = [...useAlertStore.getState().alerts, alert];
      useAlertStore.setState({ alerts: updatedAlerts });
      persistAlerts(updatedAlerts);

      state.updateScheduledQuery(query.id, { lastAlertAt: Date.now() });

      sendNotification(`VasOdb Alert: ${query.name}`, message);
    }
  } catch (e) {
    // Update last run time even on error
    state.updateScheduledQuery(query.id, { lastRunAt: Date.now() });
    console.error(`Scheduled query "${query.name}" failed:`, e);
  }
}

export const useAlertStore = create<AlertState>((set, get) => ({
  scheduledQueries: loadScheduledQueries(),
  alerts: loadAlerts(),

  addScheduledQuery: (query) => {
    const newQuery: ScheduledQuery = {
      ...query,
      id: crypto.randomUUID(),
    };
    const updated = [...get().scheduledQueries, newQuery];
    set({ scheduledQueries: updated });
    persistScheduledQueries(updated);

    // Start timer if enabled
    if (newQuery.enabled) {
      startTimer(newQuery.id, newQuery.intervalMs);
    }
  },

  updateScheduledQuery: (id, updates) => {
    const updated = get().scheduledQueries.map((q) =>
      q.id === id ? { ...q, ...updates } : q,
    );
    set({ scheduledQueries: updated });
    persistScheduledQueries(updated);

    // Re-arm only when scheduling-relevant fields change — not on the
    // lastRunAt/lastResult/lastAlertAt bookkeeping writes from executeAndCheck.
    if ('sql' in updates || 'intervalMs' in updates || 'enabled' in updates) {
      const q = updated.find((x) => x.id === id);
      if (q?.enabled) startTimer(id, q.intervalMs);
      else stopTimer(id);
    }
  },

  removeScheduledQuery: (id) => {
    stopTimer(id);
    const updated = get().scheduledQueries.filter((q) => q.id !== id);
    set({ scheduledQueries: updated });
    persistScheduledQueries(updated);
  },

  toggleScheduledQuery: (id) => {
    const query = get().scheduledQueries.find((q) => q.id === id);
    if (!query) return;
    // updateScheduledQuery re-arms the timer for the new enabled state.
    get().updateScheduledQuery(id, { enabled: !query.enabled });
  },

  startScheduler: () => {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();

    for (const query of get().scheduledQueries) {
      if (query.enabled) startTimer(query.id, query.intervalMs);
    }
  },

  stopScheduler: () => {
    for (const [, timer] of timers) {
      clearInterval(timer);
    }
    timers.clear();
  },

  markAsRead: (id) => {
    const updated = get().alerts.map((a) =>
      a.id === id ? { ...a, read: true } : a,
    );
    set({ alerts: updated });
    persistAlerts(updated);
  },

  markAllAsRead: () => {
    const updated = get().alerts.map((a) => ({ ...a, read: true }));
    set({ alerts: updated });
    persistAlerts(updated);
  },

  clearAlerts: () => {
    set({ alerts: [] });
    persistAlerts([]);
  },

  getUnreadCount: () => {
    return get().alerts.filter((a) => !a.read).length;
  },
}));
