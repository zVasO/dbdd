import { useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import type { ConnectionConfig, DatabaseType } from '@/lib/types';
import { parseConnectionUrl } from '@/lib/connectionUrl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Cyan', value: '#06b6d4' },
];

const ENVIRONMENTS = [
  { value: 'local', label: 'Local', color: 'bg-green-500' },
  { value: 'development', label: 'Development', color: 'bg-blue-500' },
  { value: 'testing', label: 'Testing', color: 'bg-yellow-500' },
  { value: 'staging', label: 'Staging', color: 'bg-orange-500' },
  { value: 'production', label: 'Production', color: 'bg-red-500' },
] as const;

interface Props {
  onCancel: () => void;
}

export function ConnectionForm({ onCancel }: Props) {
  const { connect, testConnection, connecting, error } = useConnectionStore();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<ConnectionConfig['environment']>(null);

  const [urlInput, setUrlInput] = useState('');

  const [form, setForm] = useState({
    name: '',
    db_type: 'mysql' as DatabaseType,
    host: 'localhost',
    port: 3306,
    username: 'root',
    password: '',
    database: '',
  });

  const handleChange = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === 'db_type') {
      const ports: Record<string, number> = { mysql: 3306, postgres: 5432, sqlite: 0, mongodb: 27017 };
      setForm((prev) => ({ ...prev, port: ports[value as string] || 3306 }));
    }
  };

  const handleUrlImport = () => {
    const parsed = parseConnectionUrl(urlInput);
    if (!parsed) return;
    setForm((prev) => ({
      ...prev,
      db_type: parsed.db_type,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      database: parsed.database,
      // Auto-set name if empty
      name: prev.name || `${parsed.host}/${parsed.database}`,
    }));
    setUrlInput('');
  };

  const buildConfig = (): ConnectionConfig => ({
    id: crypto.randomUUID(),
    name: form.name,
    db_type: form.db_type,
    host: form.host,
    port: form.port,
    username: form.username,
    database: form.database || null,
    ssl_mode: 'disable',
    ssh_tunnel: null,
    color: color,
    environment: environment,
    pool_size: null,
    query_timeout_ms: null,
  });

  const handleTest = async () => {
    setTestResult(null);
    try {
      const version = await testConnection(buildConfig(), form.password || undefined);
      setTestResult(`Connected! Server: ${version}`);
    } catch (e) {
      setTestResult(`Failed: ${e}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await connect(buildConfig(), form.password || undefined);
      onCancel(); // Close form after successful connection
    } catch {
      // error handled by store
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Import from URL</label>
        <div className="flex gap-2">
          <Input
            placeholder="postgres://user:pass@host:5432/db"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="text-xs font-mono"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUrlImport}
            disabled={!urlInput.trim()}
          >
            Import
          </Button>
        </div>
      </div>
      <Separator className="my-2" />
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="conn-name">Connection Name</Label>
          <Input
            id="conn-name"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="My Database"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="db-type">Database Type</Label>
          <Select
            value={form.db_type}
            onValueChange={(value) => handleChange('db_type', value)}
          >
            <SelectTrigger id="db-type" className="w-full">
              <SelectValue placeholder="Select a database type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mysql">MySQL</SelectItem>
              <SelectItem value="postgres">PostgreSQL</SelectItem>
              <SelectItem value="sqlite">SQLite</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Color</label>
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setColor(c.value)}
                className={cn(
                  'h-5 w-5 rounded-full border-2 transition-transform hover:scale-110',
                  color === c.value ? 'border-foreground scale-110' : 'border-transparent'
                )}
                style={{ backgroundColor: c.value }}
                title={c.name}
              />
            ))}
            {color && (
              <button
                type="button"
                onClick={() => setColor(null)}
                className="h-5 w-5 rounded-full border border-dashed border-muted-foreground flex items-center justify-center"
                title="Clear color"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Environment</label>
          <div className="flex gap-1.5">
            {ENVIRONMENTS.map((env) => (
              <button
                key={env.value}
                type="button"
                onClick={() => setEnvironment(environment === env.value ? null : env.value)}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors',
                  environment === env.value
                    ? `${env.color} text-white`
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {env.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="host">Host</Label>
          <Input
            id="host"
            value={form.host}
            onChange={(e) => handleChange('host', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="port">Port</Label>
          <Input
            id="port"
            type="number"
            value={form.port}
            onChange={(e) => handleChange('port', parseInt(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            value={form.username}
            onChange={(e) => handleChange('username', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={form.password}
            onChange={(e) => handleChange('password', e.target.value)}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="database">Database</Label>
          <Input
            id="database"
            value={form.database}
            onChange={(e) => handleChange('database', e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      {testResult && (
        <p className={`text-sm ${testResult.startsWith('Connected') ? 'text-primary' : 'text-destructive'}`}>
          {testResult}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={connecting}>
          {connecting ? 'Connecting...' : 'Connect'}
        </Button>
        <Button type="button" variant="outline" onClick={handleTest}>
          Test Connection
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
