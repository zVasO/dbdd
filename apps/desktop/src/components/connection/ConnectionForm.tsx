import { useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import type { ConnectionConfig, DatabaseType, SslMode, SshTunnelConfig, SshAuthMethod } from '@/lib/types';
import { parseConnectionUrl } from '@/lib/connectionUrl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { X, ChevronRight, Shield, Globe } from 'lucide-react';
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
  const [sslMode, setSslMode] = useState<SslMode>('disable');
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshForm, setSshForm] = useState({
    host: '',
    port: 22,
    username: '',
    authMethod: 'Password' as 'Password' | 'PrivateKey' | 'Agent',
    keyPath: '',
    sshPassword: '',
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  const applyParsedUrl = (value: string, keepUrl = false) => {
    const parsed = parseConnectionUrl(value);
    if (!parsed) return false;
    setForm((prev) => ({
      ...prev,
      db_type: parsed.db_type,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      database: parsed.database,
      name: prev.name || `${parsed.host}/${parsed.database}`,
    }));
    if (!keepUrl) setUrlInput('');
    return true;
  };

  const handleUrlImport = () => {
    applyParsedUrl(urlInput);
  };

  const handleUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').trim();
    if (applyParsedUrl(pasted, true)) {
      e.preventDefault();
      setUrlInput(pasted);
    }
  };

  const buildSshTunnel = (): SshTunnelConfig | null => {
    if (!sshEnabled) return null;
    let auth_method: SshAuthMethod;
    if (sshForm.authMethod === 'PrivateKey') {
      auth_method = { type: 'PrivateKey', key_path: sshForm.keyPath };
    } else if (sshForm.authMethod === 'Agent') {
      auth_method = { type: 'Agent' };
    } else {
      auth_method = { type: 'Password' };
    }
    return {
      host: sshForm.host,
      port: sshForm.port,
      username: sshForm.username,
      auth_method,
    };
  };

  const buildConfig = (): ConnectionConfig => ({
    id: crypto.randomUUID(),
    name: form.name,
    db_type: form.db_type,
    host: form.host,
    port: form.port,
    username: form.username,
    database: form.database || null,
    ssl_mode: sslMode,
    ssh_tunnel: buildSshTunnel(),
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
        <Label>Import from URL</Label>
        <div className="flex gap-2">
          <Input
            placeholder="postgres://user:pass@host:5432/db"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onPaste={handleUrlPaste}
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
          <Label>Color</Label>
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setColor(c.value)}
                className={cn(
                  'h-5 w-5 cursor-pointer rounded-full border-2 transition-transform hover:scale-110',
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
                className="h-5 w-5 cursor-pointer rounded-full border border-dashed border-muted-foreground flex items-center justify-center"
                title="Clear color"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Environment</Label>
          <div className="flex gap-1.5">
            {ENVIRONMENTS.map((env) => (
              <button
                key={env.value}
                type="button"
                onClick={() => setEnvironment(environment === env.value ? null : env.value)}
                className={cn(
                  'cursor-pointer rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors',
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

      {/* Advanced: SSL & SSH */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-1">
          <ChevronRight className={cn('h-3 w-3 transition-transform', advancedOpen && 'rotate-90')} />
          Advanced Settings
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-4 rounded-md border border-border p-3">
            {/* SSL */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Shield className="h-3 w-3" />
                SSL / TLS
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>SSL Mode</Label>
                  <Select value={sslMode} onValueChange={(v) => setSslMode(v as SslMode)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disable">Disabled</SelectItem>
                      <SelectItem value="prefer">Prefer</SelectItem>
                      <SelectItem value="require">Require</SelectItem>
                      <SelectItem value="verify_ca">Verify CA</SelectItem>
                      <SelectItem value="verify_full">Verify Full</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* SSH Tunnel */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Globe className="h-3 w-3" />
                  SSH Tunnel
                </div>
                <button
                  type="button"
                  onClick={() => setSshEnabled(!sshEnabled)}
                  className={cn(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                    sshEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                      sshEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    )}
                  />
                </button>
              </div>
              {sshEnabled && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>SSH Host</Label>
                    <Input
                      value={sshForm.host}
                      onChange={(e) => setSshForm((p) => ({ ...p, host: e.target.value }))}
                      placeholder="ssh.example.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>SSH Port</Label>
                    <Input
                      type="number"
                      value={sshForm.port}
                      onChange={(e) => setSshForm((p) => ({ ...p, port: parseInt(e.target.value) || 22 }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>SSH Username</Label>
                    <Input
                      value={sshForm.username}
                      onChange={(e) => setSshForm((p) => ({ ...p, username: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Auth Method</Label>
                    <Select
                      value={sshForm.authMethod}
                      onValueChange={(v) => setSshForm((p) => ({ ...p, authMethod: v as typeof p.authMethod }))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Password">Password</SelectItem>
                        <SelectItem value="PrivateKey">Private Key</SelectItem>
                        <SelectItem value="Agent">SSH Agent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {sshForm.authMethod === 'PrivateKey' && (
                    <div className="col-span-2 space-y-1.5">
                      <Label>Private Key Path</Label>
                      <Input
                        value={sshForm.keyPath}
                        onChange={(e) => setSshForm((p) => ({ ...p, keyPath: e.target.value }))}
                        placeholder="~/.ssh/id_rsa"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

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
