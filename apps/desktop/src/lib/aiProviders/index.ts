export type {
  AIProviderType,
  AIMessage,
  AIProviderConfig,
  AIStreamCallbacks,
  AIProvider,
} from './types';
export { DEFAULT_MODELS } from './types';

import type { AIProvider, AIProviderType } from './types';
import { claudeProvider } from './claudeProvider';
import { openaiProvider } from './openaiProvider';
import { ollamaProvider } from './ollamaProvider';

const providers: Record<AIProviderType, AIProvider> = {
  claude: claudeProvider,
  openai: openaiProvider,
  ollama: ollamaProvider,
};

export function getProvider(type: AIProviderType): AIProvider {
  const provider = providers[type];
  if (!provider) {
    throw new Error(`Unknown AI provider: ${type}`);
  }
  return provider;
}
