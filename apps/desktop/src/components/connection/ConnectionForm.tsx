import { useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import type { ConnectionConfig, DatabaseType } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

interface Props {
  onCancel: () => void;
}

export function ConnectionForm({ onCancel }: Props) {
  const { connect, testConnection, connecting, error } = useConnectionStore();
  const [testResult, setTestResult] = useState<string | null>(null);

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
    color: null,
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
    } catch {
      // error handled by store
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
