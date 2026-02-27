import { useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import type { ConnectionConfig, DatabaseType } from '@/lib/types';

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

  const inputStyle = {
    background: 'var(--color-bg-tertiary)',
    color: 'var(--color-text-primary)',
    borderColor: 'var(--color-border)',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Connection Name
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            style={inputStyle}
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="My Database"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Database Type
          </label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            style={inputStyle}
            value={form.db_type}
            onChange={(e) => handleChange('db_type', e.target.value)}
          >
            <option value="mysql">MySQL</option>
            <option value="postgres">PostgreSQL</option>
            <option value="sqlite">SQLite</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Host
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            style={inputStyle}
            value={form.host}
            onChange={(e) => handleChange('host', e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Port
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            style={inputStyle}
            type="number"
            value={form.port}
            onChange={(e) => handleChange('port', parseInt(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Username
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            style={inputStyle}
            value={form.username}
            onChange={(e) => handleChange('username', e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Password
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            style={inputStyle}
            type="password"
            value={form.password}
            onChange={(e) => handleChange('password', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Database
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            style={inputStyle}
            value={form.database}
            onChange={(e) => handleChange('database', e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--color-error)' }}>{error}</p>
      )}
      {testResult && (
        <p className="text-sm" style={{ color: testResult.startsWith('Connected') ? 'var(--color-success)' : 'var(--color-error)' }}>
          {testResult}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={connecting}
          className="rounded-md px-4 py-2 text-sm font-medium text-white"
          style={{ background: 'var(--color-accent)' }}
        >
          {connecting ? 'Connecting...' : 'Connect'}
        </button>
        <button
          type="button"
          onClick={handleTest}
          className="rounded-md border px-4 py-2 text-sm font-medium"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          Test Connection
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
