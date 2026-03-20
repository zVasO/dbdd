import { create } from 'zustand';
import { getProvider, DEFAULT_MODELS } from '@/lib/aiProviders';
import type { AIProviderType, AIMessage } from '@/lib/aiProviders';
import { useSchemaStore } from './schemaStore';
import { useConnectionStore } from './connectionStore';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  generating?: boolean;
}

interface AIConfig {
  providerType: AIProviderType;
  apiKeys: Record<AIProviderType, string>;
  ollamaUrl: string;
  model: Record<AIProviderType, string>;
  streaming: boolean;
  temperature: number;
}

const STORAGE_KEY = 'vasodb:ai-config';

const DEFAULT_CONFIG: AIConfig = {
  providerType: 'claude',
  apiKeys: { claude: '', openai: '', ollama: '' },
  ollamaUrl: 'http://localhost:11434',
  model: { ...DEFAULT_MODELS },
  streaming: true,
  temperature: 0.3,
};

function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...parsed.apiKeys },
      model: { ...DEFAULT_CONFIG.model, ...parsed.model },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config: AIConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function getConfigSnapshot(state: AIState): AIConfig {
  return {
    providerType: state.providerType,
    apiKeys: state.apiKeys,
    ollamaUrl: state.ollamaUrl,
    model: state.model,
    streaming: state.streaming,
    temperature: state.temperature,
  };
}

function buildSchemaContext(): string {
  const schema = useSchemaStore.getState();
  const connection = useConnectionStore.getState();
  const dbType = connection.activeConfig?.db_type ?? 'unknown';

  const parts: string[] = [
    `Database type: ${dbType}`,
  ];

  if (schema.databases.length > 0) {
    parts.push(`Available databases: ${schema.databases.map((d) => d.name).join(', ')}`);
  }

  const tableEntries = Object.entries(schema.tables);
  if (tableEntries.length > 0) {
    for (const [database, tables] of tableEntries) {
      if (tables.length === 0) continue;
      parts.push(`\nDatabase "${database}" tables:`);
      for (const table of tables) {
        const typeLabel = table.table_type !== 'Table' ? ` (${table.table_type})` : '';
        parts.push(`  - ${table.name}${typeLabel}`);
      }
    }
  }

  const structureEntries = Object.entries(schema.structures);
  if (structureEntries.length > 0) {
    parts.push('\nTable structures:');
    for (const [key, structure] of structureEntries) {
      const tableName = structure.table_ref.table;
      const columns = structure.columns
        .map((c) => {
          const pk = c.is_primary_key ? ' PK' : '';
          const nullable = c.nullable ? ' NULL' : ' NOT NULL';
          const def = c.default_value ? ` DEFAULT ${c.default_value}` : '';
          return `    ${c.name} ${c.data_type}${pk}${nullable}${def}`;
        })
        .join('\n');
      parts.push(`\n  ${key} (${tableName}):\n${columns}`);

      if (structure.foreign_keys.length > 0) {
        parts.push('    Foreign keys:');
        for (const fk of structure.foreign_keys) {
          const refTable = structure.table_ref.database
            ? `${fk.referenced_table.database ?? ''}.${fk.referenced_table.table}`
            : fk.referenced_table.table;
          parts.push(
            `      ${fk.columns.join(', ')} -> ${refTable}(${fk.referenced_columns.join(', ')})`,
          );
        }
      }

      if (structure.indexes.length > 0) {
        const nonPkIndexes = structure.indexes.filter((i) => !i.is_primary);
        if (nonPkIndexes.length > 0) {
          parts.push('    Indexes:');
          for (const idx of nonPkIndexes) {
            const unique = idx.is_unique ? ' UNIQUE' : '';
            parts.push(`      ${idx.name}${unique} (${idx.columns.join(', ')})`);
          }
        }
      }
    }
  }

  return parts.join('\n');
}

function buildSystemPrompt(): string {
  const schemaContext = buildSchemaContext();

  return `You are an expert SQL assistant integrated into VasOdb, a database management application. Your role is to help users write, understand, and optimize SQL queries.

When the user asks you to write SQL, always return the SQL inside a \`\`\`sql code block.

Current database context:
${schemaContext}

Guidelines:
- Write correct SQL for the specific database type shown above.
- Use proper table and column names from the schema context.
- When writing queries, prefer explicit column names over SELECT *.
- Provide brief explanations alongside SQL when helpful.
- If the schema context is empty, write generic SQL and mention that no schema information is available.
- Be concise but thorough in your responses.`;
}

interface AIState extends AIConfig {
  chatOpen: boolean;
  chatMessages: ChatMessage[];
  isGenerating: boolean;

  setChatOpen: (open: boolean) => void;
  setProvider: (provider: AIProviderType) => void;
  setApiKey: (provider: AIProviderType, key: string) => void;
  setOllamaUrl: (url: string) => void;
  setModel: (provider: AIProviderType, model: string) => void;
  setStreaming: (streaming: boolean) => void;
  setTemperature: (temperature: number) => void;
  sendChatMessage: (content: string) => Promise<void>;
  generateSQL: (prompt: string) => Promise<string>;
  explainQuery: (sql: string) => Promise<string>;
  optimizeQuery: (sql: string) => Promise<string>;
  clearChat: () => void;
}

