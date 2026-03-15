# PurrQL Game-Breaker Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 9 game-breaker features (AI Engine, ER Diagrams, Dashboard Builder, Query Profiler, Data Diff, Smart Snippets, Query Versioning, Data Masking, DB Health Monitor) to make PurrQL the #1 database client.

**Architecture:** Each feature is a self-contained module (store + components + lib). Features integrate through the existing tab system (`queryStore.ts`) by extending `TabViewMode` and through the settings page. The AI Engine provides a shared service used by multiple features.

**Tech Stack:** React 19, TypeScript, Zustand v5, Tailwind CSS v4, @xyflow/react (ER diagrams), recharts (charts), react-grid-layout (dashboards), Monaco Editor (SQL editing). AI via direct fetch to Claude/OpenAI/Ollama APIs.

---

## Task 1: Install New Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install production dependencies**

Run:
```bash
cd /c/Users/devdy/Documents/GitHub/dbdd/apps/desktop
npm install @xyflow/react dagre recharts react-grid-layout
```

**Step 2: Install type definitions**

Run:
```bash
npm install -D @types/dagre @types/react-grid-layout
```

**Step 3: Verify installation**

Run: `npm ls @xyflow/react recharts react-grid-layout dagre`
Expected: All packages listed without errors

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add dependencies for ER diagrams, charts, and dashboards"
```

---

## Task 2: AI Provider Layer

**Files:**
- Create: `src/lib/aiProviders/types.ts`
- Create: `src/lib/aiProviders/claudeProvider.ts`
- Create: `src/lib/aiProviders/openaiProvider.ts`
- Create: `src/lib/aiProviders/ollamaProvider.ts`
- Create: `src/lib/aiProviders/index.ts`

**Step 1: Create AI types**

Create `src/lib/aiProviders/types.ts`:

```ts
export type AIProviderType = 'claude' | 'openai' | 'ollama';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIProviderConfig {
  type: AIProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}

export interface AIStreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export interface AIProvider {
  name: string;
  type: AIProviderType;
  sendMessage(
    messages: AIMessage[],
    config: AIProviderConfig,
    callbacks?: AIStreamCallbacks,
  ): Promise<string>;
  listModels?(config: AIProviderConfig): Promise<string[]>;
}

export const DEFAULT_MODELS: Record<AIProviderType, string> = {
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  ollama: 'llama3',
};
```

**Step 2: Create Claude provider**

Create `src/lib/aiProviders/claudeProvider.ts`:

```ts
import type { AIProvider, AIMessage, AIProviderConfig, AIStreamCallbacks } from './types';

export const claudeProvider: AIProvider = {
  name: 'Claude',
  type: 'claude',

  async sendMessage(messages: AIMessage[], config: AIProviderConfig, callbacks?: AIStreamCallbacks): Promise<string> {
    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: config.model || 'claude-sonnet-4-20250514',
      max_tokens: config.maxTokens || 4096,
      messages: chatMessages,
      stream: config.streaming && !!callbacks,
    };
    if (systemMessage) body.system = systemMessage.content;
    if (config.temperature !== undefined) body.temperature = config.temperature;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API error: ${res.status} ${err}`);
    }

    if (config.streaming && callbacks && res.body) {
      return streamSSE(res.body, callbacks, 'claude');
    }

    const data = await res.json();
    return data.content?.[0]?.text || '';
  },
};

async function streamSSE(body: ReadableStream, callbacks: AIStreamCallbacks, provider: string): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          let token = '';
          if (provider === 'claude') {
            if (parsed.type === 'content_block_delta') token = parsed.delta?.text || '';
          } else {
            token = parsed.choices?.[0]?.delta?.content || '';
          }
          if (token) {
            full += token;
            callbacks.onToken(token);
          }
        } catch {
          // skip malformed JSON
        }
      }
    }
    callbacks.onDone();
  } catch (e) {
    callbacks.onError(String(e));
  }
  return full;
}
```

**Step 3: Create OpenAI provider**

Create `src/lib/aiProviders/openaiProvider.ts`:

```ts
import type { AIProvider, AIMessage, AIProviderConfig, AIStreamCallbacks } from './types';

export const openaiProvider: AIProvider = {
  name: 'OpenAI',
  type: 'openai',

  async sendMessage(messages: AIMessage[], config: AIProviderConfig, callbacks?: AIStreamCallbacks): Promise<string> {
    const body = {
      model: config.model || 'gpt-4o',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.3,
      stream: config.streaming && !!callbacks,
    };

    const res = await fetch(`${config.baseUrl || 'https://api.openai.com'}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey || ''}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error: ${res.status} ${err}`);
    }

    if (config.streaming && callbacks && res.body) {
      return streamSSE(res.body, callbacks);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  },

  async listModels(config: AIProviderConfig): Promise<string[]> {
    const res = await fetch(`${config.baseUrl || 'https://api.openai.com'}/v1/models`, {
      headers: { Authorization: `Bearer ${config.apiKey || ''}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .filter((m: { id: string }) => m.id.startsWith('gpt-'))
      .map((m: { id: string }) => m.id);
  },
};

async function streamSSE(body: ReadableStream, callbacks: AIStreamCallbacks): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content || '';
          if (token) {
            full += token;
            callbacks.onToken(token);
          }
        } catch { /* skip */ }
      }
    }
    callbacks.onDone();
  } catch (e) {
    callbacks.onError(String(e));
  }
  return full;
}
```

**Step 4: Create Ollama provider**

Create `src/lib/aiProviders/ollamaProvider.ts`:

```ts
import type { AIProvider, AIMessage, AIProviderConfig, AIStreamCallbacks } from './types';

