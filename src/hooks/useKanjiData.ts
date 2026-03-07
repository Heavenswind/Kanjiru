import {useMemo} from 'react';
import kanjiData from '../data/kanji.json';
import {KanjiEntry} from '../types/kanji';
import {groupByJlpt} from '../utils/kanjiUtils';

const allKanji = kanjiData as KanjiEntry[];

export function useKanjiData() {
  return allKanji;
}

export function useAllKanji(): KanjiEntry[] {
  return allKanji;
}

export function useKanjiByLevel(jlptLevel: number): KanjiEntry[] {
  return useMemo(
    () => allKanji.filter(k => k.jlptLevel === jlptLevel),
    [jlptLevel],
  );
}

export function useKanjiById(id: string): KanjiEntry | undefined {
  return useMemo(() => allKanji.find(k => k.id === id), [id]);
}

export function useKanjiGrouped(): Record<number, KanjiEntry[]> {
  return useMemo(() => groupByJlpt(allKanji), []);
}
