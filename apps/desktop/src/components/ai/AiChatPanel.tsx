import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles,
  X,
  Trash2,
  Send,
  Database,
  Search,
  FileCode,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAIStore } from '@/stores/aiStore';
import { useQueryStore } from '@/stores/queryStore';
import { AiMessage } from './AiMessage';

const SUGGESTIONS = [
  { icon: Database, text: 'Show me the top 10 largest tables' },
  { icon: Search, text: 'Write a query to find duplicates' },
  { icon: FileCode, text: 'Explain schema relationships' },
];

export function AiChatPanel() {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const chatOpen = useAIStore((s) => s.chatOpen);
  const chatMessages = useAIStore((s) => s.chatMessages);
  const isGenerating = useAIStore((s) => s.isGenerating);
  const providerType = useAIStore((s) => s.providerType);
  const setChatOpen = useAIStore((s) => s.setChatOpen);
  const sendChatMessage = useAIStore((s) => s.sendChatMessage);
  const clearChat = useAIStore((s) => s.clearChat);

  const createTab = useQueryStore((s) => s.createTab);
  const updateSql = useQueryStore((s) => s.updateSql);
  const activeTabId = useQueryStore((s) => s.activeTabId);
  const tabs = useQueryStore((s) => s.tabs);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Focus textarea when panel opens
  useEffect(() => {
    if (chatOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [chatOpen]);

  const handleInsertSQL = useCallback(
    (sql: string) => {
      if (activeTabId) {
        const activeTab = tabs.find((t) => t.id === activeTabId);
        if (activeTab) {
          const newSql = activeTab.sql
            ? `${activeTab.sql}\n\n${sql}`
            : sql;
          updateSql(activeTabId, newSql);
          return;
        }
      }
      // No active tab, create a new one
      const tabId = createTab('AI Query');
      updateSql(tabId, sql);
    },
    [activeTabId, tabs, updateSql, createTab],
  );

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;
    setInput('');
    sendChatMessage(trimmed);
  }, [input, isGenerating, sendChatMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleSuggestionClick = useCallback(
    (text: string) => {
      sendChatMessage(text);
    },
    [sendChatMessage],
  );

  if (!chatOpen) return null;

  const providerLabel =
    providerType === 'claude'
      ? 'Claude'
      : providerType === 'openai'
        ? 'OpenAI'
        : 'Ollama';

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-medium">AI Assistant</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {providerLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={clearChat}
            title="Clear chat"
            disabled={chatMessages.length === 0}
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setChatOpen(false)}
            title="Close"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {chatMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 mb-4">
                <Sparkles className="size-6 text-primary" />
              </div>
              <h3 className="text-sm font-medium mb-1">Ask AI anything</h3>
              <p className="text-xs text-muted-foreground text-center mb-6">
                Get help writing SQL queries, understanding your schema, or optimizing performance.
              </p>
              <div className="flex w-full flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.text}
                    onClick={() => handleSuggestionClick(suggestion.text)}
                    className={cn(
                      'flex items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm',
                      'transition-colors hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <suggestion.icon className="size-4 shrink-0 text-muted-foreground" />
                    <span>{suggestion.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            chatMessages.map((msg) => (
              <AiMessage
                key={msg.id}
                message={msg}
                onInsertSQL={handleInsertSQL}
              />
            ))
          )}
          <div ref={scrollEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isGenerating ? 'Generating...' : 'Ask about your database...'}
            disabled={isGenerating}
            rows={2}
            className={cn(
              'flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm',
              'placeholder:text-muted-foreground',
              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
              'outline-none transition-[color,box-shadow]',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            title="Send message"
          >
            <Send className="size-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