export const ollamaProvider: AIProvider = {
  name: 'Ollama',
  type: 'ollama',

  async sendMessage(messages: AIMessage[], config: AIProviderConfig, callbacks?: AIStreamCallbacks): Promise<string> {
    const baseUrl = config.baseUrl || 'http://localhost:11434';
    const body = {
      model: config.model || 'llama3',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: config.streaming && !!callbacks,
    };

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama API error: ${res.status} ${err}`);
    }

    if (config.streaming && callbacks && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              const token = parsed.message?.content || '';
              if (token) {
                full += token;
                callbacks.onToken(token);
              }
            } catch { /* skip */ }
          }
        }
        callbacks.onDone();
      } catch (e) {
        callbacks.onError(String(e));
      }
      return full;
    }

    const data = await res.json();
    return data.message?.content || '';
  },

  async listModels(config: AIProviderConfig): Promise<string[]> {
    const baseUrl = config.baseUrl || 'http://localhost:11434';
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m: { name: string }) => m.name);
  },
};
```

**Step 5: Create provider index**

Create `src/lib/aiProviders/index.ts`:

```ts
import type { AIProvider, AIProviderType } from './types';
import { claudeProvider } from './claudeProvider';
import { openaiProvider } from './openaiProvider';
import { ollamaProvider } from './ollamaProvider';

export type { AIProvider, AIProviderType, AIMessage, AIProviderConfig, AIStreamCallbacks } from './types';
export { DEFAULT_MODELS } from './types';

const providers: Record<AIProviderType, AIProvider> = {
  claude: claudeProvider,
  openai: openaiProvider,
  ollama: ollamaProvider,
};

export function getProvider(type: AIProviderType): AIProvider {
  return providers[type];
}
```

**Step 6: Commit**

```bash
git add src/lib/aiProviders/
git commit -m "feat: add multi-provider AI layer (Claude, OpenAI, Ollama)"
```

---

## Task 3: AI Store

**Files:**
- Create: `src/stores/aiStore.ts`

**Step 1: Create the AI store**

Create `src/stores/aiStore.ts`:

```ts
import { create } from 'zustand';
import { getProvider, DEFAULT_MODELS } from '@/lib/aiProviders';
import type { AIProviderType, AIProviderConfig, AIMessage } from '@/lib/aiProviders';
import { useSchemaStore } from './schemaStore';
import { useConnectionStore } from './connectionStore';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  generating?: boolean;
}

interface AIState {
  // Config
  providerType: AIProviderType;
  apiKeys: Record<string, string>;
  ollamaUrl: string;
  model: Record<AIProviderType, string>;
  streaming: boolean;
  temperature: number;

  // Chat
  chatOpen: boolean;
  chatMessages: ChatMessage[];
  isGenerating: boolean;

  // Actions
  setChatOpen: (open: boolean) => void;
  setProvider: (type: AIProviderType) => void;
  setApiKey: (provider: string, key: string) => void;
  setOllamaUrl: (url: string) => void;
  setModel: (provider: AIProviderType, model: string) => void;
  setStreaming: (enabled: boolean) => void;
  setTemperature: (temp: number) => void;
  sendChatMessage: (content: string) => Promise<void>;
  generateSQL: (prompt: string) => Promise<string>;
  explainQuery: (sql: string) => Promise<string>;
  optimizeQuery: (sql: string) => Promise<string>;
  clearChat: () => void;
}

function getSchemaContext(): string {
  const { structures, tables, databases } = useSchemaStore.getState();
  const config = useConnectionStore.getState().activeConfig;
  const dbType = config?.db_type || 'unknown';
  let context = `Database type: ${dbType}\n`;

  for (const db of databases) {
    context += `\nDatabase: ${db.name}\n`;
    const dbTables = tables[db.name] || [];
    for (const t of dbTables) {
      const key = `${db.name}.${t.name}`;
      const structure = structures[key];
      if (structure) {
        const cols = structure.columns
          .map((c) => `  ${c.name} ${c.data_type}${c.is_primary_key ? ' PK' : ''}${c.nullable ? '' : ' NOT NULL'}`)
          .join('\n');
        const fks = structure.foreign_keys
          .map((fk) => `  FK: ${fk.columns.join(',')} -> ${fk.referenced_table.table}(${fk.referenced_columns.join(',')})`)
          .join('\n');
        context += `Table: ${t.name} (${t.table_type})\n${cols}\n${fks ? fks + '\n' : ''}`;
      } else {
        context += `Table: ${t.name} (${t.table_type})\n`;
      }
    }
  }
  return context;
}

function loadPersistedConfig(): Partial<AIState> {
  try {
    const raw = localStorage.getItem('purrql:ai-config');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      providerType: parsed.providerType,
      apiKeys: parsed.apiKeys || {},
      ollamaUrl: parsed.ollamaUrl || 'http://localhost:11434',
      model: parsed.model || {},
      streaming: parsed.streaming ?? true,
      temperature: parsed.temperature ?? 0.3,
    };
  } catch {
    return {};
  }
}

export const useAIStore = create<AIState>((set, get) => {
  const persisted = loadPersistedConfig();

  return {
    providerType: persisted.providerType || 'claude',
    apiKeys: persisted.apiKeys || {},
    ollamaUrl: persisted.ollamaUrl || 'http://localhost:11434',
    model: persisted.model || { ...DEFAULT_MODELS },
    streaming: persisted.streaming ?? true,
    temperature: persisted.temperature ?? 0.3,

    chatOpen: false,
    chatMessages: [],
    isGenerating: false,

    setChatOpen: (open) => set({ chatOpen: open }),

    setProvider: (type) => {
      set({ providerType: type });
      persistConfig(get());
    },

    setApiKey: (provider, key) => {
      set((s) => ({ apiKeys: { ...s.apiKeys, [provider]: key } }));
      persistConfig(get());
    },

    setOllamaUrl: (url) => {
      set({ ollamaUrl: url });
      persistConfig(get());
    },

    setModel: (provider, model) => {
      set((s) => ({ model: { ...s.model, [provider]: model } }));
      persistConfig(get());
    },

    setStreaming: (enabled) => {
      set({ streaming: enabled });
      persistConfig(get());
    },

    setTemperature: (temp) => {
      set({ temperature: temp });
      persistConfig(get());
    },

    sendChatMessage: async (content) => {
      const state = get();
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        generating: true,
      };

      set((s) => ({
        chatMessages: [...s.chatMessages, userMsg, assistantMsg],
        isGenerating: true,
      }));

      const schemaContext = getSchemaContext();
      const systemPrompt = `You are PurrQL AI, an expert database assistant. You help users write SQL queries, explain database concepts, optimize performance, and manage schemas.

Current database schema:
${schemaContext}

Rules:
- Write SQL compatible with the connected database type
- When generating SQL, wrap it in \`\`\`sql code blocks
- Be concise and practical
- If asked to generate a query, provide the SQL directly`;

      const messages: AIMessage[] = [
        { role: 'system', content: systemPrompt },
        ...state.chatMessages
          .filter((m) => !m.generating)
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content },
      ];

      const config: import('@/lib/aiProviders').AIProviderConfig = {
        type: state.providerType,
        apiKey: state.apiKeys[state.providerType],
        baseUrl: state.providerType === 'ollama' ? state.ollamaUrl : undefined,
        model: state.model[state.providerType],
        streaming: state.streaming,
        temperature: state.temperature,
        maxTokens: 4096,
      };

      try {
        const provider = getProvider(state.providerType);
        const result = await provider.sendMessage(messages, config, state.streaming ? {
          onToken: (token) => {
            set((s) => ({
              chatMessages: s.chatMessages.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: m.content + token } : m,
              ),
            }));
          },
          onDone: () => {
            set((s) => ({
              chatMessages: s.chatMessages.map((m) =>
                m.id === assistantMsg.id ? { ...m, generating: false } : m,
              ),
              isGenerating: false,
            }));
          },
          onError: (error) => {
            set((s) => ({
              chatMessages: s.chatMessages.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: `Error: ${error}`, generating: false } : m,
              ),
              isGenerating: false,
            }));
          },
        } : undefined);

        if (!state.streaming) {
          set((s) => ({
            chatMessages: s.chatMessages.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: result, generating: false } : m,
            ),
            isGenerating: false,
          }));
        }
      } catch (e) {
        set((s) => ({
          chatMessages: s.chatMessages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: `Error: ${String(e)}`, generating: false } : m,
          ),
          isGenerating: false,
        }));
      }
    },

    generateSQL: async (prompt) => {
      const state = get();
      const schemaContext = getSchemaContext();
      const messages: AIMessage[] = [
        {
          role: 'system',
          content: `You are a SQL expert. Generate ONLY the SQL query, no explanations. The database schema is:\n${schemaContext}`,
        },
        { role: 'user', content: prompt },
      ];

      const config: import('@/lib/aiProviders').AIProviderConfig = {
        type: state.providerType,
        apiKey: state.apiKeys[state.providerType],
        baseUrl: state.providerType === 'ollama' ? state.ollamaUrl : undefined,
        model: state.model[state.providerType],
        streaming: false,
        temperature: 0.1,
        maxTokens: 2048,
      };

      const provider = getProvider(state.providerType);
      const result = await provider.sendMessage(messages, config);
      // Extract SQL from code blocks if present
      const match = result.match(/```sql\n?([\s\S]*?)```/);
      return match ? match[1].trim() : result.trim();
    },

    explainQuery: async (sql) => {
      const state = get();
      const schemaContext = getSchemaContext();
      const messages: AIMessage[] = [
        {
          role: 'system',
          content: `You are a SQL expert. Explain the following query in clear, concise language. Mention what tables are involved, what the query does, and any performance considerations. Schema:\n${schemaContext}`,
        },
        { role: 'user', content: `Explain this SQL query:\n\`\`\`sql\n${sql}\n\`\`\`` },
      ];

      const config: import('@/lib/aiProviders').AIProviderConfig = {
        type: state.providerType,
        apiKey: state.apiKeys[state.providerType],
        baseUrl: state.providerType === 'ollama' ? state.ollamaUrl : undefined,
        model: state.model[state.providerType],
        streaming: false,
        temperature: 0.2,
        maxTokens: 2048,
      };

      const provider = getProvider(state.providerType);
      return provider.sendMessage(messages, config);
    },

    optimizeQuery: async (sql) => {
      const state = get();
      const schemaContext = getSchemaContext();
      const messages: AIMessage[] = [
        {
          role: 'system',
          content: `You are a database performance expert. Analyze the query and suggest optimizations. Include: 1) Rewritten optimized query 2) Index suggestions 3) Explanation of changes. Schema:\n${schemaContext}`,
        },
        { role: 'user', content: `Optimize this SQL query:\n\`\`\`sql\n${sql}\n\`\`\`` },
      ];

      const config: import('@/lib/aiProviders').AIProviderConfig = {
        type: state.providerType,
        apiKey: state.apiKeys[state.providerType],
        baseUrl: state.providerType === 'ollama' ? state.ollamaUrl : undefined,
        model: state.model[state.providerType],
        streaming: false,
        temperature: 0.2,
        maxTokens: 4096,
      };

      const provider = getProvider(state.providerType);
      return provider.sendMessage(messages, config);
    },

    clearChat: () => set({ chatMessages: [] }),
  };
});

