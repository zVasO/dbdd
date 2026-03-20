import { usePreferencesStore, type Preferences } from '@/stores/preferencesStore';
import { useThemeStore } from '@/stores/themeStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Settings2, Moon, Sun } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings?: () => void;
}

export function PreferencesDialog({ open, onOpenChange, onOpenSettings }: Props) {
  const prefs = usePreferencesStore();
  const set = prefs.setPreference;
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
          <DialogDescription>Configure VasOdb to your liking.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          {/* Appearance */}
          <Section title="Appearance">
            <Row label="Theme">
              <Select value={activeThemeId} onValueChange={setActiveTheme}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-1.5">
                        {t.isDark ? <Moon className="size-3" /> : <Sun className="size-3" />}
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label="Alternating row colors">
              <Toggle checked={prefs.alternatingRowColors} onChange={(v) => set('alternatingRowColors', v)} />
            </Row>
          </Section>

          <Separator />

          {/* Editor */}
          <Section title="Editor">
            <Row label="Font size">
              <Input
                type="number"
                className="w-20 text-xs"
                min={10}
                max={24}
                value={prefs.editorFontSize}
                onChange={(e) => set('editorFontSize', Number(e.target.value) || 13)}
              />
            </Row>
            <Row label="Show line numbers">
              <Toggle checked={prefs.editorShowLineNumbers} onChange={(v) => set('editorShowLineNumbers', v)} />
            </Row>
            <Row label="Word wrap">
              <Toggle checked={prefs.editorWordWrap} onChange={(v) => set('editorWordWrap', v)} />
            </Row>
            <Row label="Auto uppercase keywords">
              <Toggle checked={prefs.autoUppercaseKeywords} onChange={(v) => set('autoUppercaseKeywords', v)} />
            </Row>
          </Section>

          <Separator />

          {/* Data Grid */}
          <Section title="Data Grid">
            <Row label="Default page size">
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
            </Row>
          </Section>

          <Separator />

          {/* Security */}
          <Section title="Security">
            <Row label="Safe Mode">
              <Select
                value={prefs.safeModeLevel}
                onValueChange={(v) => set('safeModeLevel', v as Preferences['safeModeLevel'])}
              >
                <SelectTrigger className="w-40">
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
            </Row>
          </Section>

          {onOpenSettings && (
            <>
              <Separator />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  onOpenChange(false);
                  onOpenSettings();
                }}
              >
                <Settings2 className="size-3.5" />
                All Settings & Theme Editor
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-sm font-normal">{label}</Label>
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
