// === THEME SYSTEM TYPES ===

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
}

export interface ThemeTypography {
  fontSans: string;
  fontMono: string;
  fontSerif: string;
}

export interface ThemeLayout {
  radius: string;
  spacing: string;
}

export interface ThemeShadows {
  sm: string;
  md: string;
  lg: string;
}

export interface Theme {
  id: string;
  name: string;
  builtIn: boolean;
  isDark: boolean;
  colors: ThemeColors;
  typography: ThemeTypography;
  layout: ThemeLayout;
  shadows: ThemeShadows;
  // Optional dark variant — when present, `colors` is light and `darkColors` is dark.
  // `isDark` controls which variant is active.
  darkColors?: ThemeColors;
  darkTypography?: ThemeTypography;
  darkLayout?: ThemeLayout;
}

/** Returns true if the theme has both light and dark variants */
export function isDualMode(theme: Theme): boolean {
  return !!theme.darkColors;
}

/** Returns the effective colors/typography/layout for the current isDark state */
export function getEffectiveColors(theme: Theme): ThemeColors {
  return (theme.isDark && theme.darkColors) ? theme.darkColors : theme.colors;
}
export function getEffectiveTypography(theme: Theme): ThemeTypography {
  return (theme.isDark && theme.darkTypography) ? theme.darkTypography : theme.typography;
}
export function getEffectiveLayout(theme: Theme): ThemeLayout {
  return (theme.isDark && theme.darkLayout) ? theme.darkLayout : theme.layout;
}

// CSS variable name mapping
const COLOR_VAR_MAP: Record<keyof ThemeColors, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  destructiveForeground: '--destructive-foreground',
  border: '--border',
  input: '--input',
  ring: '--ring',
  sidebar: '--sidebar',
  sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
  sidebarRing: '--sidebar-ring',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
};

export function applyThemeToDOM(theme: Theme, animate = true) {
  const root = document.documentElement;

  // Add transition class for smooth switch
  if (animate) {
    root.classList.add('theme-transitioning');
    setTimeout(() => root.classList.remove('theme-transitioning'), 350);
  }

  // Toggle dark class
  root.classList.toggle('dark', theme.isDark);

  // Pick effective variant
  const colors = getEffectiveColors(theme);
  const typo = getEffectiveTypography(theme);
  const layout = getEffectiveLayout(theme);

  // Apply colors
  for (const [key, varName] of Object.entries(COLOR_VAR_MAP)) {
    root.style.setProperty(varName, colors[key as keyof ThemeColors]);
  }

  // Typography
  root.style.setProperty('--font-sans', typo.fontSans);
  root.style.setProperty('--font-mono', typo.fontMono);
  root.style.setProperty('--font-serif', typo.fontSerif);

  // Layout
  root.style.setProperty('--radius', layout.radius);
  root.style.setProperty('--spacing', layout.spacing);

  // Shadows
  root.style.setProperty('--shadow-sm', theme.shadows.sm);
  root.style.setProperty('--shadow-md', theme.shadows.md);
  root.style.setProperty('--shadow-lg', theme.shadows.lg);
}

export function clearThemeFromDOM() {
  const root = document.documentElement;
  for (const varName of Object.values(COLOR_VAR_MAP)) {
    root.style.removeProperty(varName);
  }
  root.style.removeProperty('--font-sans');
  root.style.removeProperty('--font-mono');
  root.style.removeProperty('--font-serif');
  root.style.removeProperty('--radius');
  root.style.removeProperty('--spacing');
  root.style.removeProperty('--shadow-sm');
  root.style.removeProperty('--shadow-md');
  root.style.removeProperty('--shadow-lg');
}

export function exportTheme(theme: Theme): string {
  const { builtIn, ...exportData } = theme;
  return JSON.stringify(exportData, null, 2);
}

export function importTheme(json: string): Theme | null {
  try {
    const data = JSON.parse(json);
    if (!data.id || !data.name || !data.colors) return null;
    return { ...data, builtIn: false };
  } catch {
    return null;
  }
}

// === CSS IMPORT ===

// Reverse mapping: CSS var name → ThemeColors key
const CSS_VAR_TO_COLOR: Record<string, keyof ThemeColors> = Object.fromEntries(
  Object.entries(COLOR_VAR_MAP).map(([key, varName]) => [varName, key as keyof ThemeColors])
);

function extractVarsFromBlock(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const regex = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = regex.exec(block)) !== null) {
    vars[`--${m[1]}`] = m[2].trim();
  }
  return vars;
}

function normalizeColorValue(value: string): string {
  // Raw HSL: "222.2 84% 4.9%" → wrap in hsl()
  if (/^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(value)) {
    return `hsl(${value})`;
  }
  // Raw HSL with alpha: "222.2 84% 4.9% / 0.5"
  if (/^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%\s*\/\s*[\d.]+$/.test(value)) {
    return `hsl(${value})`;
  }
  return value;
}

export interface CSSParseResult {
  colors: Partial<ThemeColors>;
  typography: Partial<ThemeTypography>;
  layout: Partial<ThemeLayout>;
  isDark: boolean;
  matchedColors: number;
  totalColors: number;
  missingKeys: (keyof ThemeColors)[];
}

