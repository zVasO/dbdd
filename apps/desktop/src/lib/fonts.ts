// === FONT MANAGEMENT ===

const FONTS_STORAGE_KEY = 'dataforge:imported-fonts';

export interface FontEntry {
  name: string;
  stack: string;
  source: 'bundled' | 'system' | 'google';
  category: 'sans' | 'mono' | 'serif';
}

export const CURATED_FONTS: FontEntry[] = [
  // Sans — Bundled
  { name: 'Outfit', stack: 'Outfit, sans-serif', source: 'bundled', category: 'sans' },
  // Sans — System
  { name: 'System UI', stack: 'system-ui, -apple-system, sans-serif', source: 'system', category: 'sans' },
  { name: 'Segoe UI', stack: '"Segoe UI", Tahoma, sans-serif', source: 'system', category: 'sans' },
  { name: 'Arial', stack: 'Arial, Helvetica, sans-serif', source: 'system', category: 'sans' },
  // Sans — Google
  { name: 'Inter', stack: 'Inter, sans-serif', source: 'google', category: 'sans' },
  { name: 'DM Sans', stack: '"DM Sans", sans-serif', source: 'google', category: 'sans' },
  { name: 'Plus Jakarta Sans', stack: '"Plus Jakarta Sans", sans-serif', source: 'google', category: 'sans' },
  { name: 'Nunito', stack: 'Nunito, sans-serif', source: 'google', category: 'sans' },
  { name: 'Poppins', stack: 'Poppins, sans-serif', source: 'google', category: 'sans' },
  { name: 'Lato', stack: 'Lato, sans-serif', source: 'google', category: 'sans' },
  { name: 'Open Sans', stack: '"Open Sans", sans-serif', source: 'google', category: 'sans' },
  { name: 'Source Sans 3', stack: '"Source Sans 3", sans-serif', source: 'google', category: 'sans' },
  { name: 'Geist', stack: 'Geist, sans-serif', source: 'google', category: 'sans' },
  { name: 'Manrope', stack: 'Manrope, sans-serif', source: 'google', category: 'sans' },

  // Mono — Bundled
  { name: 'Geist Mono', stack: '"Geist Mono", ui-monospace, monospace', source: 'bundled', category: 'mono' },
  // Mono — System
  { name: 'Consolas', stack: 'Consolas, monospace', source: 'system', category: 'mono' },
  { name: 'Cascadia Code', stack: '"Cascadia Code", monospace', source: 'system', category: 'mono' },
  { name: 'Courier New', stack: '"Courier New", Courier, monospace', source: 'system', category: 'mono' },
  // Mono — Google
  { name: 'JetBrains Mono', stack: '"JetBrains Mono", monospace', source: 'google', category: 'mono' },
  { name: 'Fira Code', stack: '"Fira Code", monospace', source: 'google', category: 'mono' },
  { name: 'Source Code Pro', stack: '"Source Code Pro", monospace', source: 'google', category: 'mono' },
  { name: 'IBM Plex Mono', stack: '"IBM Plex Mono", monospace', source: 'google', category: 'mono' },
  { name: 'Inconsolata', stack: 'Inconsolata, monospace', source: 'google', category: 'mono' },
  { name: 'Ubuntu Mono', stack: '"Ubuntu Mono", monospace', source: 'google', category: 'mono' },
  { name: 'Space Mono', stack: '"Space Mono", monospace', source: 'google', category: 'mono' },

  // Serif — System
  { name: 'Georgia', stack: 'Georgia, serif', source: 'system', category: 'serif' },
  { name: 'Times New Roman', stack: '"Times New Roman", Times, serif', source: 'system', category: 'serif' },
  { name: 'Palatino', stack: '"Palatino Linotype", Palatino, serif', source: 'system', category: 'serif' },
  // Serif — Google
  { name: 'Merriweather', stack: 'Merriweather, serif', source: 'google', category: 'serif' },
  { name: 'Lora', stack: 'Lora, serif', source: 'google', category: 'serif' },
  { name: 'Playfair Display', stack: '"Playfair Display", serif', source: 'google', category: 'serif' },
  { name: 'Source Serif 4', stack: '"Source Serif 4", serif', source: 'google', category: 'serif' },
  { name: 'Libre Baskerville', stack: '"Libre Baskerville", serif', source: 'google', category: 'serif' },
  { name: 'Crimson Text', stack: '"Crimson Text", serif', source: 'google', category: 'serif' },
];

// === Loading ===

const loadedFonts = new Set<string>();

