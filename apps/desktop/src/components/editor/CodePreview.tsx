import { useChangeStore } from '@/stores/changeStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

export function CodePreview() {
  const previewOpen = useChangeStore((s) => s.previewOpen);
  const setPreviewOpen = useChangeStore((s) => s.setPreviewOpen);
  const generateSql = useChangeStore((s) => s.generateSql);
  const pendingCount = useChangeStore((s) => s.pendingCount());
  const [copied, setCopied] = useState(false);

  const statements = previewOpen ? generateSql() : [];
  const fullSql = statements.join('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(fullSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pending Changes Preview</DialogTitle>
          <DialogDescription>
            {pendingCount} statement{pendingCount !== 1 ? 's' : ''} will be executed on commit.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[400px]">
          <pre className="rounded-md bg-muted p-4 text-xs font-mono leading-relaxed">
            {fullSql || 'No pending changes.'}
          </pre>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy SQL'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
