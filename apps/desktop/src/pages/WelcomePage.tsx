import { useEffect, useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { ConnectionList } from '@/components/connection/ConnectionList';
import { ConnectionForm } from '@/components/connection/ConnectionForm';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export function WelcomePage() {
  const loadSavedConnections = useConnectionStore((s) => s.loadSavedConnections);
  const error = useConnectionStore((s) => s.error);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadSavedConnections();
  }, [loadSavedConnections]);

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-3xl">DataForge</CardTitle>
          <CardDescription>Connect to a database to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {showForm ? (
            <ConnectionForm onCancel={() => setShowForm(false)} />
          ) : (
            <>
              <ConnectionList />
              <Button onClick={() => setShowForm(true)} className="mt-4">
                New Connection
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
