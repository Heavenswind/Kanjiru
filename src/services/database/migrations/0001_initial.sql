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

CREATE UNIQUE INDEX IF NOT EXISTS user_kanji_idx ON kanji_progress (user_id, kanji_id);
CREATE INDEX IF NOT EXISTS user_next_review_idx ON kanji_progress (user_id, next_review);
