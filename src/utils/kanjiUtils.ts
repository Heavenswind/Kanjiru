import {KanjiEntry} from '../types/kanji';
import {stripOkurigana} from '../engine/srs/distractors';

export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function formatReading(reading: string): string {
  return stripOkurigana(reading);
}

export function groupByJlpt(kanji: KanjiEntry[]): Record<number, KanjiEntry[]> {
  return kanji.reduce<Record<number, KanjiEntry[]>>((acc, k) => {
    const level = k.jlptLevel;
    if (!acc[level]) acc[level] = [];
    acc[level].push(k);
    return acc;
  }, {});
}

export const JLPT_LEVELS = [5, 4, 3, 2, 1] as const;

export const SRS_LEVEL_COLORS: Record<number, string> = {
  0: '#555',     // New
  1: '#e94560',  // Apprentice 1
  2: '#e94560',  // Apprentice 2
  3: '#dd7e1b',  // Guru 1
  4: '#dd7e1b',  // Guru 2
  5: '#8858b5',  // Master
  6: '#285393',  // Enlightened
  7: '#0af',     // Burned
  8: '#0af',
};

export function getSrsLabel(level: number): string {
  if (level === 0) return 'New';
  if (level <= 2) return 'Apprentice';
  if (level <= 4) return 'Guru';
  if (level === 5) return 'Master';
  if (level === 6) return 'Enlightened';
  return 'Burned';
}
