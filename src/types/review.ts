import {KanjiEntry} from './kanji';

export type QuestionType = 'meaning' | 'onyomi' | 'kunyomi' | 'reading';

export interface QuizQuestion {
  kanji: KanjiEntry;
  type: QuestionType;
  correctAnswer: string;
  choices: string[];  // 4 options, shuffled, includes correctAnswer
}

export interface ReviewSession {
  queue: KanjiEntry[];
  currentIndex: number;
  deferred: KanjiEntry[];
  answers: Record<string, {correct: boolean; questionType: QuestionType}[]>;
}

// ── Vocab review ──────────────────────────────────────────────────────────────

export interface VocabEntry {
  word: string;
  reading: string;
  meaning: string;
  jlptLevel: number;
  mnemonic?: string;
}

export interface KanjiReviewItem {
  kind: 'kanji';
  kanji: KanjiEntry;
}

export interface VocabReviewItem {
  kind: 'vocab';
  vocab: VocabEntry;
  kanjiId: string;
  questionType: 'meaning' | 'reading';
}

export type ReviewItem = KanjiReviewItem | VocabReviewItem;

// Stable ID for tracking answers
export function reviewItemId(item: ReviewItem): string {
  if (item.kind === 'kanji') return item.kanji.id;
  return `vocab:${item.questionType}:${item.vocab.word}`;
}
