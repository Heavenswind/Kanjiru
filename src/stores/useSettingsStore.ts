import {create} from 'zustand';
import {persist, createJSONStorage} from 'zustand/middleware';
import {MMKV} from 'react-native-mmkv';

const mmkv = new MMKV({id: 'settings'});

const mmkvStorage = {
  getItem: (key: string) => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string) => mmkv.set(key, value),
  removeItem: (key: string) => mmkv.delete(key),
};

interface SettingsState {
  progressiveUnlock: boolean; // true = must complete N5 before N4, etc.
  setProgressiveUnlock: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    set => ({
      progressiveUnlock: false,
      setProgressiveUnlock: v => set({progressiveUnlock: v}),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
