import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAIStore } from '@/stores/aiStore';
import { getProvider, DEFAULT_MODELS } from '@/lib/aiProviders';
import type { AIProviderType } from '@/lib/aiProviders';

const PROVIDERS: { value: AIProviderType; label: string; description: string }[] = [
  { value: 'claude', label: 'Claude', description: 'Anthropic Claude API' },
  { value: 'openai', label: 'OpenAI', description: 'OpenAI ChatGPT API' },
  { value: 'ollama', label: 'Ollama', description: 'Local Ollama models' },
];

const PRESET_MODELS: Record<AIProviderType, string[]> = {
  claude: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-haiku-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o3-mini',
  ],
  ollama: [
    'llama3',
    'llama3.1',
    'llama3.2',
    'codellama',
    'mistral',
    'mixtral',
    'deepseek-coder-v2',
    'qwen2.5-coder',
    'phi3',
    'gemma2',
  ],
};

function ApiKeyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-9"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1.5 top-1/2 -translate-y-1/2"
        onClick={() => setVisible(!visible)}
        tabIndex={-1}
      >
        {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </Button>
    </div>
  );
}

export function AiProviderConfig() {
  const providerType = useAIStore((s) => s.providerType);
  const apiKeys = useAIStore((s) => s.apiKeys);
  const ollamaUrl = useAIStore((s) => s.ollamaUrl);
  const model = useAIStore((s) => s.model);
  const streaming = useAIStore((s) => s.streaming);
  const temperature = useAIStore((s) => s.temperature);

  const setProvider = useAIStore((s) => s.setProvider);
  const setApiKey = useAIStore((s) => s.setApiKey);
  const setOllamaUrl = useAIStore((s) => s.setOllamaUrl);
  const setModel = useAIStore((s) => s.setModel);
  const setStreaming = useAIStore((s) => s.setStreaming);
  const setTemperature = useAIStore((s) => s.setTemperature);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchModels = useCallback(async () => {
    const provider = getProvider(providerType);
    if (!provider.listModels) return;

    setLoadingModels(true);
    try {
      const config = {
        type: providerType,
        apiKey: apiKeys[providerType],
        baseUrl: providerType === 'ollama' ? ollamaUrl : undefined,
      };
      const models = await provider.listModels(config);
      setAvailableModels(models);
    } catch {
      setAvailableModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, [providerType, apiKeys, ollamaUrl]);

  // Reset available models when provider changes
  useEffect(() => {
    setAvailableModels([]);
  }, [providerType]);

  const modelOptions =
    availableModels.length > 0
      ? availableModels
      : PRESET_MODELS[providerType] ?? [];

  const currentProvider = PROVIDERS.find((p) => p.value === providerType);
  const hasListModels = providerType === 'openai' || providerType === 'ollama';

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <div className="space-y-2">
        <Label>AI Provider</Label>
        <div className="grid grid-cols-3 gap-2">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.value}
              onClick={() => setProvider(provider.value)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md border p-3 text-center transition-colors',
                providerType === provider.value
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span className="text-sm font-medium">{provider.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {provider.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* API Key - Claude */}
      {providerType === 'claude' && (
        <div className="space-y-2">
          <Label htmlFor="claude-api-key">Anthropic API Key</Label>
          <ApiKeyInput
            value={apiKeys.claude}
            onChange={(value) => setApiKey('claude', value)}
            placeholder="sk-ant-..."
          />
          <p className="text-[11px] text-muted-foreground">
            Get your API key from{' '}
            <span className="text-primary">console.anthropic.com</span>
          </p>
        </div>
      )}

      {/* API Key - OpenAI */}
      {providerType === 'openai' && (
        <div className="space-y-2">
          <Label htmlFor="openai-api-key">OpenAI API Key</Label>
          <ApiKeyInput
            value={apiKeys.openai}
            onChange={(value) => setApiKey('openai', value)}
            placeholder="sk-..."
          />
          <p className="text-[11px] text-muted-foreground">
            Get your API key from{' '}
            <span className="text-primary">platform.openai.com</span>
          </p>
        </div>
      )}

      {/* Ollama URL */}
      {providerType === 'ollama' && (
        <div className="space-y-2">
          <Label htmlFor="ollama-url">Ollama Server URL</Label>
          <Input
            id="ollama-url"
            value={ollamaUrl}
            onChange={(e) => setOllamaUrl(e.target.value)}
            placeholder="http://localhost:11434"
          />
          <p className="text-[11px] text-muted-foreground">
            Make sure Ollama is running locally with your preferred model pulled
          </p>
        </div>
      )}

      {/* Model Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Model</Label>
          {hasListModels && (
            <Button
              variant="ghost"
              size="xs"
              onClick={fetchModels}
              disabled={loadingModels}
              className="gap-1"
            >
              <RefreshCw
                className={cn('size-3', loadingModels && 'animate-spin')}
              />
              {loadingModels ? 'Loading...' : 'Fetch models'}
            </Button>
          )}
        </div>
        <Select
          value={model[providerType]}
          onValueChange={(value) => setModel(providerType, value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
                {m === DEFAULT_MODELS[providerType] && (
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    (default)
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Streaming Toggle */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <Label>Streaming</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Show responses as they are generated
            </p>
          </div>
          <button
            role="switch"
            aria-checked={streaming}
            onClick={() => setStreaming(!streaming)}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              streaming ? 'bg-primary' : 'bg-input',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
                streaming ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </div>

      {/* Temperature Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Temperature</Label>
          <span className="text-xs text-muted-foreground font-mono">
            {temperature.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={temperature}
          onChange={(e) => setTemperature(parseFloat(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Precise</span>
          <span>Creative</span>
        </div>
      </div>
    </div>
  );
}
