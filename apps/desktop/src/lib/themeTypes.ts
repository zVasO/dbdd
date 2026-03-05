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

export function applyThemeToDOM(theme: Theme) {
  const root = document.documentElement;

  // Toggle dark class
  root.classList.toggle('dark', theme.isDark);

  // Apply colors
  for (const [key, varName] of Object.entries(COLOR_VAR_MAP)) {
    root.style.setProperty(varName, theme.colors[key as keyof ThemeColors]);
  }

  // Typography
  root.style.setProperty('--font-sans', theme.typography.fontSans);
  root.style.setProperty('--font-mono', theme.typography.fontMono);
  root.style.setProperty('--font-serif', theme.typography.fontSerif);

  // Layout
  root.style.setProperty('--radius', theme.layout.radius);
  root.style.setProperty('--spacing', theme.layout.spacing);

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
