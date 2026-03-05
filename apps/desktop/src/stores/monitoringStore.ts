import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import type { CellValue } from '@/lib/types';

// === Types ===

export interface MetricDataPoint {
  timestamp: number;
  value: number;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: string; // 'queries_per_sec' | 'active_connections' | 'cache_hit_ratio' | 'slow_queries'
  operator: '>' | '<' | '>=' | '<=' | '==';
  threshold: number;
  enabled: boolean;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  value: number;
  threshold: number;
  timestamp: number;
  acknowledged: boolean;
}

interface MonitoringState {
  metrics: Record<string, MetricDataPoint[]>; // metric name -> last 100 points
  previousValues: Record<string, number>; // for computing deltas (queries/sec)
  alertRules: AlertRule[];
  alertHistory: AlertEvent[];
  isPolling: boolean;
  pollIntervalMs: number;
  pollingTimer: ReturnType<typeof setInterval> | null;

  startPolling: (connectionId: string, dbType: string) => void;
  stopPolling: () => void;
  addAlertRule: (rule: Omit<AlertRule, 'id'>) => void;
  removeAlertRule: (id: string) => void;
  toggleAlertRule: (id: string) => void;
  acknowledgeAlert: (id: string) => void;
  clearAlerts: () => void;
}

// === Helpers ===

const MAX_DATA_POINTS = 100;
const ALERT_RULES_KEY = 'dataforge:alert-rules';

function cellToNumber(cell: CellValue): number {
  switch (cell.type) {
    case 'Integer':
    case 'Float':
      return cell.value;
    case 'Text': {
      const parsed = parseFloat(cell.value);
      return isNaN(parsed) ? 0 : parsed;
    }
    default:
      return 0;
  }
}

function loadAlertRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(ALERT_RULES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AlertRule[];
  } catch {
    return [];
  }
}

function persistAlertRules(rules: AlertRule[]) {
  try {
    localStorage.setItem(ALERT_RULES_KEY, JSON.stringify(rules));
  } catch {
    // Silently fail on storage errors
  }
}

function pushMetricPoint(
  metrics: Record<string, MetricDataPoint[]>,
  key: string,
  value: number,
): Record<string, MetricDataPoint[]> {
  const existing = metrics[key] ?? [];
  const point: MetricDataPoint = { timestamp: Date.now(), value };
  const updated = [...existing, point];
  if (updated.length > MAX_DATA_POINTS) {
    updated.splice(0, updated.length - MAX_DATA_POINTS);
  }
  return { ...metrics, [key]: updated };
}

function evaluateRule(rule: AlertRule, value: number): boolean {
  switch (rule.operator) {
    case '>':
      return value > rule.threshold;
    case '<':
      return value < rule.threshold;
    case '>=':
      return value >= rule.threshold;
    case '<=':
      return value <= rule.threshold;
    case '==':
      return value === rule.threshold;
    default:
      return false;
  }
}

// === Store ===

export const useMonitoringStore = create<MonitoringState>((set, get) => ({
  metrics: {},
  previousValues: {},
  alertRules: loadAlertRules(),
  alertHistory: [],
  isPolling: false,
  pollIntervalMs: 2000,
  pollingTimer: null,

  startPolling: (connectionId, dbType) => {
    const state = get();
    // Stop any existing polling first
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
    }

    set({ isPolling: true, metrics: {}, previousValues: {} });

    const poll = async () => {
      try {
        if (dbType === 'mysql') {
          await pollMySQL(connectionId);
        } else if (dbType === 'postgres') {
          await pollPostgres(connectionId);
        }
      } catch {
        // Silently ignore poll failures — connection may have dropped
      }
    };

    // Initial poll
    poll();

    const timer = setInterval(poll, get().pollIntervalMs);
    set({ pollingTimer: timer });
  },

  stopPolling: () => {
    const { pollingTimer } = get();
    if (pollingTimer) {
      clearInterval(pollingTimer);
    }
    set({ isPolling: false, pollingTimer: null });
  },

  addAlertRule: (rule) => {
    const id = crypto.randomUUID();
    set((s) => {
      const alertRules = [...s.alertRules, { ...rule, id }];
      persistAlertRules(alertRules);
      return { alertRules };
    });
  },

  removeAlertRule: (id) => {
    set((s) => {
      const alertRules = s.alertRules.filter((r) => r.id !== id);
      persistAlertRules(alertRules);
      return { alertRules };
    });
  },

  toggleAlertRule: (id) => {
    set((s) => {
      const alertRules = s.alertRules.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled } : r,
      );
      persistAlertRules(alertRules);
      return { alertRules };
    });
  },

  acknowledgeAlert: (id) => {
    set((s) => ({
      alertHistory: s.alertHistory.map((a) =>
        a.id === id ? { ...a, acknowledged: true } : a,
      ),
    }));
  },

  clearAlerts: () => {
    set({ alertHistory: [] });
  },
}));

// === Polling Functions ===

