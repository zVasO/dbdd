import { useState, useMemo } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { parseCSSVariablesDual, generateCSSTemplate, type CSSParseDualResult, type Theme } from '@/lib/themeTypes';
import { ThemePreview } from './ThemePreview';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FileCode2,
  Check,
  AlertTriangle,
  Moon,
  Sun,
  ClipboardPaste,
  FileText,
  Sparkles,
} from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

export function CSSImportDialog({ open, onOpenChange, onCreated }: Props) {
  const [cssText, setCssText] = useState('');
  const [themeName, setThemeName] = useState('My CSS Theme');
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('dark');

  const importThemeFromCSS = useThemeStore((s) => s.importThemeFromCSS);
  const activeTheme = useThemeStore((s) => s.getActiveTheme());

  const dualResult = useMemo((): CSSParseDualResult | null => {
    if (!cssText.trim()) return null;
    return parseCSSVariablesDual(cssText);
  }, [cssText]);

  const hasBothModes = dualResult?.hasLight && dualResult?.hasDark;

  const totalMatched = dualResult
    ? Math.max(dualResult.light.matchedColors, dualResult.dark.matchedColors)
    : 0;

  // Build preview theme
  const previewTheme = useMemo((): Theme => {
    if (!dualResult || totalMatched === 0) return activeTheme;

    const isDarkPreview = previewMode === 'dark';
    let colors = isDarkPreview ? dualResult.dark.colors : dualResult.light.colors;
    let typography = isDarkPreview ? dualResult.dark.typography : dualResult.light.typography;
    let layout = isDarkPreview ? dualResult.dark.layout : dualResult.light.layout;

    // For dark preview with both modes, merge light as base + dark overrides
    if (hasBothModes && isDarkPreview) {
      colors = { ...dualResult.light.colors, ...dualResult.dark.colors };
      typography = { ...dualResult.light.typography, ...dualResult.dark.typography };
      layout = { ...dualResult.light.layout, ...dualResult.dark.layout };
    }

    return {
      id: 'css-preview',
      name: themeName,
      builtIn: false,
      isDark: isDarkPreview,
      colors: { ...activeTheme.colors, ...colors },
      typography: { ...activeTheme.typography, ...typography },
      layout: { ...activeTheme.layout, ...layout },
      shadows: activeTheme.shadows,
    };
  }, [dualResult, activeTheme, previewMode, themeName, hasBothModes, totalMatched]);

  const handleShowTemplate = () => {
    setCssText(generateCSSTemplate(activeTheme));
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCssText(text);
    } catch {
      // Clipboard API not available
    }
  };

  const handleImport = () => {
    if (!dualResult || totalMatched === 0) return;
    const id = importThemeFromCSS(cssText, themeName);
    if (id) {
      onCreated(id);
      onOpenChange(false);
      setCssText('');
      setThemeName('My CSS Theme');
      setPreviewMode('dark');
    }
  };

  const activeParseResult = dualResult
    ? (previewMode === 'dark' ? dualResult.dark : dualResult.light)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileCode2 className="size-4 text-primary" />
            Import Theme from CSS
          </DialogTitle>
          <DialogDescription>
            Paste CSS variables from tweakcn, shadcn/ui, or any theme generator.
          </DialogDescription>
        </DialogHeader>

        {/* Body: Split layout */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left panel: CSS Input + Settings */}
          <div className="w-[55%] flex flex-col border-r border-border min-h-0">
            {/* Toolbar */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/30 shrink-0">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={handlePaste}>
                <ClipboardPaste className="size-3" />
                Paste
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={handleShowTemplate}>
                <FileText className="size-3" />
                Template
              </Button>

              {/* Parse status indicator */}
              {dualResult && (
                <div className="ml-auto flex items-center gap-1.5 text-xs px-2">
                  {totalMatched > 0 ? (
                    <>
                      <div className="flex items-center justify-center size-4 rounded-full bg-emerald-500/15">
                        <Check className="size-2.5 text-emerald-500" />
                      </div>
                      <span className="text-muted-foreground">
                        <span className="text-foreground font-medium">{totalMatched}</span>
                        /{dualResult.light.totalColors} colors
                        {hasBothModes && (
                          <span className="ml-1.5 text-primary font-medium">
                            <Sun className="size-2.5 inline mb-0.5" /> + <Moon className="size-2.5 inline mb-0.5" />
                          </span>
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-center size-4 rounded-full bg-amber-500/15">
                        <AlertTriangle className="size-2.5 text-amber-500" />
                      </div>
                      <span className="text-muted-foreground">No variables detected</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* CSS Textarea */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <textarea
                className="w-full h-full resize-none bg-card/50 p-4 text-xs font-mono leading-relaxed focus:outline-none placeholder:text-muted-foreground/40 overflow-auto"
                placeholder={`:root {\n  --background: oklch(0.97 0.001 106);\n  --foreground: oklch(0.13 0.004 107);\n  --primary: oklch(0.55 0.15 250);\n  /* light mode colors... */\n}\n\n.dark {\n  --background: oklch(0.15 0.004 107);\n  --foreground: oklch(0.96 0.003 106);\n  --primary: oklch(0.67 0.131 39);\n  /* dark mode colors... */\n}`}
                value={cssText}
                onChange={(e) => setCssText(e.target.value)}
                spellCheck={false}
              />
            </div>

            {/* Settings footer */}
            <div className="px-4 py-3 border-t border-border space-y-3 bg-muted/20 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Theme name</Label>
                  <Input
                    className="h-8 text-xs"
                    value={themeName}
                    onChange={(e) => setThemeName(e.target.value)}
                  />
                </div>
                {hasBothModes ? (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Preview</Label>
                    <div className="flex gap-0.5 border border-border rounded-md overflow-hidden">
                      <Button
                        variant={previewMode === 'light' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-8 text-xs gap-1 rounded-none px-2.5"
                        onClick={() => setPreviewMode('light')}
                      >
                        <Sun className="size-3" />
                        Light
                      </Button>
                      <Button
                        variant={previewMode === 'dark' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-8 text-xs gap-1 rounded-none px-2.5"
                        onClick={() => setPreviewMode('dark')}
                      >
                        <Moon className="size-3" />
                        Dark
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Mode</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs w-24"
                      onClick={() => setPreviewMode(previewMode === 'dark' ? 'light' : 'dark')}
                    >
                      {previewMode === 'dark' ? <Moon className="size-3" /> : <Sun className="size-3" />}
                      {previewMode === 'dark' ? 'Dark' : 'Light'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Dual mode info */}
              {hasBothModes && (
                <div className="text-[10px] text-muted-foreground bg-primary/5 border border-primary/10 rounded-md px-2.5 py-2 leading-relaxed">
                  <span className="font-medium text-primary">Both modes detected</span>
                  {' \u2014 theme will automatically switch between light and dark.'}
                </div>
              )}

              {/* Missing vars info */}
              {activeParseResult && activeParseResult.missingKeys.length > 0 && activeParseResult.matchedColors > 0 && (
                <div className="text-[10px] text-muted-foreground bg-muted/50 rounded-md px-2.5 py-2 leading-relaxed">
                  <span className="font-medium text-amber-500">{activeParseResult.missingKeys.length} missing</span>
                  {' \u2014 using fallback from current theme: '}
                  {activeParseResult.missingKeys.slice(0, 6).join(', ')}
                  {activeParseResult.missingKeys.length > 6 && ` +${activeParseResult.missingKeys.length - 6} more`}
                </div>
              )}
            </div>
          </div>

          {/* Right panel: Live Preview */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-2">
              <Sparkles className="size-3 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Live Preview
                {hasBothModes && (
                  <span className="ml-1.5 normal-case">
                    ({previewMode === 'dark' ? 'Dark' : 'Light'})
                  </span>
                )}
              </span>
            </div>
            <div className="flex-1 p-4 min-h-0 overflow-auto">
              <ThemePreview theme={previewTheme} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={totalMatched === 0 || !themeName.trim()} onClick={handleImport}>
            <Check className="size-3.5" />
            Create Theme
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
