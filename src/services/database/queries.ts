import {and, eq, lte} from 'drizzle-orm';
import {uuid} from '../../utils/kanjiUtils';
import {db, sqlite} from './client';
import {kanjiProgress} from './schema';
import {KanjiProgress} from '../../types/kanji';

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
