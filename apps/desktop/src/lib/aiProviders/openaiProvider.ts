import type { AIProvider, AIMessage, AIProviderConfig, AIStreamCallbacks } from './types';

const DEFAULT_BASE_URL = 'https://api.openai.com';

interface OpenAIChoice {
  message?: { content: string | null };
  delta?: { content?: string };
  finish_reason: string | null;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
}

interface OpenAIModel {
  id: string;
}

interface OpenAIModelsResponse {
  data: OpenAIModel[];
}

function getBaseUrl(config: AIProviderConfig): string {
  const base = config.baseUrl?.replace(/\/+$/, '') ?? DEFAULT_BASE_URL;
  return base;
}

function buildBody(
  messages: AIMessage[],
  config: AIProviderConfig,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model ?? 'gpt-4o',
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream,
  };

  if (config.temperature !== undefined) {
    body.temperature = config.temperature;
  }

  if (config.maxTokens !== undefined) {
    body.max_tokens = config.maxTokens;
  }

  return body;
}

async function sendStreaming(
  messages: AIMessage[],
  config: AIProviderConfig,
  callbacks: AIStreamCallbacks,
): Promise<string> {
  const baseUrl = getBaseUrl(config);
  const body = buildBody(messages, config, true);

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey ?? ''}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message ?? errorText;
    } catch {
      errorMessage = errorText;
    }
    callbacks.onError(`OpenAI API error (${response.status}): ${errorMessage}`);
    throw new Error(`OpenAI API error (${response.status}): ${errorMessage}`);
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
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const event: OpenAIResponse = JSON.parse(data);
          const delta = event.choices?.[0]?.delta;
          if (delta?.content) {
            fullText += delta.content;
            callbacks.onToken(delta.content);
          }
        } catch {
          // Skip malformed JSON lines
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
  const body = buildBody(messages, config, false);

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey ?? ''}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message ?? errorText;
    } catch {
      errorMessage = errorText;
    }
    throw new Error(`OpenAI API error (${response.status}): ${errorMessage}`);
  }

  const result: OpenAIResponse = await response.json();
  return result.choices?.[0]?.message?.content ?? '';
}

export const openaiProvider: AIProvider = {
  name: 'OpenAI',
  type: 'openai',

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

    const response = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey ?? ''}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list models (${response.status})`);
    }

    const result: OpenAIModelsResponse = await response.json();
    return result.data
      .map((m) => m.id)
      .filter((id) => id.startsWith('gpt-') || id.startsWith('o'))
      .sort();
  },
};
