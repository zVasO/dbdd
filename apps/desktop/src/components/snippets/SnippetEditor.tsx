import { useState, useMemo, useCallback } from 'react';
import { Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useSnippetStore, type Snippet } from '@/stores/snippetStore';

interface SnippetEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snippet?: Snippet | null;
}

function extractVariables(sql: string): string[] {
  const matches = sql.match(/\$[a-zA-Z_][a-zA-Z0-9_]*/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

export function SnippetEditor({
  open,
  onOpenChange,
  snippet,
}: SnippetEditorProps) {
  const { createSnippet, updateSnippet } = useSnippetStore();

  const [name, setName] = useState(snippet?.name ?? '');
  const [description, setDescription] = useState(snippet?.description ?? '');
  const [sql, setSql] = useState(snippet?.sql ?? '');
  const [tagsInput, setTagsInput] = useState(
    snippet?.tags.join(', ') ?? '',
  );

  const isEditing = !!snippet;

  const detectedVariables = useMemo(() => extractVariables(sql), [sql]);

  const parsedTags = useMemo(() => {
    return tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }, [tagsInput]);

  const handleSave = useCallback(() => {
    if (!name.trim() || !sql.trim()) return;

    if (isEditing && snippet) {
      updateSnippet(snippet.id, {
        name: name.trim(),
        description: description.trim(),
        sql: sql.trim(),
        tags: parsedTags,
      });
    } else {
      createSnippet({
        name: name.trim(),
        description: description.trim(),
        sql: sql.trim(),
        tags: parsedTags,
      });
    }

    onOpenChange(false);
  }, [
    name,
    description,
    sql,
    parsedTags,
    isEditing,
    snippet,
    createSnippet,
    updateSnippet,
    onOpenChange,
  ]);

  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (!value) {
        // Reset form when closing
        setName(snippet?.name ?? '');
        setDescription(snippet?.description ?? '');
        setSql(snippet?.sql ?? '');
        setTagsInput(snippet?.tags.join(', ') ?? '');
      }
      onOpenChange(value);
    },
    [onOpenChange, snippet],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Snippet' : 'New Snippet'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update your SQL snippet.'
              : 'Create a reusable SQL snippet. Use $variable_name for dynamic values.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snippet-name">Name</Label>
            <Input
              id="snippet-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Find user by email"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snippet-desc">Description</Label>
            <Input
              id="snippet-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          {/* SQL */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snippet-sql">SQL</Label>
            <textarea
              id="snippet-sql"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder="SELECT * FROM users WHERE email = $email"
              rows={6}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-y dark:bg-input/30"
            />
          </div>

          {/* Detected variables */}
          {detectedVariables.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Detected Variables</Label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {detectedVariables.map((v) => (
                  <Badge key={v} variant="secondary" className="font-mono text-xs">
                    {v}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snippet-tags">Tags (comma-separated)</Label>
            <Input
              id="snippet-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. users, search, production"
            />
            {parsedTags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap mt-1">
                {parsedTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="size-3.5" />
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || !sql.trim()}
          >
            <Save className="size-3.5" />
            {isEditing ? 'Update' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
