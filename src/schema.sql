-- Bot tables for Neon Postgres. Idempotent: runs on every startup, after the
-- closet tables in db/schema.sql (items, outfits, wears), which the closet
-- module owns. Follows the data model in PLAN.md.

create table if not exists users (
  id             text primary key,                -- iMessage sender (phone number or email); items.user_id
  step           text not null default 'city',    -- 'city' (onboarding) | 'city_pick' (choosing from a list) | 'done'
  name           text,
  city           text,                            -- for season-aware logic
  web_token      text not null unique,            -- random id in the wardrobe page URL
  fit_check_hour smallint default 9                -- daily ping hour, server local time; null = off
                 check (fit_check_hour between 0 and 23),
  last_fit_ping  text,                            -- local date (YYYY-MM-DD) of the last daily ping
  last_fit_photo text,                            -- local date of the last fit check photo
  created_at     timestamptz not null default now()
);

-- Image bytes for photos users text in. outfits.photo_url (and later
-- items.photo_url) point at /photos/<id> on our web server, so the bot needs
-- no blob storage and the vision model can fetch images by URL.
create table if not exists photos (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null references users (id) on delete cascade,
  image      bytea not null,
  mime_type  text not null,
  created_at timestamptz not null default now()
);

create table if not exists reminders (
  id      uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  text    text not null,
  due_at  timestamptz not null,
  sent    boolean not null default false
);
create index if not exists reminders_due on reminders (due_at) where not sent;

-- items.purchase_id holds a purchases.id (as text) for items that came from an order.
create table if not exists purchases (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null references users (id) on delete cascade,
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

-- Places offered when a city name matched several ("Detroit, Michigan",
-- "Detroit, Texas"...), as a JSON array, while step = 'city_pick'.
alter table users add column if not exists city_options text;
