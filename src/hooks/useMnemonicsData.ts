import mnemonicsData from '../data/mnemonics.json';

export type MnemonicEntry = {
  meaning: string;
  onyomi?: string;
  kunyomi?: string;
};

const mnemonics = mnemonicsData as Record<string, MnemonicEntry>;

export function useMnemonicsData() {
  return mnemonics;
}

export function useMnemonicForKanji(character: string): MnemonicEntry | null {
  return mnemonics[character] ?? null;
}
