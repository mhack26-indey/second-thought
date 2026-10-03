-- Closet schema (vision-matching-plan.md section 4). Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS items (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN
                    ('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory', 'jewelry')),
  type            TEXT NOT NULL,
  color_primary   TEXT NOT NULL,
  color_secondary TEXT,
  pattern         TEXT NOT NULL,
  fit             TEXT NOT NULL,
  season          TEXT NOT NULL CHECK (season IN ('warm', 'cold', 'all')),
  description     TEXT NOT NULL,
  photo_url       TEXT,
  source          TEXT NOT NULL CHECK (source IN ('fit_check', 'closet', 'order')),
  purchase_id     TEXT,
  location        TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'removed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The one query that has to be fast: candidates for match/dedup.
CREATE INDEX IF NOT EXISTS items_user_category_idx ON items (user_id, category);

CREATE TABLE IF NOT EXISTS outfits (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    TEXT NOT NULL,
  photo_url  TEXT,
  taken_on   DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outfits_user_taken_on_idx ON outfits (user_id, taken_on);

CREATE TABLE IF NOT EXISTS wears (
  item_id   INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  outfit_id INTEGER NOT NULL REFERENCES outfits (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, outfit_id)
);

CREATE INDEX IF NOT EXISTS wears_outfit_id_idx ON wears (outfit_id);
