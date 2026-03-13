import {drizzle} from 'drizzle-orm/op-sqlite';
import {open} from '@op-engineering/op-sqlite';
import * as schema from './schema';

export const sqlite = open({name: 'kanji.db'});
export const db = drizzle(sqlite, {schema});

export async function runMigrations() {
  console.log('[DB] runMigrations start');
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS kanji_progress (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      kanji_id TEXT NOT NULL,
      jlpt_level INTEGER NOT NULL,
      srs_level INTEGER NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      interval_days INTEGER NOT NULL DEFAULT 0,
      next_review INTEGER NOT NULL,
      last_review INTEGER,
      learned_at INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);
  await sqlite.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS user_kanji_idx ON kanji_progress (user_id, kanji_id);',
  );
  await sqlite.execute(
    'CREATE INDEX IF NOT EXISTS user_next_review_idx ON kanji_progress (user_id, next_review);',
  );
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS vocab_progress (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      vocab_word TEXT NOT NULL,
      kanji_id TEXT NOT NULL,
      srs_level INTEGER NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      interval_days INTEGER NOT NULL DEFAULT 0,
      next_review INTEGER NOT NULL,
      last_review INTEGER,
      learned_at INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);
  await sqlite.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS user_vocab_idx ON vocab_progress (user_id, vocab_word);',
  );
  await sqlite.execute(
    'CREATE INDEX IF NOT EXISTS user_vocab_next_review_idx ON vocab_progress (user_id, next_review);',
  );
  console.log('[DB] runMigrations done');
}
