import { create } from 'zustand';

const STORAGE_KEY = 'vasodb:favorites';

interface FavoritesState {
  favorites: Record<string, string[]>; // connectionId -> table names
  isFavorite: (connectionId: string, table: string) => boolean;
  toggleFavorite: (connectionId: string, table: string) => void;
  getFavorites: (connectionId: string) => string[];
}

function loadFavorites(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveFavorites(favorites: Record<string, string[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: loadFavorites(),

  isFavorite: (connectionId, table) => {
    const favs = get().favorites[connectionId] || [];
    return favs.includes(table);
  },

  toggleFavorite: (connectionId, table) => {
    const current = get().favorites[connectionId] || [];
    const updated = current.includes(table)
      ? current.filter((t) => t !== table)
      : [...current, table];
    const favorites = { ...get().favorites, [connectionId]: updated };
    set({ favorites });
    saveFavorites(favorites);
  },

  getFavorites: (connectionId) => {
    return get().favorites[connectionId] || [];
  },
}));
