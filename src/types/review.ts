import {KanjiEntry} from './kanji';

export type QuestionType = 'meaning' | 'onyomi' | 'kunyomi';

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
