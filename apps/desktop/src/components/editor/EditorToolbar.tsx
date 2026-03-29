import { useChangeStore } from '@/stores/changeStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { ipc } from '@/lib/ipc';
import { useQueryStore } from '@/stores/queryStore';
import { openSqlFile, saveSqlFile } from '@/lib/fileOps';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { Play, Save, Eye, Undo2, Redo2, Trash2, Loader2, Wand2, FolderOpen, Download, Sparkles, Brain, Zap, GitBranch, Check, X, StopCircle } from 'lucide-react';
import { useState, useCallback } from 'react';
import { showSuccessToast, showErrorToast } from '@/stores/toastStore';
import { useAIStore } from '@/stores/aiStore';
import { AiResultDialog } from '@/components/ai/AiResultDialog';
import { cn } from '@/lib/utils';

interface Props {
  isExecuting: boolean;
  onRun: () => void;
}

export function EditorToolbar({ isExecuting, onRun }: Props) {
  const pendingCount = useChangeStore((s) => s.pendingCount());
  const hasPending = pendingCount > 0;
  const undo = useChangeStore((s) => s.undo);
  const redo = useChangeStore((s) => s.redo);
  const discard = useChangeStore((s) => s.discard);
  const setPreviewOpen = useChangeStore((s) => s.setPreviewOpen);
  const generateSql = useChangeStore((s) => s.generateSql);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeTab = useQueryStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const [isCommitting, setIsCommitting] = useState(false);
  const [txState, setTxState] = useState<'none' | 'active' | 'error'>('none');
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDialogTitle, setAiDialogTitle] = useState('');
  const [aiDialogContent, setAiDialogContent] = useState('');
  const [aiDialogLoading, setAiDialogLoading] = useState(false);

  const handleCommit = useCallback(async () => {
    if (!activeConnectionId || !hasPending) return;
    setIsCommitting(true);
    try {
      const statements = generateSql();
      await ipc.executeBatch(activeConnectionId, statements);
      useChangeStore.getState().discard();
      showSuccessToast(`${pendingCount} change${pendingCount > 1 ? 's' : ''} saved`);
      // Re-execute the active query to refresh the grid
      const { activeTabId, executeQuery } = useQueryStore.getState();
      if (activeTabId) {
        executeQuery(activeConnectionId, activeTabId);
      }
    } catch (err) {
      showErrorToast(`Commit failed: ${String(err)}`);
      console.error('Commit failed:', err);
    } finally {
      setIsCommitting(false);
    }
  }, [activeConnectionId, hasPending, generateSql]);

  const handleBeginTx = useCallback(async () => {
    if (!activeConnectionId || txState === 'active') return;
    try {
      await ipc.executeQuery(activeConnectionId, 'BEGIN');
      setTxState('active');
    } catch { setTxState('error'); }
  }, [activeConnectionId, txState]);

  const handleCommitTx = useCallback(async () => {
    if (!activeConnectionId || txState !== 'active') return;
    try {
      await ipc.executeQuery(activeConnectionId, 'COMMIT');
      setTxState('none');
    } catch { setTxState('error'); }
  }, [activeConnectionId, txState]);

  const handleRollbackTx = useCallback(async () => {
    if (!activeConnectionId || txState !== 'active') return;
    try {
      await ipc.executeQuery(activeConnectionId, 'ROLLBACK');
      setTxState('none');
    } catch { setTxState('error'); }
  }, [activeConnectionId, txState]);

  const handleCancel = useCallback(async () => {
    if (!activeConnectionId || !activeTab?.activeQueryId) return;
    try {
      await useQueryStore.getState().cancelQuery(activeConnectionId, activeTab.activeQueryId);
    } catch (e) {
      console.warn('Cancel failed:', e);
    }
  }, [activeConnectionId, activeTab?.activeQueryId]);

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex items-center gap-1 border-b border-border bg-muted px-2"
        style={{ height: 'var(--toolbar-height)' }}
      >
        {/* Run button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRun}
              disabled={isExecuting}
              className="gap-1.5 text-xs"
            >
              {isExecuting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run
            </Button>
          </TooltipTrigger>
          <TooltipContent>Run query (Ctrl+Enter)</TooltipContent>
        </Tooltip>

        {/* Cancel query */}
        {isExecuting && activeTab?.activeQueryId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancel}
                className="gap-1.5 text-xs text-destructive hover:text-destructive"
              >
                <StopCircle className="h-3.5 w-3.5" />
                Stop
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cancel query (Esc)</TooltipContent>
          </Tooltip>
        )}

        {/* Format SQL */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => document.dispatchEvent(new CustomEvent('vasodb:format'))}
              className="gap-1.5 text-xs"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Format
            </Button>
          </TooltipTrigger>
          <TooltipContent>Format SQL (Ctrl+I)</TooltipContent>
        </Tooltip>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Open SQL file */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={async () => {
                const file = await openSqlFile();
                if (file) {
                  const { activeTabId } = useQueryStore.getState();
                  if (activeTabId) {
                    useQueryStore.getState().updateSql(activeTabId, file.content);
                  } else {
                    const tabId = useQueryStore.getState().createTab(file.name);
                    useQueryStore.getState().updateSql(tabId, file.content);
                  }
                }
              }}
              className="h-7 w-7"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open SQL file (Ctrl+O)</TooltipContent>
        </Tooltip>

        {/* Save SQL file */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={async () => {
                const { activeTabId, tabs } = useQueryStore.getState();
                const tab = tabs.find((t) => t.id === activeTabId);
                if (tab?.sql) {
                  await saveSqlFile(tab.sql, `${tab.title}.sql`);
                }
              }}
              className="h-7 w-7"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save SQL file (Ctrl+Shift+S)</TooltipContent>
        </Tooltip>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* AI: Explain Query */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={async () => {
                const { tabs, activeTabId } = useQueryStore.getState();
                const tab = tabs.find((t) => t.id === activeTabId);
                if (!tab?.sql?.trim()) return;
                setAiDialogTitle('Query Explanation');
                setAiDialogContent('');
                setAiDialogLoading(true);
                setAiDialogOpen(true);
                try {
                  const result = await useAIStore.getState().explainQuery(tab.sql);
                  setAiDialogContent(result);
                } catch (e) {
                  setAiDialogContent(`Error: ${String(e)}`);
                } finally {
                  setAiDialogLoading(false);
                }
              }}
              className="h-7 w-7"
            >
              <Brain className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Explain Query (AI)</TooltipContent>
        </Tooltip>

        {/* AI: Optimize Query */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={async () => {
                const { tabs, activeTabId } = useQueryStore.getState();
                const tab = tabs.find((t) => t.id === activeTabId);
                if (!tab?.sql?.trim()) return;
                setAiDialogTitle('Query Optimization');
                setAiDialogContent('');
                setAiDialogLoading(true);
                setAiDialogOpen(true);
                try {
                  const result = await useAIStore.getState().optimizeQuery(tab.sql);
                  setAiDialogContent(result);
                } catch (e) {
                  setAiDialogContent(`Error: ${String(e)}`);
                } finally {
                  setAiDialogLoading(false);
                }
              }}
              className="h-7 w-7"
            >
              <Zap className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Optimize Query (AI)</TooltipContent>
        </Tooltip>

        {/* AI: Chat */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => useAIStore.getState().setChatOpen(true)}
              className="h-7 w-7"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>AI Assistant (Ctrl+J)</TooltipContent>
        </Tooltip>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Transaction control */}
        {txState === 'none' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleBeginTx}
                disabled={!activeConnectionId}
                className="gap-1 text-xs"
              >
                <GitBranch className="h-3.5 w-3.5" />
                BEGIN
              </Button>
            </TooltipTrigger>
            <TooltipContent>Start transaction</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-center gap-0.5">
            <Badge variant="outline" className={cn('gap-1 text-[10px]', txState === 'error' ? 'border-destructive text-destructive' : 'border-primary text-primary')}>
              <GitBranch className="h-3 w-3" />
              TXN
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={handleCommitTx} className="gap-1 text-xs text-primary hover:text-primary">
                  <Check className="h-3.5 w-3.5" />
                  COMMIT
                </Button>
              </TooltipTrigger>
              <TooltipContent>Commit transaction</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={handleRollbackTx} className="gap-1 text-xs text-destructive hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                  ROLLBACK
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rollback transaction</TooltipContent>
            </Tooltip>
          </div>
        )}

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Undo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" onClick={undo} className="h-7 w-7">
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
        </Tooltip>

        {/* Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" onClick={redo} className="h-7 w-7">
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        {/* Pending changes indicator + actions */}
        {hasPending && (
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="gap-1 text-[10px]">
              {pendingCount} pending
            </Badge>

            {/* Preview SQL */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPreviewOpen(true)}
                  className="gap-1 text-xs"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview SQL (Ctrl+Shift+P)</TooltipContent>
            </Tooltip>

            {/* Discard */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={discard}
                  className="gap-1 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Discard
                </Button>
              </TooltipTrigger>
              <TooltipContent>Discard all changes</TooltipContent>
            </Tooltip>

            {/* Commit */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={handleCommit}
                  disabled={isCommitting}
                  className="gap-1 text-xs"
                >
                  {isCommitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Commit
                </Button>
              </TooltipTrigger>
              <TooltipContent>Commit changes (Ctrl+S)</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
      <AiResultDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        title={aiDialogTitle}
        content={aiDialogContent}
        loading={aiDialogLoading}
        onInsertSQL={(sql) => {
          const { activeTabId, updateSql, tabs } = useQueryStore.getState();
          const tab = tabs.find((t) => t.id === activeTabId);
          if (tab) {
            updateSql(tab.id, tab.sql ? `${tab.sql}\n${sql}` : sql);
          }
        }}
      />
    </TooltipProvider>
  );
}
