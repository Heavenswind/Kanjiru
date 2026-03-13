export interface KanjiEntry {
  id: string;           // the kanji character itself
  character: string;
  jlptLevel: 1 | 2 | 3 | 4 | 5;  // 5=N5 (easiest), 1=N1 (hardest)
  strokes: number;
  meanings: string[];
  readings_on: string[];
  readings_kun: string[];
  radicals: string[];
}

export interface VocabProgress {
  id: string;
  userId: string;
  vocabWord: string;
  kanjiId: string;
  srsLevel: number;
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  nextReview: Date;
  lastReview: Date | null;
  learnedAt: Date | null;
}

export interface KanjiProgress {
  id: string;
  userId: string;
  kanjiId: string;
  jlptLevel: number;
  srsLevel: number;
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  nextReview: Date;
  lastReview: Date | null;
  learnedAt: Date | null;
}
