import type { AIProvider, AIMessage, AIProviderConfig, AIStreamCallbacks } from './types';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

interface ClaudeContentBlock {
  type: string;
  text?: string;
}

interface ClaudeResponse {
  content: ClaudeContentBlock[];
  stop_reason: string;
}

function buildClaudeBody(
  messages: AIMessage[],
  config: AIProviderConfig,
  stream: boolean,
): { system?: string; messages: Array<{ role: string; content: string }>; body: Record<string, unknown> } {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const system = systemMessages.length > 0
    ? systemMessages.map((m) => m.content).join('\n\n')
    : undefined;

  const formattedMessages = chatMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const body: Record<string, unknown> = {
    model: config.model ?? 'claude-sonnet-4-20250514',
    max_tokens: config.maxTokens ?? 4096,
    stream,
    messages: formattedMessages,
  };

  if (system) {
    body.system = system;
  }

  if (config.temperature !== undefined) {
    body.temperature = config.temperature;
  }

  return { system, messages: formattedMessages, body };
}

async function sendStreaming(
  messages: AIMessage[],
  config: AIProviderConfig,
  callbacks: AIStreamCallbacks,
): Promise<string> {
  const { body } = buildClaudeBody(messages, config, true);

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
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
    callbacks.onError(`Claude API error (${response.status}): ${errorMessage}`);
    throw new Error(`Claude API error (${response.status}): ${errorMessage}`);
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
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);

          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const token = event.delta.text;
            fullText += token;
            callbacks.onToken(token);
          } else if (event.type === 'message_stop') {
            // Stream complete
          } else if (event.type === 'error') {
            callbacks.onError(event.error?.message ?? 'Unknown streaming error');
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
  const { body } = buildClaudeBody(messages, config, false);

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
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
    throw new Error(`Claude API error (${response.status}): ${errorMessage}`);
  }

  const result: ClaudeResponse = await response.json();
  const textBlocks = result.content.filter((b) => b.type === 'text');
  return textBlocks.map((b) => b.text ?? '').join('');
}

export const claudeProvider: AIProvider = {
  name: 'Claude',
  type: 'claude',

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
};
