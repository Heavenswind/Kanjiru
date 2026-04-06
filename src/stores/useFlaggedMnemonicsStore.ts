import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV({ id: 'flagged-mnemonics' });

const mmkvStorage = {
  getItem: (key: string) => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string) => mmkv.set(key, value),
  removeItem: (key: string) => mmkv.delete(key),
};

interface FlaggedMnemonicsState {
  // key: character/word, value: which fields are flagged
  flagged: Record<string, { meaning?: boolean; reading?: boolean }>;
  flagMeaning: (key: string) => void;
  unflagMeaning: (key: string) => void;
  flagReading: (key: string) => void;
  unflagReading: (key: string) => void;
  toggleMeaning: (key: string) => void;
  toggleReading: (key: string) => void;
  isMeaningFlagged: (key: string) => boolean;
  isReadingFlagged: (key: string) => boolean;
}

export const useFlaggedMnemonicsStore = create<FlaggedMnemonicsState>()(
  persist(
    (set, get) => ({
      flagged: {},

      flagMeaning: (key) =>
        set(s => ({
          flagged: { ...s.flagged, [key]: { ...s.flagged[key], meaning: true } },
        })),
      unflagMeaning: (key) =>
        set(s => {
          const entry = { ...s.flagged[key], meaning: false };
          return { flagged: { ...s.flagged, [key]: entry } };
        }),
      flagReading: (key) =>
        set(s => ({
          flagged: { ...s.flagged, [key]: { ...s.flagged[key], reading: true } },
        })),
      unflagReading: (key) =>
        set(s => {
          const entry = { ...s.flagged[key], reading: false };
          return { flagged: { ...s.flagged, [key]: entry } };
        }),
      toggleMeaning: (key) => {
        const current = get().flagged[key]?.meaning ?? false;
        current ? get().unflagMeaning(key) : get().flagMeaning(key);
      },
      toggleReading: (key) => {
        const current = get().flagged[key]?.reading ?? false;
        current ? get().unflagReading(key) : get().flagReading(key);
      },
      isMeaningFlagged: (key) => get().flagged[key]?.meaning ?? false,
      isReadingFlagged: (key) => get().flagged[key]?.reading ?? false,
    }),
    {
      name: 'flagged-mnemonics',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
