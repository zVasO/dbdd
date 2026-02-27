import type { QueryTab } from '@/stores/queryStore';

interface Props {
  tabs: QueryTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

export function EditorTabs({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }: Props) {
  return (
    <div
      className="flex items-center border-b"
      style={{
        height: 'var(--tab-height)',
        background: 'var(--color-bg-secondary)',
        borderColor: 'var(--color-border)',
      }}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="group flex items-center gap-1 border-r px-3 py-1 text-xs cursor-pointer"
          style={{
            borderColor: 'var(--color-border)',
            background: tab.id === activeTabId ? 'var(--color-bg-primary)' : 'transparent',
            color: tab.id === activeTabId ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
          }}
          onClick={() => onSelectTab(tab.id)}
        >
          <span className="truncate max-w-[120px]">{tab.title}</span>
          {tab.isExecuting && (
            <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--color-accent)' }} />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            className="ml-1 opacity-0 group-hover:opacity-100 hover:opacity-80"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            x
          </button>
        </div>
      ))}
      <button
        onClick={onNewTab}
        className="px-3 py-1 text-xs hover:opacity-80"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        +
      </button>
    </div>
  );
}