export function parseCSSVariables(css: string): CSSParseResult {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');

  const rootVars: Record<string, string> = {};
  const darkVars: Record<string, string> = {};

  const rootMatch = cleaned.match(/:root\s*\{([^}]*)\}/);
  if (rootMatch) Object.assign(rootVars, extractVarsFromBlock(rootMatch[1]));

  const darkMatch = cleaned.match(/\.dark\s*\{([^}]*)\}/);
  if (darkMatch) Object.assign(darkVars, extractVarsFromBlock(darkMatch[1]));

  // No blocks found — parse as flat variable list
  if (!rootMatch && !darkMatch) {
    Object.assign(rootVars, extractVarsFromBlock(cleaned));
  }

  const isDark = Object.keys(darkVars).length > 0;
  const effectiveVars = isDark ? { ...rootVars, ...darkVars } : rootVars;

  // Map colors
  const colors: Partial<ThemeColors> = {};
  const allColorKeys = Object.keys(COLOR_VAR_MAP) as (keyof ThemeColors)[];
  const missingKeys: (keyof ThemeColors)[] = [];

  for (const key of allColorKeys) {
    const varName = COLOR_VAR_MAP[key];
    if (effectiveVars[varName]) {
      colors[key] = normalizeColorValue(effectiveVars[varName]);
    } else {
      missingKeys.push(key);
    }
  }

  // Typography
  const typography: Partial<ThemeTypography> = {};
  if (effectiveVars['--font-sans']) typography.fontSans = effectiveVars['--font-sans'];
  if (effectiveVars['--font-mono']) typography.fontMono = effectiveVars['--font-mono'];
  if (effectiveVars['--font-serif']) typography.fontSerif = effectiveVars['--font-serif'];

  // Layout
  const layout: Partial<ThemeLayout> = {};
  if (effectiveVars['--radius']) layout.radius = effectiveVars['--radius'];
  if (effectiveVars['--spacing']) layout.spacing = effectiveVars['--spacing'];

  return {
    colors,
    typography,
    layout,
    isDark,
    matchedColors: Object.keys(colors).length,
    totalColors: allColorKeys.length,
    missingKeys,
  };
}

export interface CSSParseDualResult {
  hasLight: boolean;
  hasDark: boolean;
  light: CSSParseResult;
  dark: CSSParseResult;
}

/**
 * Parse CSS that may contain both :root (light) and .dark blocks.
 * Returns separate parse results for each mode.
 */
export function parseCSSVariablesDual(css: string): CSSParseDualResult {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');

  const rootMatch = cleaned.match(/:root\s*\{([^}]*)\}/);
  const darkMatch = cleaned.match(/\.dark\s*\{([^}]*)\}/);

  const hasLight = !!rootMatch;
  const hasDark = !!darkMatch;

  const rootVars = rootMatch ? extractVarsFromBlock(rootMatch[1]) : {};
  const darkVars = darkMatch ? extractVarsFromBlock(darkMatch[1]) : {};

  // If no blocks found, treat as flat list
  const flatVars = (!rootMatch && !darkMatch) ? extractVarsFromBlock(cleaned) : {};

  function buildResult(vars: Record<string, string>, isDark: boolean): CSSParseResult {
    const colors: Partial<ThemeColors> = {};
    const allColorKeys = Object.keys(COLOR_VAR_MAP) as (keyof ThemeColors)[];
    const missingKeys: (keyof ThemeColors)[] = [];

    for (const key of allColorKeys) {
      const varName = COLOR_VAR_MAP[key];
      if (vars[varName]) {
        colors[key] = normalizeColorValue(vars[varName]);
      } else {
        missingKeys.push(key);
      }
    }

    const typography: Partial<ThemeTypography> = {};
    if (vars['--font-sans']) typography.fontSans = vars['--font-sans'];
    if (vars['--font-mono']) typography.fontMono = vars['--font-mono'];
    if (vars['--font-serif']) typography.fontSerif = vars['--font-serif'];

    const layout: Partial<ThemeLayout> = {};
    if (vars['--radius']) layout.radius = vars['--radius'];
    if (vars['--spacing']) layout.spacing = vars['--spacing'];

    return {
      colors,
      typography,
      layout,
      isDark,
      matchedColors: Object.keys(colors).length,
      totalColors: allColorKeys.length,
      missingKeys,
    };
  }

  if (!hasLight && !hasDark) {
    // Flat CSS — single result, guess dark
    const result = buildResult(flatVars, true);
    return { hasLight: false, hasDark: false, light: result, dark: result };
  }

  return {
    hasLight,
    hasDark,
    light: buildResult(rootVars, false),
    dark: buildResult(darkVars, true),
  };
}

export function generateCSSTemplate(theme: Theme): string {
  const lines = [
    '/* PurrQL Theme Template',
    ' * Paste CSS from tweakcn, shadcn/ui, or edit this template.',
    ' * Supports oklch(), hsl(), rgb(), and hex colors.',
    ' */',
    '',
    ':root {',
  ];

  for (const [key, varName] of Object.entries(COLOR_VAR_MAP)) {
    lines.push(`  ${varName}: ${theme.colors[key as keyof ThemeColors]};`);
  }

  lines.push('');
  lines.push(`  --radius: ${theme.layout.radius};`);
  lines.push(`  --spacing: ${theme.layout.spacing};`);
  lines.push(`  --font-sans: ${theme.typography.fontSans};`);
  lines.push(`  --font-mono: ${theme.typography.fontMono};`);
  lines.push(`  --font-serif: ${theme.typography.fontSerif};`);
  lines.push('}');

  return lines.join('\n');
}
