import React from 'react';

/** Safely convert data_type to string - backend may return objects like {Varchar: 255} */
export function formatDataType(dt: unknown): string {
  if (typeof dt === 'string') return dt;
  if (dt && typeof dt === 'object') {
    const entries = Object.entries(dt as Record<string, unknown>);
    if (entries.length === 1) {
      const [key, val] = entries[0];
      if (val === null || val === undefined) return key.toLowerCase();
      return `${key.toLowerCase()}(${val})`;
    }
    return JSON.stringify(dt);
  }
  return String(dt ?? '');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-primary/25 text-primary rounded-sm">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function HighlightFuzzy({ text, matches }: { text: string; matches: [number, number][] }) {
  if (!matches || matches.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;

  for (const [start, end] of matches) {
    if (start > lastIdx) {
      parts.push(text.slice(lastIdx, start));
    }
    parts.push(
      <span key={start} className="bg-primary/25 text-primary rounded-sm">
        {text.slice(start, end)}
      </span>
    );
    lastIdx = end;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return <>{parts}</>;
}
