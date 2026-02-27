import { useEffect, useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { ConnectionList } from '@/components/connection/ConnectionList';
import { ConnectionForm } from '@/components/connection/ConnectionForm';

export function WelcomePage() {
  const loadSavedConnections = useConnectionStore((s) => s.loadSavedConnections);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadSavedConnections();
  }, [loadSavedConnections]);

  return (
    <div className="flex h-screen items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
      <div className="w-full max-w-2xl p-8">
        <h1 className="mb-2 text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          DataForge
        </h1>
        <p className="mb-8" style={{ color: 'var(--color-text-secondary)' }}>
          Connect to a database to get started.
        </p>

        {showForm ? (
          <ConnectionForm onCancel={() => setShowForm(false)} />
        ) : (
          <>
            <ConnectionList />
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ background: 'var(--color-accent)' }}
            >
              New Connection
            </button>
          </>
        )}
      </div>
    </div>
  );
}
