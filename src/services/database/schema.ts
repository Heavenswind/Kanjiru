import {integer, real, sqliteTable, text, uniqueIndex} from 'drizzle-orm/sqlite-core';

export const kanjiProgress = sqliteTable(
  'kanji_progress',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    kanjiId: text('kanji_id').notNull(),
    jlptLevel: integer('jlpt_level').notNull(),
    srsLevel: integer('srs_level').notNull().default(0),
    repetitions: integer('repetitions').notNull().default(0),
    easeFactor: real('ease_factor').notNull().default(2.5),
    intervalDays: integer('interval_days').notNull().default(0),
    nextReview: integer('next_review', {mode: 'timestamp'}).notNull(),
    lastReview: integer('last_review', {mode: 'timestamp'}),
    learnedAt: integer('learned_at', {mode: 'timestamp'}),
    updatedAt: integer('updated_at', {mode: 'timestamp'}).notNull(),
  },
  table => ({
    userKanjiIdx: uniqueIndex('user_kanji_idx').on(table.userId, table.kanjiId),
  }),
);
