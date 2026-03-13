import {create} from 'zustand';
import {KanjiEntry} from '../types/kanji';
import {QuestionType, ReviewItem, reviewItemId} from '../types/review';

interface AnswerRecord {
  correct: boolean;
  questionType: QuestionType;
}

interface ReviewState {
  queue: ReviewItem[];
  currentIndex: number;
  deferred: ReviewItem[];
  answers: Record<string, AnswerRecord[]>;
  sessionStartedAt: Date | null;

  startSession: (items: ReviewItem[]) => void;
  /** Legacy helper — wraps KanjiEntry[] into ReviewItem[] */
  startKanjiSession: (kanji: KanjiEntry[]) => void;
  answerCurrent: (correct: boolean, questionType: QuestionType) => void;
  deferCurrent: () => void;
  advance: () => void;
  resetSession: () => void;
}

export const useReviewStore = create<ReviewState>(set => ({
  queue: [],
  currentIndex: 0,
  deferred: [],
  answers: {},
  sessionStartedAt: null,

  startSession: (items) =>
    set({
      queue: items,
      currentIndex: 0,
      deferred: [],
      answers: {},
      sessionStartedAt: new Date(),
    }),

  startKanjiSession: (kanji) =>
    set({
      queue: kanji.map(k => ({kind: 'kanji' as const, kanji: k})),
      currentIndex: 0,
      deferred: [],
      answers: {},
      sessionStartedAt: new Date(),
    }),

  answerCurrent: (correct, questionType) =>
    set(state => {
      const current = state.queue[state.currentIndex];
      if (!current) return state;
      const id = reviewItemId(current);
      const prev = state.answers[id] ?? [];
      return {
        answers: {
          ...state.answers,
          [id]: [...prev, {correct, questionType}],
        },
      };
    }),

  deferCurrent: () =>
    set(state => {
      const current = state.queue[state.currentIndex];
      if (!current) return state;
      return {deferred: [...state.deferred, current]};
    }),

  advance: () =>
    set(state => {
      const next = state.currentIndex + 1;
      if (next >= state.queue.length && state.deferred.length > 0) {
        return {
          queue: [...state.queue, ...state.deferred],
          deferred: [],
          currentIndex: next,
        };
      }
      return {currentIndex: next};
    }),

  resetSession: () =>
    set({
      queue: [],
      currentIndex: 0,
      deferred: [],
      answers: {},
      sessionStartedAt: null,
    }),
}));
