import { useState, useRef } from 'react';
import { useModal } from '@/hooks/useModal';
import { usePreferencesStore, type Preferences, type CopyFormat, type DarkModeScheduleMode } from '@/stores/preferencesStore';
import { useThemeStore } from '@/stores/themeStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { ThemeEditor } from './ThemeEditor';
import { CSSImportDialog } from './CSSImportDialog';
import { ShortcutsSection } from './ShortcutsSection';
import { AiProviderConfig } from '@/components/ai/AiProviderConfig';
import {
  X,
  Palette,
  Settings2,
  Shield,
  Grid3X3,
  Copy,
  Trash2,
  Download,
  Upload,
  Pencil,
  Check,
  Sun,
  Moon,
  Sparkles,
  FileCode2,
  Keyboard,
} from 'lucide-react';

interface Props {
  onClose: () => void;
}

type Section = 'appearance' | 'editor' | 'grid' | 'security' | 'ai' | 'themes' | 'shortcuts';

export function SettingsPage({ onClose }: Props) {
  useModal('settings');
  const [activeSection, setActiveSection] = useState<Section>('appearance');
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);

  if (editingThemeId) {
    return (
      <div className="flex h-full flex-col bg-background">
        <SettingsHeader onClose={onClose} title="Theme Editor" />
        <div className="flex-1 overflow-hidden p-4">
          <ThemeEditor themeId={editingThemeId} onBack={() => setEditingThemeId(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <SettingsHeader onClose={onClose} title="Settings" />
      <div className="flex flex-1 overflow-hidden">
        {/* Navigation */}
        <nav className="w-48 border-r border-border p-3 space-y-1 shrink-0">
          <NavItem icon={<Palette className="size-4" />} label="Appearance" active={activeSection === 'appearance'} onClick={() => setActiveSection('appearance')} />
          <NavItem icon={<Settings2 className="size-4" />} label="Editor" active={activeSection === 'editor'} onClick={() => setActiveSection('editor')} />
          <NavItem icon={<Grid3X3 className="size-4" />} label="Data Grid" active={activeSection === 'grid'} onClick={() => setActiveSection('grid')} />
          <NavItem icon={<Shield className="size-4" />} label="Security" active={activeSection === 'security'} onClick={() => setActiveSection('security')} />
          <NavItem icon={<Sparkles className="size-4" />} label="AI" active={activeSection === 'ai'} onClick={() => setActiveSection('ai')} />
          <NavItem icon={<Keyboard className="size-4" />} label="Shortcuts" active={activeSection === 'shortcuts'} onClick={() => setActiveSection('shortcuts')} />
          <Separator className="my-2" />
          <NavItem icon={<Palette className="size-4" />} label="Themes" active={activeSection === 'themes'} onClick={() => setActiveSection('themes')} />
        </nav>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="max-w-2xl p-6">
            {activeSection === 'appearance' && <AppearanceSection />}
            {activeSection === 'editor' && <EditorSection />}
            {activeSection === 'grid' && <GridSection />}
            {activeSection === 'security' && <SecuritySection />}
            {activeSection === 'ai' && <AISection />}
            {activeSection === 'shortcuts' && <ShortcutsSection />}
            {activeSection === 'themes' && <ThemesSection onEditTheme={setEditingThemeId} />}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// === HEADER ===

function SettingsHeader({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <div className="flex items-center h-10 px-4 border-b border-border shrink-0 bg-card">
      <h1 className="text-sm font-semibold flex-1">{title}</h1>
      <Button variant="ghost" size="icon-xs" onClick={onClose}>
        <X className="size-4" />
      </Button>
    </div>
  );
}

// === NAV ===

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-sm transition-colors ${
        active ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// === SECTIONS ===

function AppearanceSection() {
  const prefs = usePreferencesStore();
  const set = prefs.setPreference;
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);

  return (
    <div className="space-y-6">
      <SectionTitle title="Appearance" description="Customize the look and feel of DataForge." />

      <SettingRow label="Theme" description="Select a color theme for the interface.">
        <Select value={activeThemeId} onValueChange={setActiveTheme}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {themes.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="flex items-center gap-2">
                  {t.isDark ? <Moon className="size-3" /> : <Sun className="size-3" />}
                  {t.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Theme mode" description="Control when dark mode is active.">
        <Select
          value={prefs.darkModeSchedule?.mode || 'manual'}
          onValueChange={(v) => set('darkModeSchedule', {
            ...prefs.darkModeSchedule,
            mode: v as DarkModeScheduleMode,
          })}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="system">Follow System</SelectItem>
            <SelectItem value="schedule">Schedule</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      {prefs.darkModeSchedule?.mode === 'schedule' && (
        <div className="flex gap-4 pl-1">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Light mode from</Label>
            <Input
              type="time"
              className="w-32 text-xs"
              value={prefs.darkModeSchedule.lightFrom || '07:00'}
              onChange={(e) => set('darkModeSchedule', {
                ...prefs.darkModeSchedule,
                lightFrom: e.target.value,
              })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Dark mode from</Label>
            <Input
              type="time"
              className="w-32 text-xs"
              value={prefs.darkModeSchedule.darkFrom || '19:00'}
              onChange={(e) => set('darkModeSchedule', {
                ...prefs.darkModeSchedule,
                darkFrom: e.target.value,
              })}
            />
          </div>
        </div>
      )}

      <SettingRow label="Alternating row colors" description="Stripe every other row in the data grid.">
        <Toggle checked={prefs.alternatingRowColors} onChange={(v) => set('alternatingRowColors', v)} />
      </SettingRow>
    </div>
  );
}

function EditorSection() {
  const prefs = usePreferencesStore();
  const set = prefs.setPreference;

  return (
    <div className="space-y-6">
      <SectionTitle title="Editor" description="Configure the SQL editor behavior." />

      <SettingRow label="Font size" description="Editor font size in pixels (10-24).">
        <Input
          type="number"
          className="w-20 text-xs"
          min={10}
          max={24}
          value={prefs.editorFontSize}
          onChange={(e) => set('editorFontSize', Number(e.target.value) || 13)}
        />
      </SettingRow>

      <SettingRow label="Show line numbers">
        <Toggle checked={prefs.editorShowLineNumbers} onChange={(v) => set('editorShowLineNumbers', v)} />
      </SettingRow>

      <SettingRow label="Word wrap">
        <Toggle checked={prefs.editorWordWrap} onChange={(v) => set('editorWordWrap', v)} />
      </SettingRow>

      <SettingRow label="Auto uppercase keywords" description="Automatically capitalize SQL keywords as you type.">
        <Toggle checked={prefs.autoUppercaseKeywords} onChange={(v) => set('autoUppercaseKeywords', v)} />
      </SettingRow>
    </div>
  );
}

function GridSection() {
  const prefs = usePreferencesStore();
  const set = prefs.setPreference;

  return (
    <div className="space-y-6">
      <SectionTitle title="Data Grid" description="Configure data display settings." />

      <SettingRow label="Default page size" description="Number of rows loaded per page.">
        <Select
          value={String(prefs.defaultPageSize)}
          onValueChange={(v) => set('defaultPageSize', Number(v))}
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="100">100</SelectItem>
            <SelectItem value="300">300</SelectItem>
            <SelectItem value="500">500</SelectItem>
            <SelectItem value="1000">1000</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Default copy format" description="Format used when copying cells or rows with Ctrl+C.">
        <Select
          value={prefs.defaultCopyFormat}
          onValueChange={(v) => set('defaultCopyFormat', v as CopyFormat)}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="json">JSON</SelectItem>
            <SelectItem value="csv">CSV</SelectItem>
            <SelectItem value="tsv">TSV</SelectItem>
            <SelectItem value="markdown">Markdown</SelectItem>
            <SelectItem value="insert">INSERT</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </div>
  );
}

function SecuritySection() {
  const prefs = usePreferencesStore();
  const set = prefs.setPreference;

  return (
    <div className="space-y-6">
      <SectionTitle title="Security" description="Control how DataForge handles dangerous operations." />

      <SettingRow label="Safe Mode" description="Choose when to show confirmation dialogs for destructive queries.">
        <Select
          value={prefs.safeModeLevel}
          onValueChange={(v) => set('safeModeLevel', v as Preferences['safeModeLevel'])}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="silent">Silent</SelectItem>
            <SelectItem value="alert">Alert</SelectItem>
            <SelectItem value="alert_select">Alert (except SELECT)</SelectItem>
            <SelectItem value="password">Password</SelectItem>
            <SelectItem value="password_select">Password (except SELECT)</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </div>
  );
}

function AISection() {
  return (
    <div className="space-y-6">
      <SectionTitle title="AI Assistant" description="Configure AI providers for SQL generation, query explanation, and optimization." />
      <AiProviderConfig />
    </div>
  );
}

function ThemesSection({ onEditTheme }: { onEditTheme: (id: string) => void }) {
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);
  const createTheme = useThemeStore((s) => s.createTheme);
  const duplicateTheme = useThemeStore((s) => s.duplicateTheme);
  const deleteTheme = useThemeStore((s) => s.deleteTheme);
  const importThemeFromJSON = useThemeStore((s) => s.importThemeFromJSON);
  const exportThemeAsJSON = useThemeStore((s) => s.exportThemeAsJSON);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cssImportOpen, setCssImportOpen] = useState(false);

  const builtIn = themes.filter((t) => t.builtIn);
  const custom = themes.filter((t) => !t.builtIn);

  const handleCreate = () => {
    const id = createTheme('My Theme', activeThemeId);
    onEditTheme(id);
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const id = importThemeFromJSON(reader.result as string);
      if (id) onEditTheme(id);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExport = (id: string) => {
    const json = exportThemeAsJSON(id);
    if (!json) return;
    const theme = themes.find((t) => t.id === id);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${theme?.name.toLowerCase().replace(/\s+/g, '-') || 'theme'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <SectionTitle title="Themes" description="Manage your color themes. Create, edit, import, and export themes." />

      <div className="flex gap-2">
        <Button size="sm" onClick={handleCreate}>
          <Palette className="size-3.5" />
          New Theme
        </Button>
        <Button size="sm" variant="outline" onClick={() => setCssImportOpen(true)}>
          <FileCode2 className="size-3.5" />
          Import CSS
        </Button>
        <Button size="sm" variant="outline" onClick={handleImport}>
          <Upload className="size-3.5" />
          Import JSON
        </Button>
        <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />
      </div>

      <CSSImportDialog
        open={cssImportOpen}
        onOpenChange={setCssImportOpen}
        onCreated={(id) => onEditTheme(id)}
      />

      {/* Built-in themes */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Built-in Themes</h3>
        <div className="grid grid-cols-2 gap-2">
          {builtIn.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              isActive={theme.id === activeThemeId}
              onSelect={() => setActiveTheme(theme.id)}
              onDuplicate={() => {
                const id = duplicateTheme(theme.id);
                onEditTheme(id);
              }}
              onExport={() => handleExport(theme.id)}
            />
          ))}
        </div>
      </div>

      {/* Custom themes */}
      {custom.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Custom Themes</h3>
          <div className="grid grid-cols-2 gap-2">
            {custom.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                isActive={theme.id === activeThemeId}
                onSelect={() => setActiveTheme(theme.id)}
                onEdit={() => onEditTheme(theme.id)}
                onDuplicate={() => {
                  const id = duplicateTheme(theme.id);
                  onEditTheme(id);
                }}
                onDelete={() => deleteTheme(theme.id)}
                onExport={() => handleExport(theme.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// === THEME CARD ===

interface ThemeCardProps {
  theme: import('@/lib/themeTypes').Theme;
  isActive: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDuplicate: () => void;
  onDelete?: () => void;
  onExport: () => void;
}

function ThemeCard({ theme, isActive, onSelect, onEdit, onDuplicate, onDelete, onExport }: ThemeCardProps) {
  const c = theme.colors;

  return (
    <div
      className={`group rounded-lg border cursor-pointer transition-all hover:border-primary/50 ${
        isActive ? 'border-primary ring-1 ring-primary/20' : 'border-border'
      }`}
      onClick={onSelect}
    >
      {/* Color preview strip */}
      <div className="flex gap-1 p-3 pb-0">
        {[c.background, c.primary, c.accent, c.sidebar, c.destructive].map((color, i) => (
          <div
            key={i}
            className="h-4 flex-1 rounded-sm border border-black/10"
            style={{ background: color }}
          />
        ))}
      </div>

      {/* Name + status + actions */}
      <div className="flex items-center gap-1 px-3 py-2">
        {theme.darkColors ? (
          <span className="flex items-center gap-0.5 text-muted-foreground"><Sun className="size-2.5" /><Moon className="size-2.5" /></span>
        ) : theme.isDark ? <Moon className="size-3 text-muted-foreground" /> : <Sun className="size-3 text-muted-foreground" />}
        <span className="text-xs font-medium truncate flex-1">{theme.name}</span>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && (
            <ActionBtn icon={<Pencil className="size-3" />} title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(); }} />
          )}
          <ActionBtn icon={<Copy className="size-3" />} title="Duplicate" onClick={(e) => { e.stopPropagation(); onDuplicate(); }} />
          <ActionBtn icon={<Download className="size-3" />} title="Export" onClick={(e) => { e.stopPropagation(); onExport(); }} />
          {onDelete && (
            <ActionBtn icon={<Trash2 className="size-3" />} title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(); }} destructive />
          )}
        </div>
        {isActive && <Check className="size-3 text-primary shrink-0" />}
      </div>
    </div>
  );
}

function ActionBtn({ icon, title, onClick, destructive }: { icon: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void; destructive?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-1 rounded hover:bg-muted transition-colors ${destructive ? 'hover:text-destructive' : ''}`}
    >
      {icon}
    </button>
  );
}

// === SHARED COMPONENTS ===

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <Separator className="mt-3" />
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="space-y-0.5">
        <Label className="text-sm font-normal">{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
