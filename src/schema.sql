-- Second Thought schema for Neon Postgres. Idempotent: runs on every startup.
-- Follows the data model in PLAN.md.

create extension if not exists vector;

create table if not exists users (
  id             text primary key,                -- iMessage sender (phone number or email)
  step           text not null default 'city',    -- onboarding: 'city' | 'done'
  name           text,
  city           text,                            -- for season-aware logic
  web_token      text not null unique,            -- random id in the wardrobe page URL
  fit_check_hour smallint default 9                -- daily ping hour, server local time; null = off
                 check (fit_check_hour between 0 and 23),
  last_fit_ping  text,                            -- local date (YYYY-MM-DD) of the last daily ping
  last_fit_photo text,                            -- local date of the last fit check photo
  created_at     timestamptz not null default now()
);

-- Fit check photos. Images live in the database so the bot has no local state.
create table if not exists outfits (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references users (id) on delete cascade,
  image       bytea not null,
  mime_type   text not null,
  temperature real,                               -- °C when worn (season-aware ghosts, P2)
  worn_at     timestamptz not null default now()
);
create index if not exists outfits_user on outfits (user_id, worn_at);

create table if not exists items (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null references users (id) on delete cascade,
  name       text not null,                       -- "black straight-leg jeans"
  category   text not null,                       -- tops | bottoms | outerwear | shoes | dresses | accessories | other
  color      text,
  pattern    text,
  season     text,
  source     text not null default 'text',        -- text | fit_check | order | closet_photo
  outfit_id  uuid references outfits (id) on delete set null, -- photo it was extracted from
  embedding  vector,                              -- similarity search; dimension depends on the embedding model
  location   text,                                -- "under-bed bin" (P1)
  status     text not null default 'owned',       -- owned | returned | sold
  added_at   timestamptz not null default now()
);
create index if not exists items_user on items (user_id, added_at);

-- Which items were worn together; powers the outfit-gap logic.
create table if not exists wears (
  item_id   uuid not null references items (id) on delete cascade,
  outfit_id uuid not null references outfits (id) on delete cascade,
  primary key (item_id, outfit_id)
);

create table if not exists reminders (
  id      uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  text    text not null,
  due_at  timestamptz not null,
  sent    boolean not null default false
);
create index if not exists reminders_due on reminders (due_at) where not sent;

create table if not exists purchases (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references items (id) on delete cascade,
  retailer        text,
  price           numeric(10, 2),
  order_date      date,
  return_deadline date,
  status          text not null default 'kept'     -- kept | returning | returned
);

create table if not exists return_policies (
  retailer    text primary key,
  return_days integer not null,
  notes       text
);
