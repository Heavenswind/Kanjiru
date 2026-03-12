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
  // Learning
  progressiveUnlock: boolean; // must complete N5 before N4, etc.
  lessonsPerSession: number;  // how many kanji to enroll per lesson batch (5–20)
  autoShowReadings: boolean;  // auto-expand readings on lesson cards
  // Stroke animation
  strokeSpeed: number; // multiplier: 0.5 = fast, 1 = normal, 2 = slow
  // Review
  autoAdvanceOnCorrect: boolean; // auto-move to next card after correct answer

  setProgressiveUnlock: (v: boolean) => void;
  setLessonsPerSession: (v: number) => void;
  setAutoShowReadings: (v: boolean) => void;
  setStrokeSpeed: (v: number) => void;
  setAutoAdvanceOnCorrect: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    set => ({
      progressiveUnlock: false,
      lessonsPerSession: 10,
      autoShowReadings: false,
      strokeSpeed: 1,
      autoAdvanceOnCorrect: false,

      setProgressiveUnlock: v => set({progressiveUnlock: v}),
      setLessonsPerSession: v => set({lessonsPerSession: v}),
      setAutoShowReadings: v => set({autoShowReadings: v}),
      setStrokeSpeed: v => set({strokeSpeed: v}),
      setAutoAdvanceOnCorrect: v => set({autoAdvanceOnCorrect: v}),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
