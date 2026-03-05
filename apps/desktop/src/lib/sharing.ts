import type { Dashboard } from '@/stores/dashboardStore';
import type { Snippet } from '@/stores/snippetStore';

export interface SharedQueryCollection {
  version: 1;
  type: 'query-collection';
  name: string;
  exportedAt: string;
  queries: { title: string; sql: string; description?: string; dbType?: string }[];
}

export interface SharedDashboard {
  version: 1;
  type: 'dashboard';
  name: string;
  exportedAt: string;
  dashboard: {
    name: string;
    widgets: { type: string; title: string; sql: string; config: Record<string, unknown> }[];
    layout: { i: string; x: number; y: number; w: number; h: number }[];
  };
}

export interface SharedSnippetCollection {
  version: 1;
  type: 'snippet-collection';
  name: string;
  exportedAt: string;
  snippets: { name: string; sql: string; description: string; tags: string[] }[];
}

export type SharedFile = SharedQueryCollection | SharedDashboard | SharedSnippetCollection;

export function exportQueries(
  queries: { title: string; sql: string; description?: string; dbType?: string }[],
  name: string,
): string {
  const data: SharedQueryCollection = {
    version: 1,
    type: 'query-collection',
    name,
    exportedAt: new Date().toISOString(),
    queries,
  };
  return JSON.stringify(data, null, 2);
}

export function exportDashboard(dashboard: Dashboard): string {
  const data: SharedDashboard = {
    version: 1,
    type: 'dashboard',
    name: dashboard.name,
    exportedAt: new Date().toISOString(),
    dashboard: {
      name: dashboard.name,
      widgets: dashboard.widgets.map((w) => ({
        type: w.type,
        title: w.title,
        sql: w.sql,
        config: w.config as Record<string, unknown>,
      })),
      layout: dashboard.layout.map((l) => ({
        i: l.i,
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
      })),
    },
  };
  return JSON.stringify(data, null, 2);
}

export function exportSnippets(snippets: Snippet[], name: string): string {
  const data: SharedSnippetCollection = {
    version: 1,
    type: 'snippet-collection',
    name,
    exportedAt: new Date().toISOString(),
    snippets: snippets.map((s) => ({
      name: s.name,
      sql: s.sql,
      description: s.description,
      tags: s.tags,
    })),
  };
  return JSON.stringify(data, null, 2);
}

export function parseSharedFile(json: string): SharedFile {
  const data = JSON.parse(json);

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid file: not a valid JSON object');
  }

  if (data.version !== 1) {
    throw new Error(`Unsupported file version: ${data.version}`);
  }

  if (data.type === 'query-collection') {
    if (!Array.isArray(data.queries)) {
      throw new Error('Invalid query collection: missing queries array');
    }
    return data as SharedQueryCollection;
  }

  if (data.type === 'dashboard') {
    if (!data.dashboard || !Array.isArray(data.dashboard.widgets)) {
      throw new Error('Invalid dashboard: missing dashboard data');
    }
    return data as SharedDashboard;
  }

  if (data.type === 'snippet-collection') {
    if (!Array.isArray(data.snippets)) {
      throw new Error('Invalid snippet collection: missing snippets array');
    }
    return data as SharedSnippetCollection;
  }

  throw new Error(`Unknown file type: ${data.type}`);
}

export function downloadJSON(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function copyQueryToClipboard(title: string, sql: string, dbType?: string): void {
  const parts: string[] = [];
  parts.push(`-- ${title}`);
  if (dbType) {
    parts.push(`-- Database: ${dbType}`);
  }
  parts.push(sql);
  const text = parts.join('\n');
  navigator.clipboard.writeText(text);
}
