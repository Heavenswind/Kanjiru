// Re-exports from useMasterData — backward-compatible drop-in replacement
import type { MasterVocabEntry } from '../types/masterData';

// VocabEntry type alias for backward compatibility
export type VocabPart = { text: string; reading: string | undefined };
export type VocabEntry = MasterVocabEntry;

export {
  useVocabData,
  useVocabForKanji,
  useVocabForKanjiByLevel,
  useVocabForKanjiFiltered,
} from './useMasterData';
