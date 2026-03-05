import type { AIProvider, AIMessage, AIProviderConfig, AIStreamCallbacks } from './types';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

interface OllamaResponseChunk {
  message?: { content: string };
  done: boolean;
}

interface OllamaResponse {
  message: { content: string };
  done: boolean;
}

interface OllamaModel {
  name: string;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

function getBaseUrl(config: AIProviderConfig): string {
  return (config.baseUrl?.replace(/\/+$/, '') ?? DEFAULT_OLLAMA_URL);
}

async function sendStreaming(
  messages: AIMessage[],
  config: AIProviderConfig,
  callbacks: AIStreamCallbacks,
): Promise<string> {
  const baseUrl = getBaseUrl(config);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model ?? 'llama3',
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      options: {
        ...(config.temperature !== undefined && { temperature: config.temperature }),
        ...(config.maxTokens !== undefined && { num_predict: config.maxTokens }),
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    callbacks.onError(`Ollama error (${response.status}): ${errorText}`);
    throw new Error(`Ollama error (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError('No response body');
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const chunk: OllamaResponseChunk = JSON.parse(trimmed);
          if (chunk.message?.content) {
            fullText += chunk.message.content;
            callbacks.onToken(chunk.message.content);
          }
          if (chunk.done) {
            // Stream complete
          }
        } catch {
          // Skip malformed NDJSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  callbacks.onDone();
  return fullText;
}

async function sendNonStreaming(
  messages: AIMessage[],
  config: AIProviderConfig,
): Promise<string> {
  const baseUrl = getBaseUrl(config);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model ?? 'llama3',
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      options: {
        ...(config.temperature !== undefined && { temperature: config.temperature }),
        ...(config.maxTokens !== undefined && { num_predict: config.maxTokens }),
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error (${response.status}): ${errorText}`);
  }

  const result: OllamaResponse = await response.json();
  return result.message?.content ?? '';
}

export const ollamaProvider: AIProvider = {
  name: 'Ollama',
  type: 'ollama',

  async sendMessage(
    messages: AIMessage[],
    config: AIProviderConfig,
    callbacks?: AIStreamCallbacks,
  ): Promise<string> {
    if (callbacks && config.streaming !== false) {
      return sendStreaming(messages, config, callbacks);
    }
    return sendNonStreaming(messages, config);
  },

  async listModels(config: AIProviderConfig): Promise<string[]> {
    const baseUrl = getBaseUrl(config);

    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Failed to list Ollama models (${response.status})`);
    }

    const result: OllamaTagsResponse = await response.json();
    return result.models.map((m) => m.name).sort();
  },
};
