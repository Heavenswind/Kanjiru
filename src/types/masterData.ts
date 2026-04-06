// ─── Raw shapes from masterDataWithMnemonics.json ────────────────────────────

export interface RawReadingEntry {
  kana: string;
  ipa: string | null;
}

export interface RawDecompositionPart {
  text: string;
  reading: string | null;
  readingType: string | null;
  ipa: string | null;
  kanjiMeanings?: string[];
}

export interface RawMasterKanji {
  type: 'kanji';
  id: number;
  character: string;
  jlptLevel: 1 | 2 | 3 | 4 | 5;
  meaning: string;
  readings: { on: RawReadingEntry[]; kun: RawReadingEntry[] };
  primaryReading: string | null;
  primaryReadingIPA: string | null;
  radicals: string[];
  isPictographic: boolean;
  mnemonic_meaning?: string;
  mnemonic_reading?: string;
}

export interface RawMasterVocab {
  type: 'vocab';
  id: number;
  word: string;
  jlptLevel: number;
  meaning: string;
  reading: string;
  readingIPA: string | null;
  pos: string[];
  kanjiUsed: string[];
  decomposition: RawDecompositionPart[];
  mnemonic_meaning?: string;
  mnemonic_reading?: string;
}

export interface RawMasterRadical {
  type: 'radical';
  id: number;
  name: string;
  character: string;
}

export type RawMasterItem = RawMasterKanji | RawMasterVocab | RawMasterRadical;

// ─── Normalized shapes exposed by useMasterData ───────────────────────────────

/** Backward-compatible with KanjiEntry — id === character for SRS key consistency */
export interface MasterKanjiEntry {
  id: string;                  // === character ('一') — matches KanjiProgress.kanjiId
  character: string;
  jlptLevel: 1 | 2 | 3 | 4 | 5;
  meanings: string[];          // [meaning] single-element array
  readings_on: string[];       // kana strings, okurigana-stripped from readings.on
  readings_kun: string[];      // kana strings with markers (ひと-) from readings.kun
  radicals: string[];
  strokes: number;             // 0 — not in masterData, KanjiDetailScreen reads strokes.json directly
  // Extended fields
  readings: RawMasterKanji['readings'];
  primaryReading: string | null;
  primaryReadingIPA: string | null;
  isPictographic: boolean;
  mnemonic_meaning?: string;
  mnemonic_reading?: string;
}

/** Backward-compatible with the vocab shape used in useVocabData */
export interface MasterVocabEntry {
  word: string;
  reading: string;
  meaning: string;
  pos: string[];
  jlptLevel: number;
  common: boolean;             // always false — no common field in masterData
  parts: { text: string; reading?: string }[] | null;
  kanjiUsed: string[];
  decomposition: RawDecompositionPart[];
  mnemonic_meaning?: string;
  mnemonic_reading?: string;
}

export interface MasterRadicalEntry {
  id: number;
  name: string;
  character: string;
}
