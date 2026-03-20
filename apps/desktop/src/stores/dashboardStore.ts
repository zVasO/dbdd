import { create } from 'zustand';
import { ipc, extractErrorMessage } from '@/lib/ipc';
import type { QueryResult } from '@/lib/types';
import type { Layout, LayoutItem } from 'react-grid-layout';

// === Types ===

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'kpi' | 'table' | 'text';

export interface WidgetConfig {
  xColumn?: string;
  yColumn?: string;
  groupBy?: string;
  colorColumn?: string;
  refreshInterval?: number;
  kpiFormat?: string;
  kpiCompareColumn?: string;
}

export interface DashboardWidget {
  id: string;
  type: ChartType;
  title: string;
  sql: string;
  config: WidgetConfig;
  result?: QueryResult;
  loading?: boolean;
  error?: string;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  layout: LayoutItem[];
  createdAt: string;
}

interface DashboardState {
  dashboards: Dashboard[];
  activeDashboardId: string | null;

  createDashboard: (name: string) => string;
  deleteDashboard: (id: string) => void;
  renameDashboard: (id: string, name: string) => void;
  setActiveDashboard: (id: string | null) => void;

  addWidget: (dashboardId: string, widget: Omit<DashboardWidget, 'id'>) => string;
  updateWidget: (dashboardId: string, widgetId: string, updates: Partial<DashboardWidget>) => void;
  removeWidget: (dashboardId: string, widgetId: string) => void;
  updateLayout: (dashboardId: string, layout: LayoutItem[]) => void;

  executeWidgetQuery: (dashboardId: string, widgetId: string, connectionId: string) => Promise<void>;
  executeAllWidgets: (dashboardId: string, connectionId: string) => Promise<void>;
}

const STORAGE_KEY = 'vasodb:dashboards';

function persistDashboards(dashboards: Dashboard[]) {
  try {
    const serializable = dashboards.map((d) => ({
      ...d,
      widgets: d.widgets.map((w) => ({
        id: w.id,
        type: w.type,
        title: w.title,
        sql: w.sql,
        config: w.config,
      })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // Silently fail on storage errors
  }
}

function loadDashboards(): Dashboard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Dashboard[];
    return parsed.map((d) => ({
      ...d,
      widgets: d.widgets.map((w) => ({
        ...w,
        result: undefined,
        loading: false,
        error: undefined,
      })),
    }));
  } catch {
    return [];
  }
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  dashboards: loadDashboards(),
  activeDashboardId: null,

  createDashboard: (name) => {
    const id = crypto.randomUUID();
    const dashboard: Dashboard = {
      id,
      name,
      widgets: [],
      layout: [],
      createdAt: new Date().toISOString(),
    };
    set((s) => {
      const dashboards = [...s.dashboards, dashboard];
      persistDashboards(dashboards);
      return { dashboards, activeDashboardId: id };
    });
    return id;
  },

  deleteDashboard: (id) => {
    set((s) => {
      const dashboards = s.dashboards.filter((d) => d.id !== id);
      const activeDashboardId =
        s.activeDashboardId === id
          ? dashboards.length > 0
            ? dashboards[0].id
            : null
          : s.activeDashboardId;
      persistDashboards(dashboards);
      return { dashboards, activeDashboardId };
    });
  },

  renameDashboard: (id, name) => {
    set((s) => {
      const dashboards = s.dashboards.map((d) =>
        d.id === id ? { ...d, name } : d,
      );
      persistDashboards(dashboards);
      return { dashboards };
    });
  },

  setActiveDashboard: (id) => {
    set({ activeDashboardId: id });
  },

  addWidget: (dashboardId, widget) => {
    const widgetId = crypto.randomUUID();
    const fullWidget: DashboardWidget = {
      ...widget,
      id: widgetId,
      loading: false,
    };
    set((s) => {
      const dashboards = s.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        const existingCount = d.widgets.length;
        const newLayoutItem: LayoutItem = {
          i: widgetId,
          x: (existingCount * 4) % 12,
          y: Infinity,
          w: 4,
          h: 3,
          minW: 2,
          minH: 2,
        };
        return {
          ...d,
          widgets: [...d.widgets, fullWidget],
          layout: [...d.layout, newLayoutItem],
        };
      });
      persistDashboards(dashboards);
      return { dashboards };
    });
    return widgetId;
  },

  updateWidget: (dashboardId, widgetId, updates) => {
    set((s) => {
      const dashboards = s.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        return {
          ...d,
          widgets: d.widgets.map((w) =>
            w.id === widgetId ? { ...w, ...updates } : w,
          ),
        };
      });
      persistDashboards(dashboards);
      return { dashboards };
    });
  },

  removeWidget: (dashboardId, widgetId) => {
    set((s) => {
      const dashboards = s.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        return {
          ...d,
          widgets: d.widgets.filter((w) => w.id !== widgetId),
          layout: d.layout.filter((l) => l.i !== widgetId),
        };
      });
      persistDashboards(dashboards);
      return { dashboards };
    });
  },

  updateLayout: (dashboardId, layout) => {
    set((s) => {
      const dashboards = s.dashboards.map((d) =>
        d.id === dashboardId ? { ...d, layout } : d,
      );
      persistDashboards(dashboards);
      return { dashboards };
    });
  },

  executeWidgetQuery: async (dashboardId, widgetId, connectionId) => {
    const dashboard = get().dashboards.find((d) => d.id === dashboardId);
    const widget = dashboard?.widgets.find((w) => w.id === widgetId);
    if (!widget || !widget.sql.trim()) return;

    get().updateWidget(dashboardId, widgetId, {
      loading: true,
      error: undefined,
    });

    try {
      const result = await ipc.executeQuery(connectionId, widget.sql);
      get().updateWidget(dashboardId, widgetId, {
        result,
        loading: false,
        error: undefined,
      });
    } catch (e) {
      get().updateWidget(dashboardId, widgetId, {
        loading: false,
        error: extractErrorMessage(e),
      });
    }
  },

  executeAllWidgets: async (dashboardId, connectionId) => {
    const dashboard = get().dashboards.find((d) => d.id === dashboardId);
    if (!dashboard) return;

    const promises = dashboard.widgets
      .filter((w) => w.sql.trim())
      .map((w) => get().executeWidgetQuery(dashboardId, w.id, connectionId));

    await Promise.allSettled(promises);
  },
}));
