import {KanjiProgress} from '../../types/kanji';
import {sm2, Grade, nextReviewDate, SrsItem} from './sm2';

export function isDue(progress: KanjiProgress): boolean {
  return new Date(progress.nextReview) <= new Date();
}

export function gradeCard(
  progress: KanjiProgress,
  grade: Grade,
): Partial<KanjiProgress> {
  const item: SrsItem = {
    repetitions: progress.repetitions,
    intervalDays: progress.intervalDays,
    easeFactor: progress.easeFactor,
  };
  const updated = sm2(item, grade);
  return {
    ...updated,
    srsLevel: Math.min(8, updated.repetitions),
    nextReview: nextReviewDate(updated.intervalDays),
    lastReview: new Date(),
  };
}

export function buildNewProgress(
  userId: string,
  kanjiId: string,
  jlptLevel: number,
): Omit<KanjiProgress, 'id'> {
  return {
    userId,
    kanjiId,
    jlptLevel,
    srsLevel: 0,
    repetitions: 0,
    easeFactor: 2.5,
    intervalDays: 0,
    nextReview: new Date(),
    lastReview: null,
    learnedAt: new Date(),
  };
}

// For kanji the user marks as already known — enroll at a high SRS level
// so they appear in reviews ~3 weeks out rather than immediately.
export function buildKnownProgress(
  userId: string,
  kanjiId: string,
  jlptLevel: number,
): Omit<KanjiProgress, 'id'> {
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + 21);
  return {
    userId,
    kanjiId,
    jlptLevel,
    srsLevel: 5,
    repetitions: 5,
    easeFactor: 2.5,
    intervalDays: 21,
    nextReview,
    lastReview: null,
    learnedAt: new Date(),
  };
}
