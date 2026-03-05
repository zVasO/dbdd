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
