import vocabData from '../data/vocab.json';
import kanjiData from '../data/kanji.json';

export type VocabPart = {
  text: string;    // kanji or kana segment
  reading: string | undefined; // hiragana reading (undefined for plain kana segments)
};

export type VocabEntry = {
  word: string;
  reading: string;
  meaning: string;
  jlptLevel: number;
  common: boolean;
  parts: VocabPart[] | null;
  kanjiUsed: string[];
};

const vocab = vocabData as Record<string, VocabEntry[]>;
const kanjiOnYomi: Record<string, Set<string>> = {};
for (const k of kanjiData as {character: string; readings_on: string[]}[]) {
  kanjiOnYomi[k.character] = new Set(k.readings_on);
}

/** Returns true if the target kanji is read with its on-yomi in this vocab entry */
function usesOnYomi(entry: VocabEntry, character: string): boolean {
  if (!entry.parts) return false;
  const onReadings = kanjiOnYomi[character];
  if (!onReadings || onReadings.size === 0) return false;
  const part = entry.parts.find(p => p.text === character);
  return part?.reading != null && onReadings.has(part.reading);
}

export function useVocabData() {
  return vocab;
}

export function useVocabForKanji(character: string): VocabEntry[] {
  return vocab[character] ?? [];
}

/**
 * Returns vocab entries for a kanji filtered to words where every kanji
 * in the word is in the enrolledKanji set — so the user already knows all
 * the characters used. Falls back to single-kanji / kana-only words if
 * nothing passes the filter.
 */
export function useVocabForKanjiFiltered(
  character: string,
  enrolledKanji: Set<string>,
): VocabEntry[] {
  const all = vocab[character] ?? [];
  const filtered = all.filter(v =>
    v.kanjiUsed.every(k => enrolledKanji.has(k)),
  );
  // Sort: on-yomi usages first, then kun-yomi
  function sortByYomi(entries: VocabEntry[]) {
    return [...entries].sort((a, b) => {
      const aOn = usesOnYomi(a, character) ? 0 : 1;
      const bOn = usesOnYomi(b, character) ? 0 : 1;
      return aOn - bOn;
    });
  }

  if (filtered.length > 0) return sortByYomi(filtered);
  const simple = all.filter(v => v.kanjiUsed.length <= 1);
  return sortByYomi(simple.length > 0 ? simple : all);
}