export function loadGoogleFont(fontFamily: string): Promise<boolean> {
  if (loadedFonts.has(fontFamily)) return Promise.resolve(true);

  const id = `gf-${fontFamily.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) {
    loadedFonts.add(fontFamily);
    return Promise.resolve(true);
  }

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);

  return new Promise((resolve) => {
    link.onload = () => {
      loadedFonts.add(fontFamily);
      resolve(true);
    };
    link.onerror = () => {
      link.remove();
      resolve(false);
    };
  });
}

let curatedPreloaded = false;

export function preloadCuratedGoogleFonts() {
  if (curatedPreloaded) return;
  curatedPreloaded = true;

  const googleFonts = CURATED_FONTS.filter((f) => f.source === 'google');
  const families = googleFonts.map((f) => `family=${encodeURIComponent(f.name)}:wght@400;500;600`).join('&');

  const link = document.createElement('link');
  link.id = 'gf-curated-preload';
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.appendChild(link);

  link.onload = () => {
    for (const f of googleFonts) loadedFonts.add(f.name);
  };
}

// === Persistence for user-imported fonts ===

export function getImportedFonts(): FontEntry[] {
  try {
    return JSON.parse(localStorage.getItem(FONTS_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveImportedFont(font: FontEntry) {
  const fonts = getImportedFonts();
  if (!fonts.find((f) => f.name === font.name)) {
    fonts.push(font);
    localStorage.setItem(FONTS_STORAGE_KEY, JSON.stringify(fonts));
  }
}

export function removeImportedFont(name: string) {
  const fonts = getImportedFonts().filter((f) => f.name !== name);
  localStorage.setItem(FONTS_STORAGE_KEY, JSON.stringify(fonts));
}

// Load saved imported fonts on module init
function initSavedFonts() {
  for (const font of getImportedFonts()) {
    loadGoogleFont(font.name);
  }
}

initSavedFonts();

// === Extended Google Fonts catalog (for search suggestions) ===
// Compact format: [name, category] — converted to FontEntry on access

const GOOGLE_CATALOG: [string, 'sans' | 'mono' | 'serif'][] = [
  // Sans-serif
  ['Roboto', 'sans'],
  ['Montserrat', 'sans'],
  ['Raleway', 'sans'],
  ['Ubuntu', 'sans'],
  ['Rubik', 'sans'],
  ['Work Sans', 'sans'],
  ['Quicksand', 'sans'],
  ['Josefin Sans', 'sans'],
  ['Barlow', 'sans'],
  ['Mulish', 'sans'],
  ['Karla', 'sans'],
  ['Cabin', 'sans'],
  ['Mukta', 'sans'],
  ['Asap', 'sans'],
  ['Jost', 'sans'],
  ['Figtree', 'sans'],
  ['Lexend', 'sans'],
  ['Sora', 'sans'],
  ['Albert Sans', 'sans'],
  ['Red Hat Display', 'sans'],
  ['Space Grotesk', 'sans'],
  ['Urbanist', 'sans'],
  ['Noto Sans', 'sans'],
  ['Overpass', 'sans'],
  ['Titillium Web', 'sans'],
  ['Dosis', 'sans'],
  ['Heebo', 'sans'],
  ['Commissioner', 'sans'],
  ['Readex Pro', 'sans'],
  ['Exo 2', 'sans'],
  ['Kanit', 'sans'],
  ['Archivo', 'sans'],
  ['Public Sans', 'sans'],
  ['Signika', 'sans'],
  ['Catamaran', 'sans'],
  ['Comfortaa', 'sans'],
  ['Oswald', 'sans'],
  ['Bebas Neue', 'sans'],
  ['Anton', 'sans'],
  ['Righteous', 'sans'],
  // Monospace
  ['Roboto Mono', 'mono'],
  ['PT Mono', 'mono'],
  ['Anonymous Pro', 'mono'],
  ['Overpass Mono', 'mono'],
  ['DM Mono', 'mono'],
  ['Red Hat Mono', 'mono'],
  ['Noto Sans Mono', 'mono'],
  ['Azeret Mono', 'mono'],
  ['Martian Mono', 'mono'],
  ['Cousine', 'mono'],
  ['Share Tech Mono', 'mono'],
  ['Major Mono Display', 'mono'],
  // Serif
  ['Roboto Slab', 'serif'],
  ['PT Serif', 'serif'],
  ['Noto Serif', 'serif'],
  ['EB Garamond', 'serif'],
  ['Cormorant Garamond', 'serif'],
  ['Bitter', 'serif'],
  ['Spectral', 'serif'],
  ['IBM Plex Serif', 'serif'],
  ['DM Serif Display', 'serif'],
  ['DM Serif Text', 'serif'],
  ['Cardo', 'serif'],
  ['Old Standard TT', 'serif'],
  ['Vollkorn', 'serif'],
  ['Abhaya Libre', 'serif'],
  ['Zilla Slab', 'serif'],
  ['Domine', 'serif'],
  ['Literata', 'serif'],
  ['Gelasio', 'serif'],
  ['Newsreader', 'serif'],
  ['Brygada 1918', 'serif'],
];

// Build FontEntry from catalog entry
function catalogToEntry([name, category]: [string, 'sans' | 'mono' | 'serif']): FontEntry {
  const fallback = category === 'mono' ? 'monospace' : category === 'serif' ? 'serif' : 'sans-serif';
  const stack = name.includes(' ') ? `"${name}", ${fallback}` : `${name}, ${fallback}`;
  return { name, stack, source: 'google', category };
}

// === Helpers ===

export function getPrimaryFontName(stack: string): string {
  const first = stack.split(',')[0].trim();
  return first.replace(/^["']|["']$/g, '');
}

export function getAllFonts(category: 'sans' | 'mono' | 'serif'): FontEntry[] {
  const imported = getImportedFonts().filter((f) => f.category === category);
  const curated = CURATED_FONTS.filter((f) => f.category === category);
  const catalog = GOOGLE_CATALOG.filter(([, c]) => c === category).map(catalogToEntry);

  // Dedupe: imported > curated > catalog
  const seen = new Set<string>();
  const result: FontEntry[] = [];

  for (const list of [imported, curated, catalog]) {
    for (const f of list) {
      if (!seen.has(f.name)) {
        seen.add(f.name);
        result.push(f);
      }
    }
  }

  return result;
}

export function searchFonts(query: string, category: 'sans' | 'mono' | 'serif'): FontEntry[] {
  if (!query.trim()) return getAllFonts(category);
  const q = query.toLowerCase();
  return getAllFonts(category).filter((f) => f.name.toLowerCase().includes(q));
}

export function makeFontEntry(name: string, category: 'sans' | 'mono' | 'serif'): FontEntry {
  const fallback = category === 'mono' ? 'monospace' : category === 'serif' ? 'serif' : 'sans-serif';
  const stack = name.includes(' ') ? `"${name}", ${fallback}` : `${name}, ${fallback}`;
  return { name, stack, source: 'google', category };
}
