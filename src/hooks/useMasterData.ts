import {useMemo} from 'react';
import rawData from '../data/masterDataWithMnemonics.json';
import type {
  RawMasterKanji,
  RawMasterVocab,
  MasterKanjiEntry,
  MasterVocabEntry,
  MasterRadicalEntry,
} from '../types/masterData';
export type MnemonicEntry = {
  meaning: string;
  onyomi?: string;
  kunyomi?: string;
};

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeKanji(raw: RawMasterKanji): MasterKanjiEntry {
  return {
    id: raw.character,
    character: raw.character,
    jlptLevel: raw.jlptLevel,
    meanings: [raw.meaning],
    readings_on: raw.readings.on.map(r => r.kana),
    readings_kun: raw.readings.kun.map(r => r.kana),
    radicals: raw.radicals,
    strokes: 0,
    readings: raw.readings,
    primaryReading: raw.primaryReading,
    primaryReadingIPA: raw.primaryReadingIPA,
    isPictographic: raw.isPictographic,
    mnemonic_meaning: raw.mnemonic_meaning,
    mnemonic_reading: raw.mnemonic_reading,
  };
}

function normalizeVocab(raw: RawMasterVocab): MasterVocabEntry {
  const parts = raw.decomposition.length > 0
    ? raw.decomposition.map(p => ({
        text: p.text,
        reading: p.reading ?? undefined,
      }))
    : null;

  return {
    word: raw.word,
    reading: raw.reading,
    meaning: raw.meaning,
    pos: raw.pos,
    jlptLevel: raw.jlptLevel,
    common: false,
    parts,
    kanjiUsed: raw.kanjiUsed,
    decomposition: raw.decomposition,
    mnemonic_meaning: raw.mnemonic_meaning,
    mnemonic_reading: raw.mnemonic_reading,
  };
}

// ─── Module-level lookups (built once at load time) ───────────────────────────

const items = rawData as any[];

export const allKanjiEntries: MasterKanjiEntry[] = items
  .filter(x => x.type === 'kanji')
  .map(normalizeKanji);

export const allVocabFlat: MasterVocabEntry[] = items
  .filter(x => x.type === 'vocab')
  .map(normalizeVocab);

export const allRadicals: MasterRadicalEntry[] = items
  .filter(x => x.type === 'radical')
  .map(x => ({ id: x.id, name: x.name, character: x.character }));

const kanjiByCharacter: Record<string, MasterKanjiEntry> =
  Object.fromEntries(allKanjiEntries.map(k => [k.character, k]));

// keyed by each kanjiUsed character — same structure as old vocab.json
const vocabByKanji: Record<string, MasterVocabEntry[]> = {};
for (const v of allVocabFlat) {
  for (const char of v.kanjiUsed) {
    (vocabByKanji[char] ??= []).push(v);
  }
}

// on-yomi set per kanji — for usesOnYomi sort
const kanjiOnYomi: Record<string, Set<string>> = {};
for (const k of allKanjiEntries) {
  kanjiOnYomi[k.character] = new Set(k.readings_on);
}

function usesOnYomi(entry: MasterVocabEntry, character: string): boolean {
  if (!entry.parts) return false;
  const onReadings = kanjiOnYomi[character];
  if (!onReadings || onReadings.size === 0) return false;
  const part = entry.parts.find(p => p.text === character);
  return part?.reading != null && onReadings.has(part.reading);
}

// ─── Kanji hooks ──────────────────────────────────────────────────────────────

export function useKanjiData(): MasterKanjiEntry[] {
  return allKanjiEntries;
}

export function useAllKanji(): MasterKanjiEntry[] {
  return allKanjiEntries;
}

export function useKanjiByLevel(jlptLevel: number): MasterKanjiEntry[] {
  return useMemo(
    () => allKanjiEntries.filter(k => k.jlptLevel === jlptLevel),
    [jlptLevel],
  );
}

export function useKanjiById(id: string): MasterKanjiEntry | undefined {
  return useMemo(() => kanjiByCharacter[id], [id]);
}

export function useKanjiGrouped(): Record<number, MasterKanjiEntry[]> {
  return useMemo(() => {
    const grouped: Record<number, MasterKanjiEntry[]> = {};
    for (const k of allKanjiEntries) {
      (grouped[k.jlptLevel] ??= []).push(k);
    }
    return grouped;
  }, []);
}

// ─── Vocab hooks ──────────────────────────────────────────────────────────────

export function useVocabData(): Record<string, MasterVocabEntry[]> {
  return vocabByKanji;
}

export function useVocabForKanji(character: string): MasterVocabEntry[] {
  return vocabByKanji[character] ?? [];
}

export function useVocabForKanjiByLevel(
  character: string,
  levelKanjiIds: Set<string>,
): MasterVocabEntry[] {
  const all = vocabByKanji[character] ?? [];

  function sort(entries: MasterVocabEntry[]) {
    return [...entries].sort((a, b) => {
      if (a.jlptLevel !== b.jlptLevel) return b.jlptLevel - a.jlptLevel;
      return 0;
    });
  }

  const filtered = all.filter(v => v.kanjiUsed.every(k => levelKanjiIds.has(k)));
  if (filtered.length > 0) return sort(filtered);
  const simple = all.filter(v => v.kanjiUsed.length <= 1);
  return sort(simple.length > 0 ? simple : all);
}

export function useVocabForKanjiFiltered(
  character: string,
  enrolledKanji: Set<string>,
): MasterVocabEntry[] {
  const all = vocabByKanji[character] ?? [];

  function sortByYomi(entries: MasterVocabEntry[]) {
    return [...entries].sort((a, b) => {
      const aOn = usesOnYomi(a, character) ? 0 : 1;
      const bOn = usesOnYomi(b, character) ? 0 : 1;
      return aOn - bOn;
    });
  }

  const filtered = all.filter(v => v.kanjiUsed.every(k => enrolledKanji.has(k)));
  if (filtered.length > 0) return sortByYomi(filtered);
  const simple = all.filter(v => v.kanjiUsed.length <= 1);
  return sortByYomi(simple.length > 0 ? simple : all);
}

// ─── Mnemonic hook (MnemonicEntry-compatible return) ─────────────────────────

export function useMnemonicsData(): Record<string, MnemonicEntry> {
  const result: Record<string, MnemonicEntry> = {};
  for (const k of allKanjiEntries) {
    if (k.mnemonic_meaning || k.mnemonic_reading) {
      result[k.character] = {
        meaning: k.mnemonic_meaning ?? '',
        onyomi: k.mnemonic_reading,
      };
    }
  }
  return result;
}

export function useMnemonicForKanji(character: string): MnemonicEntry | null {
  const k = kanjiByCharacter[character];
  if (!k || (!k.mnemonic_meaning && !k.mnemonic_reading)) return null;
  return {
    meaning: k.mnemonic_meaning ?? '',
    onyomi: k.mnemonic_reading,
    kunyomi: undefined,
  };
}
