import {and, eq, lte} from 'drizzle-orm';
import {uuid} from '../../utils/kanjiUtils';
import {db, sqlite} from './client';
import {kanjiProgress, vocabProgress} from './schema';
import {KanjiProgress, VocabProgress} from '../../types/kanji';

function toKanjiProgress(row: typeof kanjiProgress.$inferSelect): KanjiProgress {
  return {
    id: row.id,
    userId: row.userId,
    kanjiId: row.kanjiId,
    jlptLevel: row.jlptLevel,
    srsLevel: row.srsLevel,
    repetitions: row.repetitions,
    easeFactor: row.easeFactor,
    intervalDays: row.intervalDays,
    nextReview: row.nextReview,
    lastReview: row.lastReview ?? null,
    learnedAt: row.learnedAt ?? null,
  };
}

export async function getDueCards(userId: string): Promise<KanjiProgress[]> {
  const rows = await db
    .select()
    .from(kanjiProgress)
    .where(
      and(
        eq(kanjiProgress.userId, userId),
        lte(kanjiProgress.nextReview, new Date()),
      ),
    );
  return rows.map(toKanjiProgress);
}

export async function getProgressForUser(userId: string): Promise<KanjiProgress[]> {
  const rows = await db
    .select()
    .from(kanjiProgress)
    .where(eq(kanjiProgress.userId, userId));
  return rows.map(toKanjiProgress);
}

const UPSERT_SQL = `
  INSERT OR REPLACE INTO kanji_progress
    (id, user_id, kanji_id, jlpt_level, srs_level, repetitions, ease_factor, interval_days, next_review, last_review, learned_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function toParams(progress: Omit<KanjiProgress, 'id'> & {id?: string}, now: number) {
  return [
    progress.id ?? uuid(),
    progress.userId,
    progress.kanjiId,
    progress.jlptLevel,
    progress.srsLevel,
    progress.repetitions,
    progress.easeFactor,
    progress.intervalDays,
    Math.floor(progress.nextReview.getTime() / 1000),
    progress.lastReview ? Math.floor(progress.lastReview.getTime() / 1000) : null,
    progress.learnedAt ? Math.floor(progress.learnedAt.getTime() / 1000) : null,
    now,
  ];
}

export async function upsertProgress(progress: Omit<KanjiProgress, 'id'> & {id?: string}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await sqlite.execute(UPSERT_SQL, toParams(progress, now));
}

export async function upsertProgressBatch(items: Array<Omit<KanjiProgress, 'id'> & {id?: string}>): Promise<void> {
  if (items.length === 0) return;
  console.log('[DB] upsertProgressBatch start, count:', items.length);
  const now = Math.floor(Date.now() / 1000);
  console.log('[DB] BEGIN TRANSACTION');
  await sqlite.execute('BEGIN TRANSACTION');
  console.log('[DB] BEGIN done');
  try {
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const params = toParams(p, now);
      console.log(`[DB] execute ${i + 1}/${items.length}`, params);
      await sqlite.execute(UPSERT_SQL, params);
      console.log(`[DB] execute ${i + 1} done`);
    }
    console.log('[DB] COMMIT');
    await sqlite.execute('COMMIT');
    console.log('[DB] COMMIT done');
  } catch (e) {
    console.error('[DB] error, rolling back:', e);
    await sqlite.execute('ROLLBACK');
    throw e;
  }
}

// ── Vocab progress ────────────────────────────────────────────────────────────

function toVocabProgress(row: typeof vocabProgress.$inferSelect): VocabProgress {
  return {
    id: row.id,
    userId: row.userId,
    vocabWord: row.vocabWord,
    kanjiId: row.kanjiId,
    srsLevel: row.srsLevel,
    repetitions: row.repetitions,
    easeFactor: row.easeFactor,
    intervalDays: row.intervalDays,
    nextReview: row.nextReview,
    lastReview: row.lastReview ?? null,
    learnedAt: row.learnedAt ?? null,
  };
}

export async function getDueVocabCards(userId: string): Promise<VocabProgress[]> {
  const rows = await db
    .select()
    .from(vocabProgress)
    .where(
      and(
        eq(vocabProgress.userId, userId),
        lte(vocabProgress.nextReview, new Date()),
      ),
    );
  return rows.map(toVocabProgress);
}

export async function getVocabProgressForUser(userId: string): Promise<VocabProgress[]> {
  const rows = await db
    .select()
    .from(vocabProgress)
    .where(eq(vocabProgress.userId, userId));
  return rows.map(toVocabProgress);
}

const UPSERT_VOCAB_SQL = `
  INSERT OR REPLACE INTO vocab_progress
    (id, user_id, vocab_word, kanji_id, srs_level, repetitions, ease_factor, interval_days, next_review, last_review, learned_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function toVocabParams(p: VocabProgress, now: number) {
  return [
    p.id,
    p.userId,
    p.vocabWord,
    p.kanjiId,
    p.srsLevel,
    p.repetitions,
    p.easeFactor,
    p.intervalDays,
    Math.floor(p.nextReview.getTime() / 1000),
    p.lastReview ? Math.floor(p.lastReview.getTime() / 1000) : null,
    p.learnedAt ? Math.floor(p.learnedAt.getTime() / 1000) : null,
    now,
  ];
}

export async function upsertVocabProgressBatch(items: VocabProgress[]): Promise<void> {
  if (items.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  await sqlite.execute('BEGIN TRANSACTION');
  try {
    for (const p of items) {
      await sqlite.execute(UPSERT_VOCAB_SQL, toVocabParams(p, now));
    }
    await sqlite.execute('COMMIT');
  } catch (e) {
    await sqlite.execute('ROLLBACK');
    throw e;
  }
}

export async function upsertVocabProgress(p: VocabProgress): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await sqlite.execute(UPSERT_VOCAB_SQL, toVocabParams(p, now));
}

export async function deleteAllProgressForUser(userId: string): Promise<void> {
  await sqlite.execute('BEGIN TRANSACTION');
  try {
    await sqlite.execute('DELETE FROM kanji_progress WHERE user_id = ?', [userId]);
    await sqlite.execute('DELETE FROM vocab_progress WHERE user_id = ?', [userId]);
    await sqlite.execute('COMMIT');
  } catch (e) {
    await sqlite.execute('ROLLBACK');
    throw e;
  }
}