function persistConfig(state: AIState) {
  localStorage.setItem(
    'purrql:ai-config',
    JSON.stringify({
      providerType: state.providerType,
      apiKeys: state.apiKeys,
      ollamaUrl: state.ollamaUrl,
      model: state.model,
      streaming: state.streaming,
      temperature: state.temperature,
    }),
  );
}
```

**Step 2: Commit**

```bash
git add src/stores/aiStore.ts
git commit -m "feat: add AI store with multi-provider chat, SQL generation, explain, optimize"
```

---

## Task 4: AI Chat Panel Component

**Files:**
- Create: `src/components/ai/AiChatPanel.tsx`
- Create: `src/components/ai/AiMessage.tsx`
- Modify: `src/components/layout/AppLayout.tsx` (add chat panel toggle + Ctrl+J shortcut)

**Step 1: Create AiMessage component**

Create `src/components/ai/AiMessage.tsx`:

```tsx
import { cn } from '@/lib/utils';
import { Bot, User, Copy, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatMessage } from '@/stores/aiStore';

interface Props {
  message: ChatMessage;
  onInsertSQL?: (sql: string) => void;
}

export function AiMessage({ message, onInsertSQL }: Props) {
  const isUser = message.role === 'user';

  // Extract SQL code blocks
  const sqlBlocks = message.content.match(/```sql\n?([\s\S]*?)```/g) || [];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const renderContent = () => {
    if (!sqlBlocks.length) {
      return <p className="whitespace-pre-wrap text-sm">{message.content}</p>;
    }

    const parts = message.content.split(/(```sql\n?[\s\S]*?```)/g);
    return parts.map((part, i) => {
      const sqlMatch = part.match(/```sql\n?([\s\S]*?)```/);
      if (sqlMatch) {
        const sql = sqlMatch[1].trim();
        return (
          <div key={i} className="my-2 rounded-md border border-border bg-muted/50 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-3 py-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase">SQL</span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => copyToClipboard(sql)}
                  title="Copy"
                >
                  <Copy className="size-3" />
                </Button>
                {onInsertSQL && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onInsertSQL(sql)}
                    title="Insert to Editor"
                  >
                    <Play className="size-3" />
                  </Button>
                )}
              </div>
            </div>
            <pre className="p-3 text-xs font-mono overflow-x-auto"><code>{sql}</code></pre>
          </div>
        );
      }
      return part ? <p key={i} className="whitespace-pre-wrap text-sm">{part}</p> : null;
    });
  };

  return (
    <div className={cn('flex gap-3 px-4 py-3', isUser ? 'bg-transparent' : 'bg-muted/30')}>
      <div className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full',
        isUser ? 'bg-primary/10 text-primary' : 'bg-accent text-accent-foreground',
      )}>
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        {renderContent()}
        {message.generating && (
          <span className="inline-block h-4 w-1 animate-pulse bg-foreground/50" />
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create AiChatPanel component**

Create `src/components/ai/AiChatPanel.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react';
import { useAIStore } from '@/stores/aiStore';
import { useQueryStore } from '@/stores/queryStore';
import { AiMessage } from './AiMessage';
import { Button } from '@/components/ui/button';
import { X, Send, Trash2, Sparkles, Settings } from 'lucide-react';

export function AiChatPanel() {
  const chatOpen = useAIStore((s) => s.chatOpen);
  const setChatOpen = useAIStore((s) => s.setChatOpen);
  const chatMessages = useAIStore((s) => s.chatMessages);
  const isGenerating = useAIStore((s) => s.isGenerating);
  const sendChatMessage = useAIStore((s) => s.sendChatMessage);
  const clearChat = useAIStore((s) => s.clearChat);
  const providerType = useAIStore((s) => s.providerType);

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    if (chatOpen) inputRef.current?.focus();
  }, [chatOpen]);

  if (!chatOpen) return null;

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;
    setInput('');
    sendChatMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInsertSQL = (sql: string) => {
    const { tabs, activeTabId, updateSql, createTab } = useQueryStore.getState();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      const newSql = activeTab.sql ? `${activeTab.sql}\n${sql}` : sql;
      updateSql(activeTab.id, newSql);
    } else {
      const id = createTab('AI Query');
      useQueryStore.getState().updateSql(id, sql);
    }
  };

  return (
    <div className="flex h-full w-[380px] flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-medium">AI Assistant</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {providerType}
          </span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-xs" onClick={clearChat} title="Clear chat">
            <Trash2 className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => setChatOpen(false)}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {chatMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <Sparkles className="mb-3 size-8 opacity-50" />
            <p className="text-sm font-medium">Ask me anything about your database</p>
            <p className="mt-1 text-xs">I can write SQL, explain queries, optimize performance, and more.</p>
            <div className="mt-4 grid gap-2 w-full max-w-[260px]">
              {[
                'Show me the top 10 largest tables',
                'Write a query to find duplicate rows',
                'Explain the schema relationships',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {chatMessages.map((msg) => (
          <AiMessage key={msg.id} message={msg} onInsertSQL={handleInsertSQL} />
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your database..."
            className="flex-1 resize-none rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            rows={2}
            disabled={isGenerating}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            className="self-end"
          >
            <Send className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Integrate AI Chat into AppLayout**

Modify `src/components/layout/AppLayout.tsx`:
- Add import for `AiChatPanel`
- Add `Ctrl+J` shortcut to toggle AI chat
- Add `AiChatPanel` to the layout

In the imports, add:
```tsx
import { AiChatPanel } from '@/components/ai/AiChatPanel';
import { useAIStore } from '@/stores/aiStore';
```

In the shortcuts array, add:
```tsx
{
  key: 'j',
  modifiers: ['ctrl'],
  handler: () => {
    const store = useAIStore.getState();
    store.setChatOpen(!store.chatOpen);
  },
},
```

In the JSX, wrap PanelLayout and AiChatPanel in a flex container:
Replace `<PanelLayout />` with:
```tsx
<PanelLayout />
<AiChatPanel />
```

**Step 4: Commit**

```bash
git add src/components/ai/ src/components/layout/AppLayout.tsx
git commit -m "feat: add AI chat panel with multi-provider support and Ctrl+J toggle"
```

---

## Task 5: AI Integration in Editor (NL-to-SQL, Explain, Optimize)

**Files:**
- Modify: `src/components/editor/EditorToolbar.tsx` (add AI buttons)
- Create: `src/components/ai/AiResultDialog.tsx`

**Step 1: Create AI result dialog**

Create `src/components/ai/AiResultDialog.tsx`:

```tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, Play, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: string;
  loading?: boolean;
  onInsertSQL?: (sql: string) => void;
}

export function AiResultDialog({ open, onOpenChange, title, content, loading, onInsertSQL }: Props) {
  const sqlMatch = content.match(/```sql\n?([\s\S]*?)```/);
  const sql = sqlMatch?.[1]?.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="whitespace-pre-wrap text-sm">{content}</div>
            {sql && onInsertSQL && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(sql)}>
                  <Copy className="mr-1.5 size-3" /> Copy SQL
                </Button>
                <Button size="sm" onClick={() => { onInsertSQL(sql); onOpenChange(false); }}>
                  <Play className="mr-1.5 size-3" /> Insert to Editor
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Add AI buttons to EditorToolbar**

Modify `src/components/editor/EditorToolbar.tsx` to add Explain, Optimize, and Generate SQL buttons. Add these imports and buttons alongside the existing toolbar buttons. The exact integration depends on the current toolbar structure - add a separator and AI action buttons (Sparkles icon for generate, Brain icon for explain, Zap icon for optimize).

**Step 3: Commit**

```bash
git add src/components/ai/AiResultDialog.tsx src/components/editor/EditorToolbar.tsx
git commit -m "feat: add AI explain, optimize, and generate SQL buttons in editor toolbar"
```

---

## Task 6: AI Settings Section

**Files:**
- Modify: `src/components/settings/SettingsPage.tsx` (add AI configuration section)

**Step 1: Add AI settings section**

Add a new section to SettingsPage.tsx between existing sections. The section should include:
- Provider selector (radio group: Claude, OpenAI, Ollama)
- API key input for Claude (password field)
- API key input for OpenAI (password field)
- Ollama URL input (text field, default: http://localhost:11434)
- Model selector per provider
- Streaming toggle
- Temperature slider (0.0 - 1.0)

All values read/write from `useAIStore`.

**Step 2: Commit**

```bash
git add src/components/settings/SettingsPage.tsx
git commit -m "feat: add AI provider configuration in settings"
```

---

## Task 7: ER Diagram Store

**Files:**
- Create: `src/stores/erDiagramStore.ts`

**Step 1: Create the ER diagram store**

Create `src/stores/erDiagramStore.ts`:

```ts
import { create } from 'zustand';
import type { TableStructure, ForeignKeyInfo } from '@/lib/types';
import { useSchemaStore } from './schemaStore';

export interface ERNode {
  id: string;
  table: string;
  database: string;
  columns: Array<{
    name: string;
    type: string;
    isPK: boolean;
    isFK: boolean;
    nullable: boolean;
  }>;
  position: { x: number; y: number };
}

export interface EREdge {
  id: string;
  source: string;
  target: string;
  sourceColumn: string;
  targetColumn: string;
  label: string;
  fk: ForeignKeyInfo;
}

interface ERDiagramState {
  nodes: ERNode[];
  edges: EREdge[];
  selectedDatabase: string | null;
  layoutDirection: 'TB' | 'LR';

  generateDiagram: (database: string) => void;
  setLayoutDirection: (dir: 'TB' | 'LR') => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
}

export const useERDiagramStore = create<ERDiagramState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedDatabase: null,
  layoutDirection: 'TB',

  generateDiagram: (database) => {
    const { tables, structures } = useSchemaStore.getState();
    const dbTables = tables[database] || [];

    const fkColumnSet = new Set<string>();
    // Collect all FK columns first
    for (const t of dbTables) {
      const key = `${database}.${t.name}`;
      const structure = structures[key];
      if (structure) {
        for (const fk of structure.foreign_keys) {
          for (const col of fk.columns) {
            fkColumnSet.add(`${t.name}.${col}`);
          }
        }
      }
    }

    const nodes: ERNode[] = dbTables.map((t, i) => {
      const key = `${database}.${t.name}`;
      const structure = structures[key];
      return {
        id: t.name,
        table: t.name,
        database,
        columns: structure
          ? structure.columns.map((c) => ({
              name: c.name,
              type: c.data_type,
              isPK: c.is_primary_key,
              isFK: fkColumnSet.has(`${t.name}.${c.name}`),
              nullable: c.nullable,
            }))
          : [],
        position: { x: (i % 4) * 300, y: Math.floor(i / 4) * 350 },
      };
    });

    const edges: EREdge[] = [];
    for (const t of dbTables) {
      const key = `${database}.${t.name}`;
      const structure = structures[key];
      if (!structure) continue;
      for (const fk of structure.foreign_keys) {
        edges.push({
          id: `${t.name}-${fk.name}`,
          source: t.name,
          target: fk.referenced_table.table,
          sourceColumn: fk.columns[0],
          targetColumn: fk.referenced_columns[0],
          label: `${fk.columns.join(',')} -> ${fk.referenced_columns.join(',')}`,
          fk,
        });
      }
    }

    set({ nodes, edges, selectedDatabase: database });
  },

  setLayoutDirection: (dir) => set({ layoutDirection: dir }),

  updateNodePosition: (nodeId, position) => {
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
    }));
  },
}));
```

**Step 2: Commit**

```bash
git add src/stores/erDiagramStore.ts
git commit -m "feat: add ER diagram store with auto-generation from schema"
```

---

## Task 8: ER Diagram Components

**Files:**
- Create: `src/components/er-diagram/ERDiagramView.tsx`
- Create: `src/components/er-diagram/TableNode.tsx`
- Create: `src/components/er-diagram/RelationEdge.tsx`
- Create: `src/components/er-diagram/ERToolbar.tsx`

**Step 1: Create TableNode**

Create `src/components/er-diagram/TableNode.tsx`:

```tsx
import { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Key, Link, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ERNode } from '@/stores/erDiagramStore';

interface Props {
  data: ERNode;
}

export const TableNode = memo(function TableNode({ data }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-w-[200px] rounded-lg border border-border bg-card shadow-md overflow-hidden">
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />

      {/* Header */}
      <div
        className="flex items-center gap-2 bg-primary/10 px-3 py-2 cursor-pointer"
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        <span className="text-xs font-semibold text-foreground">{data.table}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{data.columns.length} cols</span>
      </div>

      {/* Columns */}
      {!collapsed && (
        <div className="divide-y divide-border">
          {data.columns.map((col) => (
            <div
              key={col.name}
              className={cn(
                'flex items-center gap-2 px-3 py-1 text-[11px]',
                col.isPK && 'bg-yellow-500/5',
                col.isFK && 'bg-blue-500/5',
              )}
            >
              {col.isPK && <Key className="size-3 text-yellow-500" />}
              {col.isFK && !col.isPK && <Link className="size-3 text-blue-500" />}
              {!col.isPK && !col.isFK && <span className="w-3" />}
              <span className={cn('font-medium', col.isPK && 'text-yellow-600', col.isFK && 'text-blue-600')}>
                {col.name}
              </span>
              <span className="ml-auto text-muted-foreground">{col.type}</span>
              {col.nullable && <span className="text-muted-foreground/50">?</span>}
            </div>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
    </div>
  );
});
```

**Step 2: Create RelationEdge**

Create `src/components/er-diagram/RelationEdge.tsx`:

```tsx
import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, EdgeLabelRenderer } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';

export const RelationEdge = memo(function RelationEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, style } = props;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <BaseEdge path={edgePath} style={{ ...style, strokeWidth: 1.5 }} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan rounded bg-background/90 px-1.5 py-0.5 text-[9px] text-muted-foreground border border-border"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
```

**Step 3: Create ERToolbar**

Create `src/components/er-diagram/ERToolbar.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { useERDiagramStore } from '@/stores/erDiagramStore';
import { ArrowDown, ArrowRight, ZoomIn, ZoomOut, Maximize, Download, Sparkles } from 'lucide-react';
import type { ReactFlowInstance } from '@xyflow/react';

interface Props {
  rfInstance: ReactFlowInstance | null;
  onAiAnalyze?: () => void;
}

export function ERToolbar({ rfInstance, onAiAnalyze }: Props) {
  const layoutDirection = useERDiagramStore((s) => s.layoutDirection);
  const setLayoutDirection = useERDiagramStore((s) => s.setLayoutDirection);

  const handleExportPNG = () => {
    // React Flow doesn't have built-in PNG export; we'll use html-to-image or similar
    // For now, copy SVG to clipboard
    if (!rfInstance) return;
    const svg = document.querySelector('.react-flow__viewport')?.parentElement?.querySelector('svg');
    if (svg) {
      navigator.clipboard.writeText(svg.outerHTML);
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-border bg-muted px-3 py-1">
      <span className="text-xs font-medium text-muted-foreground mr-2">ER Diagram</span>

      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => rfInstance?.zoomIn()}
        title="Zoom in"
      >
        <ZoomIn className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => rfInstance?.zoomOut()}
        title="Zoom out"
      >
        <ZoomOut className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => rfInstance?.fitView({ padding: 0.2 })}
        title="Fit view"
      >
        <Maximize className="size-3.5" />
      </Button>

      <div className="mx-2 h-4 w-px bg-border" />

      <Button
        variant={layoutDirection === 'TB' ? 'secondary' : 'ghost'}
        size="icon-xs"
        onClick={() => setLayoutDirection('TB')}
        title="Top to bottom"
      >
        <ArrowDown className="size-3.5" />
      </Button>
      <Button
        variant={layoutDirection === 'LR' ? 'secondary' : 'ghost'}
        size="icon-xs"
        onClick={() => setLayoutDirection('LR')}
        title="Left to right"
      >
        <ArrowRight className="size-3.5" />
      </Button>

      <div className="mx-2 h-4 w-px bg-border" />

      <Button variant="ghost" size="icon-xs" onClick={handleExportPNG} title="Export">
        <Download className="size-3.5" />
      </Button>

      {onAiAnalyze && (
        <Button variant="ghost" size="icon-xs" onClick={onAiAnalyze} title="AI Analyze Schema">
          <Sparkles className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
```

**Step 4: Create ERDiagramView**

Create `src/components/er-diagram/ERDiagramView.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type ReactFlowInstance,
  ReactFlowProvider,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import { useERDiagramStore } from '@/stores/erDiagramStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { TableNode } from './TableNode';
import { RelationEdge } from './RelationEdge';
import { ERToolbar } from './ERToolbar';

const nodeTypes = { table: TableNode };
const edgeTypes = { relation: RelationEdge };

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR',
) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80 });

  for (const node of nodes) {
    g.setNode(node.id, { width: 220, height: 40 + (node.data?.columns?.length || 0) * 24 });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 110, y: pos.y - 20 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

function ERDiagramInner() {
  const erNodes = useERDiagramStore((s) => s.nodes);
  const erEdges = useERDiagramStore((s) => s.edges);
  const layoutDirection = useERDiagramStore((s) => s.layoutDirection);
  const selectedDatabase = useERDiagramStore((s) => s.selectedDatabase);
  const generateDiagram = useERDiagramStore((s) => s.generateDiagram);
  const databases = useSchemaStore((s) => s.databases);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  // Convert to React Flow format
  const rfNodes: Node[] = useMemo(
    () =>
      erNodes.map((n) => ({
        id: n.id,
        type: 'table',
        position: n.position,
        data: n,
      })),
    [erNodes],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      erEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'relation',
        label: e.label,
        animated: false,
      })),
    [erEdges],
  );

  // Apply layout
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(rfNodes, rfEdges, layoutDirection),
    [rfNodes, rfEdges, layoutDirection],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  // Auto-generate for first database if none selected
  useEffect(() => {
    if (!selectedDatabase && databases.length > 0) {
      generateDiagram(databases[0].name);
    }
  }, [databases, selectedDatabase, generateDiagram]);

  return (
    <div className="flex h-full flex-col">
      <ERToolbar rfInstance={rfInstance} />
      <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-1">
        <span className="text-xs text-muted-foreground">Database:</span>
        <select
          value={selectedDatabase || ''}
          onChange={(e) => generateDiagram(e.target.value)}
          className="rounded border border-border bg-muted px-2 py-0.5 text-xs"
        >
          {databases.map((db) => (
            <option key={db.name} value={db.name}>
              {db.name}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground">
          {erNodes.length} tables, {erEdges.length} relations
        </span>
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onInit={setRfInstance}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={() => 'hsl(var(--primary))'}
            maskColor="hsl(var(--background) / 0.7)"
            style={{ backgroundColor: 'hsl(var(--muted))' }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export function ERDiagramView() {
  return (
    <ReactFlowProvider>
      <ERDiagramInner />
    </ReactFlowProvider>
  );
}
```

**Step 5: Commit**

```bash
git add src/components/er-diagram/
git commit -m "feat: add interactive ER diagram with dagre auto-layout and React Flow"
```

---

## Task 9: Dashboard Store

**Files:**
- Create: `src/stores/dashboardStore.ts`

**Step 1: Create dashboard store**

Create `src/stores/dashboardStore.ts`:

```ts
import { create } from 'zustand';
import type { Layout } from 'react-grid-layout';

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'kpi' | 'table' | 'text';

export interface DashboardWidget {
  id: string;
  type: ChartType;
  title: string;
  sql: string;
  config: {
    xColumn?: string;
    yColumn?: string;
    groupBy?: string;
    colorColumn?: string;
    refreshInterval?: number; // ms, 0 = off
    kpiFormat?: string;
    kpiCompareColumn?: string;
  };
  result?: import('@/lib/types').QueryResult;
  loading?: boolean;
  error?: string;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  layout: Layout[];
  createdAt: number;
}

interface DashboardState {
  dashboards: Dashboard[];
  activeDashboardId: string | null;

  createDashboard: (name: string) => string;
  deleteDashboard: (id: string) => void;
  renameDashboard: (id: string, name: string) => void;
  setActiveDashboard: (id: string) => void;

  addWidget: (dashboardId: string, widget: Omit<DashboardWidget, 'id'>) => void;
  updateWidget: (dashboardId: string, widgetId: string, updates: Partial<DashboardWidget>) => void;
  removeWidget: (dashboardId: string, widgetId: string) => void;
  updateLayout: (dashboardId: string, layout: Layout[]) => void;

  executeWidgetQuery: (dashboardId: string, widgetId: string, connectionId: string) => Promise<void>;
  executeAllWidgets: (dashboardId: string, connectionId: string) => Promise<void>;
}

function loadDashboards(): Dashboard[] {
  try {
    const raw = localStorage.getItem('purrql:dashboards');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDashboards(dashboards: Dashboard[]) {
  localStorage.setItem('purrql:dashboards', JSON.stringify(
    dashboards.map((d) => ({
      ...d,
      widgets: d.widgets.map((w) => ({ ...w, result: undefined, loading: false, error: undefined })),
    })),
  ));
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  dashboards: loadDashboards(),
  activeDashboardId: null,

  createDashboard: (name) => {
    const id = crypto.randomUUID();
    const dashboard: Dashboard = { id, name, widgets: [], layout: [], createdAt: Date.now() };
    set((s) => {
      const dashboards = [...s.dashboards, dashboard];
      saveDashboards(dashboards);
      return { dashboards, activeDashboardId: id };
    });
    return id;
  },

  deleteDashboard: (id) => {
    set((s) => {
      const dashboards = s.dashboards.filter((d) => d.id !== id);
      saveDashboards(dashboards);
      return {
        dashboards,
        activeDashboardId: s.activeDashboardId === id ? null : s.activeDashboardId,
      };
    });
  },

  renameDashboard: (id, name) => {
    set((s) => {
      const dashboards = s.dashboards.map((d) => (d.id === id ? { ...d, name } : d));
      saveDashboards(dashboards);
      return { dashboards };
    });
  },

  setActiveDashboard: (id) => set({ activeDashboardId: id }),

  addWidget: (dashboardId, widget) => {
    const id = crypto.randomUUID();
    set((s) => {
      const dashboards = s.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        const newWidget = { ...widget, id };
        const layoutItem: Layout = {
          i: id,
          x: (d.widgets.length % 2) * 6,
          y: Math.floor(d.widgets.length / 2) * 4,
          w: 6,
          h: 4,
          minW: 3,
          minH: 2,
        };
        return {
          ...d,
          widgets: [...d.widgets, newWidget],
          layout: [...d.layout, layoutItem],
        };
      });
      saveDashboards(dashboards);
      return { dashboards };
    });
  },

  updateWidget: (dashboardId, widgetId, updates) => {
    set((s) => {
      const dashboards = s.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        return {
          ...d,
          widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, ...updates } : w)),
        };
      });
      saveDashboards(dashboards);
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
      saveDashboards(dashboards);
      return { dashboards };
    });
  },

  updateLayout: (dashboardId, layout) => {
    set((s) => {
      const dashboards = s.dashboards.map((d) =>
        d.id === dashboardId ? { ...d, layout } : d,
      );
      saveDashboards(dashboards);
      return { dashboards };
    });
  },

  executeWidgetQuery: async (dashboardId, widgetId, connectionId) => {
    const { ipc } = await import('@/lib/ipc');
    const dashboard = get().dashboards.find((d) => d.id === dashboardId);
    const widget = dashboard?.widgets.find((w) => w.id === widgetId);
    if (!widget?.sql) return;

    get().updateWidget(dashboardId, widgetId, { loading: true, error: undefined });

    try {
      const result = await ipc.executeQuery(connectionId, widget.sql);
      get().updateWidget(dashboardId, widgetId, { result, loading: false });
    } catch (e) {
      get().updateWidget(dashboardId, widgetId, { error: String(e), loading: false });
    }
  },

  executeAllWidgets: async (dashboardId, connectionId) => {
    const dashboard = get().dashboards.find((d) => d.id === dashboardId);
    if (!dashboard) return;
    await Promise.all(
      dashboard.widgets.map((w) => get().executeWidgetQuery(dashboardId, w.id, connectionId)),
    );
  },
}));
```

**Step 2: Commit**

```bash
git add src/stores/dashboardStore.ts
git commit -m "feat: add dashboard store with widget management and query execution"
```

---

## Task 10: Dashboard Chart Widgets

**Files:**
- Create: `src/components/dashboard/charts/BarChartWidget.tsx`
- Create: `src/components/dashboard/charts/LineChartWidget.tsx`
- Create: `src/components/dashboard/charts/PieChartWidget.tsx`
- Create: `src/components/dashboard/charts/AreaChartWidget.tsx`
- Create: `src/components/dashboard/charts/ScatterWidget.tsx`
- Create: `src/components/dashboard/charts/KPICard.tsx`
- Create: `src/components/dashboard/charts/DataTableWidget.tsx`

Each chart widget receives a `QueryResult` + `config` (xColumn, yColumn, etc.) and renders the appropriate recharts component. Use the theme's chart colors (`--chart-1` through `--chart-5`).

Example for BarChartWidget:

```tsx
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { QueryResult } from '@/lib/types';
import { cellToString } from '@/lib/utils';

interface Props {
  result: QueryResult;
  xColumn?: string;
  yColumn?: string;
  groupBy?: string;
}

export function BarChartWidget({ result, xColumn, yColumn }: Props) {
  const xIdx = result.columns.findIndex((c) => c.name === xColumn);
  const yIdx = result.columns.findIndex((c) => c.name === yColumn);
  if (xIdx === -1 || yIdx === -1) return <p className="text-xs text-muted-foreground p-4">Configure X and Y columns</p>;

  const data = result.rows.map((row) => ({
    x: cellToString(row.cells[xIdx]),
    y: Number(cellToString(row.cells[yIdx])) || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="x" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Bar dataKey="y" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

Follow the same pattern for Line, Area, Pie, Scatter. KPICard shows a single large number with optional % change. DataTableWidget renders a mini table.

**Step: Commit**

```bash
git add src/components/dashboard/charts/
git commit -m "feat: add dashboard chart widgets (bar, line, pie, area, scatter, KPI, table)"
```

---

## Task 11: Dashboard View & Widget Config

**Files:**
- Create: `src/components/dashboard/DashboardView.tsx`
- Create: `src/components/dashboard/DashboardManager.tsx`
- Create: `src/components/dashboard/WidgetCard.tsx`
- Create: `src/components/dashboard/WidgetConfigDialog.tsx`

**DashboardView**: Main container using `react-grid-layout` (GridLayout). Maps widgets to WidgetCards in the grid. Toolbar with "Add Widget" button, dashboard name, refresh all.

**DashboardManager**: Sidebar/popover for selecting dashboard (dropdown), create new, delete, rename.

**WidgetCard**: Wrapper for each widget in the grid. Header with title, refresh button, edit button, delete button. Body renders the appropriate chart component based on widget.type.

**WidgetConfigDialog**: Dialog for creating/editing a widget. Fields: title, chart type selector, SQL query (Monaco mini-editor), column mapping dropdowns (populated after running the query), refresh interval.

**Step: Commit**

```bash
git add src/components/dashboard/
git commit -m "feat: add dashboard view with drag-and-drop grid layout and widget configuration"
```

---

## Task 12: Extend Tab System for New Views

**Files:**
- Modify: `src/stores/queryStore.ts` (extend TabViewMode)
- Modify: `src/components/layout/PanelLayout.tsx` (render new views)
- Modify: `src/components/editor/EditorTabs.tsx` (tab icons for different types)
- Modify: `src/components/layout/CommandPalette.tsx` (add new commands)

**Step 1: Extend TabViewMode**

In `src/stores/queryStore.ts`, change:
```ts
export type TabViewMode = 'data' | 'structure';
```
to:
```ts
export type TabViewMode = 'data' | 'structure' | 'er-diagram' | 'dashboard' | 'explain' | 'diff' | 'health';
```

**Step 2: Update PanelLayout to render new views**

In `src/components/layout/PanelLayout.tsx`, add imports for `ERDiagramView`, `DashboardView`, `ExplainView`, `DataDiffView`, `HealthDashboard` and add conditional rendering based on `activeTab.viewMode`.

Add lazy imports:
```tsx
import { lazy, Suspense } from 'react';
const ERDiagramView = lazy(() => import('@/components/er-diagram/ERDiagramView').then(m => ({ default: m.ERDiagramView })));
const DashboardView = lazy(() => import('@/components/dashboard/DashboardView').then(m => ({ default: m.DashboardView })));
```

In the render function, before the existing editor/grid rendering, add:
```tsx
if (activeTab.viewMode === 'er-diagram') {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center">Loading...</div>}>
      <ERDiagramView />
    </Suspense>
  );
}
if (activeTab.viewMode === 'dashboard') {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center">Loading...</div>}>
      <DashboardView />
    </Suspense>
  );
}
```

**Step 3: Add tab icons**

In `EditorTabs.tsx`, add icons next to tab titles based on viewMode (GitBranch for ER, LayoutDashboard for dashboard, etc.).

**Step 4: Add commands to CommandPalette**

Add entries for "Open ER Diagram", "New Dashboard", "Database Health" to the command palette.

**Step 5: Add keyboard shortcuts**

In `AppLayout.tsx`, add shortcuts to open ER diagram and dashboard tabs.

**Step 6: Commit**

```bash
git add src/stores/queryStore.ts src/components/layout/PanelLayout.tsx src/components/editor/EditorTabs.tsx src/components/layout/CommandPalette.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: extend tab system with ER diagram, dashboard, and health monitor views"
```

---

## Task 13: Query Performance Profiler

**Files:**
- Create: `src/components/profiler/ExplainView.tsx`
- Create: `src/components/profiler/PlanNodeCard.tsx`

**ExplainView**: Runs `EXPLAIN ANALYZE` on the current query, parses the output into a tree, renders PlanNodeCards. Color codes by cost (green < 1ms, yellow < 100ms, red > 100ms). Shows total execution time, rows scanned vs returned.

**PlanNodeCard**: Shows node type, table, rows, cost, time. Indented tree view. Click to expand details.

Integration: Add "Explain" button to EditorToolbar that creates a new tab with viewMode='explain'.

**Step: Commit**

```bash
git add src/components/profiler/
git commit -m "feat: add query performance profiler with visual EXPLAIN ANALYZE"
```

---

## Task 14: Data Diff / Compare

**Files:**
- Create: `src/components/diff/DataDiffView.tsx`
- Create: `src/components/diff/DiffCell.tsx`

**DataDiffView**: Side-by-side comparison of two query results. User selects two result sets (from tabs or runs two queries). Rows are aligned by primary key or row index. DiffCells highlight: green for added, red for removed, yellow for changed.

**DiffCell**: Shows old value vs new value with color coding.

Integration: Command palette → "Compare Results" opens a diff tab.

**Step: Commit**

```bash
git add src/components/diff/
git commit -m "feat: add data diff view for comparing query results"
```

---

## Task 15: Smart Snippets

**Files:**
- Create: `src/stores/snippetStore.ts`
- Create: `src/components/snippets/SnippetPalette.tsx`
- Create: `src/components/snippets/SnippetEditor.tsx`

**snippetStore.ts**: Stores snippets in localStorage. Each snippet has: id, name, sql (with $variables), tags, createdAt.

**SnippetPalette** (`Ctrl+Shift+I`): Quick-insert palette similar to OpenAnything. Fuzzy search snippets. Click to insert (replaces $variables with prompted values).

**SnippetEditor**: Create/edit snippet with name, SQL content, variable definitions.

Integration: Add to command palette and keyboard shortcuts.

**Step: Commit**

```bash
git add src/stores/snippetStore.ts src/components/snippets/
git commit -m "feat: add smart SQL snippets with variables and quick-insert palette"
```

---

## Task 16: Query Versioning

**Files:**
- Modify: `src/stores/queryStore.ts` (add version tracking)
- Create: `src/components/editor/QueryTimeline.tsx`

**Query versioning**: Each time a query is executed, save a version snapshot (sql + timestamp + result summary). Store in queryStore per tab as `versions: Array<{sql, timestamp, rowCount}>`.

**QueryTimeline**: Expandable panel below the editor showing version history. Click to restore a version. Visual diff between versions.

**Step: Commit**

```bash
git add src/stores/queryStore.ts src/components/editor/QueryTimeline.tsx
git commit -m "feat: add query versioning with timeline and restore"
```

---

## Task 17: Data Masking

**Files:**
- Create: `src/lib/dataMasking.ts`
- Create: `src/components/masking/MaskingToggle.tsx`

**dataMasking.ts**: Utility that detects sensitive columns by name patterns (email, phone, ssn, credit_card, password, secret, token) and masks values (john@email.com → j***@e***.com, 555-1234 → ***-1234).

**MaskingToggle**: Per-column toggle in DataGrid header. Global "Production Safe" toggle in toolbar that auto-masks all detected sensitive columns.

Integration: Add masking state to a simple store or within filterStore. DataGrid reads masking state to transform displayed values.

**Step: Commit**

```bash
git add src/lib/dataMasking.ts src/components/masking/
git commit -m "feat: add data masking with auto-detection of sensitive columns"
```

---

## Task 18: Database Health Monitor

**Files:**
- Create: `src/components/health/HealthDashboard.tsx`
- Create: `src/components/health/ActiveConnections.tsx`
- Create: `src/components/health/SlowQueryList.tsx`
- Create: `src/components/health/StorageOverview.tsx`

**HealthDashboard**: Special tab that polls DB metrics. Uses `SHOW PROCESSLIST` (MySQL) or `pg_stat_activity` (Postgres) for active connections. Uses `SHOW TABLE STATUS` or `pg_stat_user_tables` for storage. Shows slow queries from `performance_schema` or `pg_stat_statements`.

Each sub-component renders a card with the metric. Auto-refreshes every 5 seconds.

Integration: Opens as a tab via command palette → "Database Health".

**Step: Commit**

```bash
git add src/components/health/
git commit -m "feat: add database health monitor with connections, slow queries, and storage"
```

---

## Task 19: React Flow CSS Import Fix

**Files:**
- Modify: `src/styles/globals.css` or `src/App.tsx`

React Flow requires its CSS. Ensure `@xyflow/react/dist/style.css` is imported. Also add `react-grid-layout/css/styles.css` and `react-resizable/css/styles.css` for the dashboard.

**Step: Commit**

```bash
git add src/styles/ src/App.tsx
git commit -m "fix: add CSS imports for React Flow and react-grid-layout"
```

---

## Task 20: Integration Testing & Polish

**Step 1: Build check**

Run:
```bash
cd /c/Users/devdy/Documents/GitHub/dbdd/apps/desktop
npm run build:frontend
```

Fix any TypeScript errors.

**Step 2: Fix all compilation errors**

Iterate on any type errors, missing imports, or incompatible APIs.

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: resolve all TypeScript errors and polish integration"
```

---

## Execution Order (Parallel Groups)

Tasks can be parallelized in these groups:

**Group A (Foundation):** Task 1 (deps), Task 19 (CSS)
**Group B (AI - independent):** Tasks 2, 3, 4, 5, 6
**Group C (ER Diagram - independent):** Tasks 7, 8
**Group D (Dashboard - independent):** Tasks 9, 10, 11
**Group E (Smaller features - independent):** Tasks 13, 14, 15, 16, 17, 18
**Group F (Integration):** Task 12 (depends on B, C, D, E), Task 20 (depends on all)

Within each group, tasks are sequential. Groups B, C, D, E can run in parallel after Group A completes.
