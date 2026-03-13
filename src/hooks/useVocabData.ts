import vocabData from '../data/vocab.json';

export type VocabEntry = {
  word: string;
  reading: string;
  meaning: string;
  mnemonic?: string;
};

const vocab = vocabData as Record<string, VocabEntry[]>;

export function useVocabData() {
  return vocab;
}

export function useVocabForKanji(character: string): VocabEntry[] {
  return vocab[character] ?? [];
}
