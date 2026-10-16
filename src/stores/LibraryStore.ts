import { create } from 'zustand';
import type { CostLibrary, LibraryEntry } from '../types/library';

interface LibraryState {
  library: CostLibrary | null;
  loadLibrary: (lib: CostLibrary) => void;
  getLibrary: () => CostLibrary | null;
  addOrUpdateEntry: (entry: LibraryEntry) => void;
  clearLibrary: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  library: null,

  loadLibrary: (lib: CostLibrary) => {
    set({ library: lib });
  },

  getLibrary: () => get().library,

  addOrUpdateEntry: (entry: LibraryEntry) => {
    const { library } = get();
    const key = `${entry.taloCode}|${entry.elementType}|${entry.namePattern ?? ''}`;
    const entries = library?.entries ?? [];
    const idx = entries.findIndex(
      (e) =>
        e.taloCode === entry.taloCode &&
        e.elementType === entry.elementType &&
        (e.namePattern ?? '') === (entry.namePattern ?? '')
    );
    const nextEntries =
      idx >= 0
        ? entries.map((e, i) => (i === idx ? entry : e))
        : [...entries, entry];
    set({
      library: {
        version: library?.version ?? '1.0',
        updatedAt: new Date().toISOString().slice(0, 10),
        metadata: library?.metadata,
        entries: nextEntries,
      },
    });
  },

  clearLibrary: () => set({ library: null }),
}));