export const useAIStore = create<AIState>((set, get) => {
  const initial = loadConfig();

  return {
    ...initial,
    chatOpen: false,
    chatMessages: [],
    isGenerating: false,

    setChatOpen: (open) => {
      set({ chatOpen: open });
    },

    setProvider: (provider) => {
      set({ providerType: provider });
      saveConfig(getConfigSnapshot({ ...get(), providerType: provider }));
    },

    setApiKey: (provider, key) => {
      const apiKeys = { ...get().apiKeys, [provider]: key };
      set({ apiKeys });
      saveConfig(getConfigSnapshot({ ...get(), apiKeys }));
    },

    setOllamaUrl: (url) => {
      set({ ollamaUrl: url });
      saveConfig(getConfigSnapshot({ ...get(), ollamaUrl: url }));
    },

    setModel: (provider, model) => {
      const models = { ...get().model, [provider]: model };
      set({ model: models });
      saveConfig(getConfigSnapshot({ ...get(), model: models }));
    },

    setStreaming: (streaming) => {
      set({ streaming });
      saveConfig(getConfigSnapshot({ ...get(), streaming }));
    },

    setTemperature: (temperature) => {
      set({ temperature });
      saveConfig(getConfigSnapshot({ ...get(), temperature }));
    },

    sendChatMessage: async (content) => {
      const state = get();
      if (state.isGenerating) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        generating: true,
      };

      set((s) => ({
        chatMessages: [...s.chatMessages, userMessage, assistantMessage],
        isGenerating: true,
      }));

      const systemPrompt = buildSystemPrompt();
      const history: AIMessage[] = [
        { role: 'system', content: systemPrompt },
      ];

      // Include recent chat history for context (last 20 messages)
      const recentMessages = [...get().chatMessages].slice(-22, -2);
      for (const msg of recentMessages) {
        history.push({ role: msg.role, content: msg.content });
      }

      history.push({ role: 'user', content });

      const provider = getProvider(state.providerType);
      const config = {
        type: state.providerType,
        apiKey: state.apiKeys[state.providerType],
        baseUrl: state.providerType === 'ollama' ? state.ollamaUrl : undefined,
        model: state.model[state.providerType],
        temperature: state.temperature,
        streaming: state.streaming,
      };

      try {
        if (state.streaming) {
          await provider.sendMessage(history, config, {
            onToken: (token) => {
              set((s) => ({
                chatMessages: s.chatMessages.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: m.content + token }
                    : m,
                ),
              }));
            },
            onDone: () => {
              set((s) => ({
                chatMessages: s.chatMessages.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, generating: false }
                    : m,
                ),
                isGenerating: false,
              }));
            },
            onError: (error) => {
              set((s) => ({
                chatMessages: s.chatMessages.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: `Error: ${error}`, generating: false }
                    : m,
                ),
                isGenerating: false,
              }));
            },
          });
        } else {
          const response = await provider.sendMessage(history, config);
          set((s) => ({
            chatMessages: s.chatMessages.map((m) =>
              m.id === assistantMessage.id
                ? { ...m, content: response, generating: false }
                : m,
            ),
            isGenerating: false,
          }));
        }
      } catch (error) {
        set((s) => ({
          chatMessages: s.chatMessages.map((m) =>
            m.id === assistantMessage.id
              ? {
                  ...m,
                  content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                  generating: false,
                }
              : m,
          ),
          isGenerating: false,
        }));
      }
    },

    generateSQL: async (prompt) => {
      const state = get();
      const systemPrompt = buildSystemPrompt();

      const messages: AIMessage[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Write a SQL query for the following request. Return ONLY the SQL query inside a \`\`\`sql code block, with no additional explanation:\n\n${prompt}`,
        },
      ];

      const provider = getProvider(state.providerType);
      const config = {
        type: state.providerType,
        apiKey: state.apiKeys[state.providerType],
        baseUrl: state.providerType === 'ollama' ? state.ollamaUrl : undefined,
        model: state.model[state.providerType],
        temperature: state.temperature,
        streaming: false,
      };

      const response = await provider.sendMessage(messages, config);

      // Extract SQL from code block if present
      const sqlMatch = response.match(/```sql\s*\n?([\s\S]*?)```/);
      if (sqlMatch) {
        return sqlMatch[1].trim();
      }

      // If no code block, try to extract just the SQL
      const cleanedResponse = response.trim();
      return cleanedResponse;
    },

    explainQuery: async (sql) => {
      const state = get();
      const systemPrompt = buildSystemPrompt();

      const messages: AIMessage[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Explain the following SQL query in detail. Break down what each part does, describe the joins, filtering, and expected results:\n\n\`\`\`sql\n${sql}\n\`\`\``,
        },
      ];

      const provider = getProvider(state.providerType);
      const config = {
        type: state.providerType,
        apiKey: state.apiKeys[state.providerType],
        baseUrl: state.providerType === 'ollama' ? state.ollamaUrl : undefined,
        model: state.model[state.providerType],
        temperature: state.temperature,
        streaming: false,
      };

      return provider.sendMessage(messages, config);
    },

    optimizeQuery: async (sql) => {
      const state = get();
      const systemPrompt = buildSystemPrompt();

      const messages: AIMessage[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Analyze the following SQL query for potential optimizations. Suggest improvements for performance, readability, and best practices. If you suggest a rewritten query, include it in a \`\`\`sql code block:\n\n\`\`\`sql\n${sql}\n\`\`\``,
        },
      ];

      const provider = getProvider(state.providerType);
      const config = {
        type: state.providerType,
        apiKey: state.apiKeys[state.providerType],
        baseUrl: state.providerType === 'ollama' ? state.ollamaUrl : undefined,
        model: state.model[state.providerType],
        temperature: state.temperature,
        streaming: false,
      };

      return provider.sendMessage(messages, config);
    },

    clearChat: () => {
      set({ chatMessages: [], isGenerating: false });
    },
  };
});
