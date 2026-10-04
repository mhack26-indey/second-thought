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
  source          TEXT NOT NULL CHECK (source IN ('fit_check', 'closet', 'order', 'text')),
  purchase_id     TEXT,
  location        TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'removed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- When `location` was last set ("under-bed bin, since Sep 12").
ALTER TABLE items ADD COLUMN IF NOT EXISTS location_set_at TIMESTAMPTZ;

-- How many identical pieces this item is (three of the same white tee).
ALTER TABLE items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1);

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

-- Pairs of distinct items the vision comparison rated "similar" (a near-duplicate:
-- owning one makes the other redundant, like two navy polos), recorded at ingest.
-- "What should I get rid of?" uses them. Stored once per pair, smaller id first.
CREATE TABLE IF NOT EXISTS item_alike (
  item_id  INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  other_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, other_id),
  CHECK (item_id < other_id)
);
