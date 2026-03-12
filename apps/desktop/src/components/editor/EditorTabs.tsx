import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, Plus, GitBranch, LayoutDashboard, Activity, Search, Code2, Workflow, ArrowLeftRight, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QueryTab } from '@/stores/queryStore';
import { useQueryStore } from '@/stores/queryStore';

function TabIcon({ viewMode, isActive }: { viewMode: string; isActive?: boolean }) {
  const iconClass = cn('size-3', isActive ? 'text-foreground' : 'text-muted-foreground');
  switch (viewMode) {
    case 'er-diagram': return <GitBranch className={iconClass} />;
    case 'dashboard': return <LayoutDashboard className={iconClass} />;
    case 'health': return <Activity className={iconClass} />;
    case 'explain': return <Search className={iconClass} />;
    case 'query-builder': return <Workflow className={iconClass} />;
    case 'migration': return <ArrowLeftRight className={iconClass} />;
    case 'alerts': return <Bell className={iconClass} />;
    default: return <Code2 className={iconClass} />;
  }
}

interface Props {
  tabs: QueryTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

export function EditorTabs({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIndex(index);
  };

  const handleDragLeave = () => {
    setDropIndex(null);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex) {
      useQueryStore.getState().reorderTabs(dragIndex, toIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  return (
    <div
      className="flex items-center overflow-x-auto border-b border-border bg-muted"
      style={{ height: 'var(--tab-height)' }}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            className={cn(
              'group flex cursor-pointer items-center gap-1 border-r border-border px-3 py-1 text-xs',
              isActive
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground',
              dragIndex === index && 'opacity-40',
              dropIndex === index && dragIndex !== index && 'border-l-2 border-primary',
            )}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onCloseTab(tab.id);
              }
            }}
          >
            <TabIcon viewMode={tab.viewMode} isActive={isActive} />
            <span className="max-w-[120px] truncate">{tab.title}</span>
            {tab.isExecuting && (
              <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="ml-1 size-4 opacity-0 group-hover:opacity-100"
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onNewTab}
        className="ml-1 text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3" />
      </Button>
    </div>
  );
}
