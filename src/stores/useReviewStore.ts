import {create} from 'zustand';
import {KanjiEntry} from '../types/kanji';
import {QuestionType} from '../types/review';

interface AnswerRecord {
  correct: boolean;
  questionType: QuestionType;
}

interface ReviewState {
  queue: KanjiEntry[];
  currentIndex: number;
  deferred: KanjiEntry[];
  answers: Record<string, AnswerRecord[]>;
  sessionStartedAt: Date | null;

  startSession: (kanji: KanjiEntry[]) => void;
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

  startSession: (kanji) =>
    set({
      queue: kanji,
      currentIndex: 0,
      deferred: [],
      answers: {},
      sessionStartedAt: new Date(),
    }),

  answerCurrent: (correct, questionType) =>
    set(state => {
      const current = state.queue[state.currentIndex];
      if (!current) return state;
      const prev = state.answers[current.id] ?? [];
      return {
        answers: {
          ...state.answers,
          [current.id]: [...prev, {correct, questionType}],
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
      // If we've gone through all original cards, append deferred
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
