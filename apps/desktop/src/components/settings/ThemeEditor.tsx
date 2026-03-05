import { useState, useRef, useMemo } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import type { Theme, ThemeColors } from '@/lib/themeTypes';
import { getEffectiveColors, getEffectiveTypography, getEffectiveLayout, isDualMode } from '@/lib/themeTypes';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ThemePreview } from './ThemePreview';
import { FontSelect } from './FontSelect';
import { ChevronDown, ChevronRight, Moon, Sun } from 'lucide-react';

// Convert any CSS color (oklch, hsl, rgb, etc.) to hex for <input type="color">
function cssColorToHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return '#000000';
    ctx.fillStyle = color;
    return ctx.fillStyle; // returns hex
  } catch {
    return '#000000';
  }
}

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
  const [previewDark, setPreviewDark] = useState(theme?.isDark ?? true);

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
  const dual = isDualMode(theme);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  // For preview: override isDark to match the preview toggle
  const previewTheme: Theme = dual ? { ...theme, isDark: previewDark } : theme;

  // Colors shown in the editor: effective colors for the current preview mode
  const editColors = dual
    ? getEffectiveColors({ ...theme, isDark: previewDark })
    : theme.colors;

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

        <div className="flex-1 overflow-y-auto">
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

            {/* Dark/Light preview toggle */}
            {dual ? (
              <div className="flex items-center justify-between">
                <Label className="text-xs">Preview Mode</Label>
                <div className="flex gap-0.5 border border-border rounded-md overflow-hidden">
                  <button
                    className={`flex items-center gap-1 px-2 py-1 text-xs ${!previewDark ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setPreviewDark(false)}
                  >
                    <Sun className="size-3" /> Light
                  </button>
                  <button
                    className={`flex items-center gap-1 px-2 py-1 text-xs ${previewDark ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setPreviewDark(true)}
                  >
                    <Moon className="size-3" /> Dark
                  </button>
                </div>
              </div>
            ) : !isReadOnly && (
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
                        value={editColors[key]}
                        readOnly={isReadOnly}
                        onChange={(v) => {
                          if (dual && previewDark && theme.darkColors) {
                            // Edit the dark variant
                            updateTheme(themeId, { darkColors: { ...theme.darkColors, [key]: v } });
                          } else {
                            updateThemeColors(themeId, { [key]: v });
                          }
                        }}
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
              <FontSelect
                label="Sans Font"
                category="sans"
                value={theme.typography.fontSans}
                readOnly={isReadOnly}
                onChange={(v) => updateThemeTypography(themeId, { fontSans: v })}
              />
              <FontSelect
                label="Mono Font"
                category="mono"
                value={theme.typography.fontMono}
                readOnly={isReadOnly}
                onChange={(v) => updateThemeTypography(themeId, { fontMono: v })}
              />
              <FontSelect
                label="Serif Font"
                category="serif"
                value={theme.typography.fontSerif}
                readOnly={isReadOnly}
                onChange={(v) => updateThemeTypography(themeId, { fontSerif: v })}
              />
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
        </div>
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
  const pickerRef = useRef<HTMLInputElement>(null);
  const hexValue = useMemo(() => cssColorToHex(value), [value]);

  return (
    <div className="flex items-center gap-2">
      <div
        className="relative size-5 rounded border border-border shrink-0 cursor-pointer"
        style={{ background: value }}
        title={value}
        onClick={() => !readOnly && pickerRef.current?.click()}
      >
        <input
          ref={pickerRef}
          type="color"
          className="sr-only"
          value={hexValue}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
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