function checkAlerts(metricName: string, value: number) {
  const { alertRules } = useMonitoringStore.getState();
  const enabledRules = alertRules.filter(
    (r) => r.enabled && r.metric === metricName,
  );

  for (const rule of enabledRules) {
    if (evaluateRule(rule, value)) {
      const event: AlertEvent = {
        id: crypto.randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        value,
        threshold: rule.threshold,
        timestamp: Date.now(),
        acknowledged: false,
      };
      useMonitoringStore.setState((s) => ({
        alertHistory: [event, ...s.alertHistory].slice(0, 200),
      }));
    }
  }
}

async function pollMySQL(connectionId: string) {
  const sql = `SHOW GLOBAL STATUS WHERE Variable_name IN ('Queries', 'Threads_connected', 'Threads_running', 'Slow_queries', 'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads')`;
  const result = await ipc.executeQuery(connectionId, sql);

  const statusMap: Record<string, number> = {};
  for (const row of result.rows) {
    const varName = row.cells[0].type === 'Text' ? row.cells[0].value : '';
    const varValue = cellToNumber(row.cells[1]);
    statusMap[varName.toLowerCase()] = varValue;
  }

  const totalQueries = statusMap['queries'] ?? 0;
  const threadsConnected = statusMap['threads_connected'] ?? 0;
  const slowQueries = statusMap['slow_queries'] ?? 0;
  const readRequests = statusMap['innodb_buffer_pool_read_requests'] ?? 0;
  const reads = statusMap['innodb_buffer_pool_reads'] ?? 0;

  const state = useMonitoringStore.getState();
  const prevQueries = state.previousValues['queries'] ?? totalQueries;
  const intervalSec = state.pollIntervalMs / 1000;
  const queriesPerSec =
    prevQueries > 0
      ? Math.max(0, (totalQueries - prevQueries) / intervalSec)
      : 0;

  const cacheHitRatio =
    readRequests + reads > 0
      ? (readRequests / (readRequests + reads)) * 100
      : 100;

  let metrics = state.metrics;
  metrics = pushMetricPoint(metrics, 'queries_per_sec', queriesPerSec);
  metrics = pushMetricPoint(metrics, 'active_connections', threadsConnected);
  metrics = pushMetricPoint(metrics, 'cache_hit_ratio', cacheHitRatio);
  metrics = pushMetricPoint(metrics, 'slow_queries', slowQueries);

  useMonitoringStore.setState({
    metrics,
    previousValues: {
      ...state.previousValues,
      queries: totalQueries,
    },
  });

  // Check alert rules for each metric
  checkAlerts('queries_per_sec', queriesPerSec);
  checkAlerts('active_connections', threadsConnected);
  checkAlerts('cache_hit_ratio', cacheHitRatio);
  checkAlerts('slow_queries', slowQueries);
}

async function pollPostgres(connectionId: string) {
  const sql = `SELECT xact_commit + xact_rollback as total_xacts, numbackends, blks_hit, blks_read FROM pg_stat_database WHERE datname = current_database()`;
  const result = await ipc.executeQuery(connectionId, sql);

  if (result.rows.length === 0) return;

  const row = result.rows[0];
  const colNames = result.columns.map((c) => c.name.toLowerCase());
  const getCol = (name: string): number => {
    const idx = colNames.indexOf(name);
    return idx >= 0 ? cellToNumber(row.cells[idx]) : 0;
  };

  const totalXacts = getCol('total_xacts');
  const numbackends = getCol('numbackends');
  const blksHit = getCol('blks_hit');
  const blksRead = getCol('blks_read');

  const state = useMonitoringStore.getState();
  const prevXacts = state.previousValues['total_xacts'] ?? totalXacts;
  const intervalSec = state.pollIntervalMs / 1000;
  const queriesPerSec =
    prevXacts > 0
      ? Math.max(0, (totalXacts - prevXacts) / intervalSec)
      : 0;

  const cacheHitRatio =
    blksHit + blksRead > 0
      ? (blksHit / (blksHit + blksRead)) * 100
      : 100;

  // Postgres doesn't have a direct slow_queries counter, use 0 as placeholder
  const slowQueries = 0;

  let metrics = state.metrics;
  metrics = pushMetricPoint(metrics, 'queries_per_sec', queriesPerSec);
  metrics = pushMetricPoint(metrics, 'active_connections', numbackends);
  metrics = pushMetricPoint(metrics, 'cache_hit_ratio', cacheHitRatio);
  metrics = pushMetricPoint(metrics, 'slow_queries', slowQueries);

  useMonitoringStore.setState({
    metrics,
    previousValues: {
      ...state.previousValues,
      total_xacts: totalXacts,
    },
  });

  // Check alert rules for each metric
  checkAlerts('queries_per_sec', queriesPerSec);
  checkAlerts('active_connections', numbackends);
  checkAlerts('cache_hit_ratio', cacheHitRatio);
  checkAlerts('slow_queries', slowQueries);
}
