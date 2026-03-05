import { useState } from 'react';
import { X, Plus, Pencil, Trash2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useNotesStore, type Note } from '@/stores/notesStore';
import { NoteEditor } from './NoteEditor';
import { cn } from '@/lib/utils';

interface NotesPanelProps {
  filterTargetKey?: string;
  filterTargetType?: Note['targetType'];
  className?: string;
}

export function NotesPanel({ filterTargetKey, filterTargetType, className }: NotesPanelProps) {
  const notes = useNotesStore((s) => s.notes);
  const panelOpen = useNotesStore((s) => s.panelOpen);
  const editingNoteId = useNotesStore((s) => s.editingNoteId);
  const setPanelOpen = useNotesStore((s) => s.setPanelOpen);
  const setEditingNoteId = useNotesStore((s) => s.setEditingNoteId);
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const deleteNote = useNotesStore((s) => s.deleteNote);

  const [addingNote, setAddingNote] = useState(false);

  // Filter notes by target key if provided, otherwise show all sorted by most recent
  const filteredNotes = filterTargetKey
    ? notes.filter((n) => n.targetKey === filterTargetKey)
    : [...notes].sort((a, b) => b.updatedAt - a.updatedAt);

  const formatTimestamp = (ts: number): string => {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getTargetLabel = (note: Note): string => {
    const parts = note.targetKey.split('.');
    if (note.targetType === 'column' && parts.length >= 3) {
      return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    }
    if (note.targetType === 'table' && parts.length >= 2) {
      return parts[parts.length - 1];
    }
    return note.targetKey;
  };

  const getContentPreview = (content: string): string => {
    const lines = content.split('\n').slice(0, 2);
    const preview = lines.join('\n');
    return preview.length > 120 ? preview.substring(0, 120) + '...' : preview;
  };

  const handleAddSave = (content: string) => {
    const targetType = filterTargetType ?? 'table';
    const targetKey = filterTargetKey ?? 'general';
    addNote(targetType, targetKey, content);
    setAddingNote(false);
  };

  const handleEditSave = (id: string, content: string) => {
    updateNote(id, content);
    setEditingNoteId(null);
  };

  const handleDelete = (id: string) => {
    deleteNote(id);
  };

  return (
    <div
      className={cn(
        'fixed top-0 right-0 z-40 flex h-full w-[280px] flex-col border-l border-border bg-background shadow-lg transition-transform duration-200',
        panelOpen ? 'translate-x-0' : 'translate-x-full',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Notes</h3>
          <Badge variant="secondary" className="h-5 text-[10px]">
            {filteredNotes.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setAddingNote(true)}
            title="Add note"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setPanelOpen(false)}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Add note form */}
        {addingNote && (
          <div className="border-b border-border p-3">
            <NoteEditor
              onSave={handleAddSave}
              onCancel={() => setAddingNote(false)}
            />
          </div>
        )}

        {/* Notes list */}
        {filteredNotes.length === 0 && !addingNote ? (
          <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No notes yet</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setAddingNote(true)}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add a note
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {filteredNotes.map((note, index) => (
              <div key={note.id}>
                {index > 0 && <Separator />}
                <div className="group p-3">
                  {editingNoteId === note.id ? (
                    <NoteEditor
                      initialContent={note.content}
                      onSave={(content) => handleEditSave(note.id, content)}
                      onCancel={() => setEditingNoteId(null)}
                    />
                  ) : (
                    <>
                      {/* Target badge and timestamp */}
                      <div className="mb-1.5 flex items-center justify-between">
                        <Badge variant="outline" className="h-4 text-[9px] px-1.5">
                          {getTargetLabel(note)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTimestamp(note.updatedAt)}
                        </span>
                      </div>

                      {/* Content preview */}
                      <p className="whitespace-pre-wrap text-xs text-foreground leading-relaxed">
                        {getContentPreview(note.content)}
                      </p>

                      {/* Actions */}
                      <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => setEditingNoteId(note.id)}
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(note.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
