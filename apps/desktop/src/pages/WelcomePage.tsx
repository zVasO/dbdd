import { useEffect, useState } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { ConnectionList } from '@/components/connection/ConnectionList';
import { ConnectionForm } from '@/components/connection/ConnectionForm';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function WelcomePage() {
  const loadSavedConnections = useConnectionStore((s) => s.loadSavedConnections);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadSavedConnections();
  }, [loadSavedConnections]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-3xl">DataForge</CardTitle>
          <CardDescription>Connect to a database to get started.</CardDescription>
        </CardHeader>
        <CardContent>
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
