import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NoteEditorProps {
  initialContent?: string;
  placeholder?: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  className?: string;
}

export function NoteEditor({
  initialContent = '',
  placeholder = 'Add a note...',
  onSave,
  onCancel,
  className,
}: NoteEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (content.trim()) {
          onSave(content.trim());
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [content, onSave, onCancel],
  );

  const handleSave = useCallback(() => {
    if (content.trim()) {
      onSave(content.trim());
    }
  }, [content, onSave]);

  const renderMarkdown = (text: string): string => {
    let html = text;
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code
    html = html.replace(/`(.+?)`/g, '<code class="bg-muted px-1 rounded text-xs">$1</code>');
    // Line breaks
    html = html.replace(/\n/g, '<br />');
    return html;
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => setShowPreview(!showPreview)}
          title={showPreview ? 'Edit' : 'Preview'}
        >
          {showPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </Button>
      </div>

      {showPreview ? (
        <div
          className="min-h-[80px] rounded-md border border-border bg-muted/30 p-2 text-sm"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="min-h-[80px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          rows={4}
        />
      )}

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          Ctrl+Enter to save
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancel}>
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleSave}
            disabled={!content.trim()}
          >
            <Save className="mr-1 h-3 w-3" />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
