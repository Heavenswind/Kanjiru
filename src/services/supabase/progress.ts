import {supabase} from './client';
import {KanjiProgress, VocabProgress} from '../../types/kanji';

export async function fetchProgress(userId: string): Promise<KanjiProgress[]> {
  const {data, error} = await supabase
    .from('kanji_progress')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map(row => ({
    id: row.id,
    userId: row.user_id,
    kanjiId: row.kanji_id,
    jlptLevel: row.jlpt_level,
    srsLevel: row.srs_level,
    repetitions: row.repetitions,
    easeFactor: row.ease_factor,
    intervalDays: row.interval_days,
    nextReview: new Date(row.next_review),
    lastReview: row.last_review ? new Date(row.last_review) : null,
    learnedAt: row.learned_at ? new Date(row.learned_at) : null,
  }));
}

export async function upsertProgress(progress: KanjiProgress): Promise<void> {
  const {error} = await supabase.from('kanji_progress').upsert(
    {
      id: progress.id,
      user_id: progress.userId,
      kanji_id: progress.kanjiId,
      jlpt_level: progress.jlptLevel,
      srs_level: progress.srsLevel,
      repetitions: progress.repetitions,
      ease_factor: progress.easeFactor,
      interval_days: progress.intervalDays,
      next_review: progress.nextReview.toISOString(),
      last_review: progress.lastReview?.toISOString() ?? null,
      learned_at: progress.learnedAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    },
    {onConflict: 'user_id,kanji_id'},
  );
  if (error) throw error;
}

export async function upsertVocabProgress(progress: VocabProgress): Promise<void> {
  const {error} = await supabase.from('vocab_progress').upsert(
    {
      id: progress.id,
      user_id: progress.userId,
      vocab_word: progress.vocabWord,
      kanji_id: progress.kanjiId,
      srs_level: progress.srsLevel,
      repetitions: progress.repetitions,
      ease_factor: progress.easeFactor,
      interval_days: progress.intervalDays,
      next_review: progress.nextReview.toISOString(),
      last_review: progress.lastReview?.toISOString() ?? null,
      learned_at: progress.learnedAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    },
    {onConflict: 'user_id,vocab_word'},
  );
  if (error) throw error;
}

export async function fetchVocabProgress(userId: string): Promise<VocabProgress[]> {
  const {data, error} = await supabase
    .from('vocab_progress')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map(row => ({
    id: row.id,
    userId: row.user_id,
    vocabWord: row.vocab_word,
    kanjiId: row.kanji_id,
    srsLevel: row.srs_level,
    repetitions: row.repetitions,
    easeFactor: row.ease_factor,
    intervalDays: row.interval_days,
    nextReview: new Date(row.next_review),
    lastReview: row.last_review ? new Date(row.last_review) : null,
    learnedAt: row.learned_at ? new Date(row.learned_at) : null,
  }));
}

export async function deleteAllProgressForUser(userId: string): Promise<void> {
  const {error: e1} = await supabase.from('kanji_progress').delete().eq('user_id', userId);
  if (e1) throw e1;
  const {error: e2} = await supabase.from('vocab_progress').delete().eq('user_id', userId);
  if (e2) throw e2;
}

export async function logReviewSession(session: {
  userId: string;
  startedAt: Date;
  endedAt: Date;
  cardsReviewed: number;
  cardsCorrect: number;
  cardsDeferred: number;
  jlptLevel?: number;
}): Promise<void> {
  const {error} = await supabase.from('review_sessions').insert({
    user_id: session.userId,
    started_at: session.startedAt.toISOString(),
    ended_at: session.endedAt.toISOString(),
    cards_reviewed: session.cardsReviewed,
    cards_correct: session.cardsCorrect,
    cards_deferred: session.cardsDeferred,
    jlpt_level: session.jlptLevel ?? null,
  });
  if (error) throw error;
}
