import { useState } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import type { Theme, ThemeColors } from '@/lib/themeTypes';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ThemePreview } from './ThemePreview';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  themeId: string;
  onBack: () => void;
}

// Group color keys for the editor
const COLOR_GROUPS: { label: string; keys: (keyof ThemeColors)[] }[] = [
  {
    label: 'Base',
    keys: ['background', 'foreground', 'card', 'cardForeground', 'popover', 'popoverForeground'],
  },
  {
    label: 'Brand',
    keys: ['primary', 'primaryForeground', 'secondary', 'secondaryForeground', 'accent', 'accentForeground'],
  },
  {
    label: 'UI',
    keys: ['muted', 'mutedForeground', 'destructive', 'destructiveForeground', 'border', 'input', 'ring'],
  },
  {
    label: 'Sidebar',
    keys: ['sidebar', 'sidebarForeground', 'sidebarPrimary', 'sidebarPrimaryForeground', 'sidebarAccent', 'sidebarAccentForeground', 'sidebarBorder', 'sidebarRing'],
  },
  {
    label: 'Charts',
    keys: ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'],
  },
];

// Convert camelCase to display label
function formatLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

export function ThemeEditor({ themeId, onBack }: Props) {
  const theme = useThemeStore((s) => s.themes.find((t) => t.id === themeId));
  const updateTheme = useThemeStore((s) => s.updateTheme);
  const updateThemeColors = useThemeStore((s) => s.updateThemeColors);
  const updateThemeTypography = useThemeStore((s) => s.updateThemeTypography);
  const updateThemeLayout = useThemeStore((s) => s.updateThemeLayout);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    Base: true,
    Brand: true,
  });

  if (!theme) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Theme not found.
        <Button variant="ghost" size="sm" onClick={onBack} className="ml-2">
          Go back
        </Button>
      </div>
    );
  }

  const isReadOnly = theme.builtIn;

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  // Create a live preview theme by cloning the current theme state
  const previewTheme = theme;

  return (
    <div className="flex h-full gap-4">
      {/* Editor panel */}
      <div className="w-80 shrink-0 flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Back
          </Button>
          <h2 className="text-sm font-semibold flex-1 truncate">{theme.name}</h2>
          {isReadOnly && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">Built-in</span>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-4 pr-3">
            {/* Name */}
            {!isReadOnly && (
              <div className="space-y-1.5">
                <Label className="text-xs">Theme Name</Label>
                <Input
                  className="text-xs h-8"
                  value={theme.name}
                  onChange={(e) => updateTheme(themeId, { name: e.target.value })}
                />
              </div>
            )}

            {/* Dark mode toggle */}
            {!isReadOnly && (
              <div className="flex items-center justify-between">
                <Label className="text-xs">Dark Mode</Label>
                <ToggleSwitch
                  checked={theme.isDark}
                  onChange={(v) => updateTheme(themeId, { isDark: v })}
                />
              </div>
            )}

            <Separator />

            {/* Colors */}
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Colors</h3>
            {COLOR_GROUPS.map((group) => (
              <div key={group.label}>
                <button
                  className="flex items-center gap-1 text-xs font-medium w-full py-1 hover:text-foreground text-muted-foreground"
                  onClick={() => toggleGroup(group.label)}
                >
                  {expandedGroups[group.label] ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  {group.label}
                </button>
                {expandedGroups[group.label] && (
                  <div className="space-y-2 ml-4 mt-1">
                    {group.keys.map((key) => (
                      <ColorField
                        key={key}
                        label={formatLabel(key)}
                        value={theme.colors[key]}
                        readOnly={isReadOnly}
                        onChange={(v) => updateThemeColors(themeId, { [key]: v })}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            <Separator />

            {/* Typography */}
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Typography</h3>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Sans Font</Label>
                <Input
                  className="text-xs h-7"
                  value={theme.typography.fontSans}
                  readOnly={isReadOnly}
                  onChange={(e) => updateThemeTypography(themeId, { fontSans: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Mono Font</Label>
                <Input
                  className="text-xs h-7"
                  value={theme.typography.fontMono}
                  readOnly={isReadOnly}
                  onChange={(e) => updateThemeTypography(themeId, { fontMono: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Serif Font</Label>
                <Input
                  className="text-xs h-7"
                  value={theme.typography.fontSerif}
                  readOnly={isReadOnly}
                  onChange={(e) => updateThemeTypography(themeId, { fontSerif: e.target.value })}
                />
              </div>
            </div>

            <Separator />

            {/* Layout */}
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Layout</h3>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Border Radius</Label>
                <Input
                  className="text-xs h-7"
                  value={theme.layout.radius}
                  readOnly={isReadOnly}
                  onChange={(e) => updateThemeLayout(themeId, { radius: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Spacing</Label>
                <Input
                  className="text-xs h-7"
                  value={theme.layout.spacing}
                  readOnly={isReadOnly}
                  onChange={(e) => updateThemeLayout(themeId, { spacing: e.target.value })}
                />
              </div>
            </div>

            {/* spacer for scroll */}
            <div className="h-4" />
          </div>
        </ScrollArea>
      </div>

      {/* Preview panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Preview</h3>
        <div className="flex-1 min-h-0">
          <ThemePreview theme={previewTheme} />
        </div>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="size-5 rounded border border-border shrink-0 cursor-pointer"
        style={{ background: value }}
        title={value}
      />
      <span className="text-[10px] text-muted-foreground flex-1 truncate">{label}</span>
      <Input
        className="text-[10px] h-6 w-44 font-mono"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
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
