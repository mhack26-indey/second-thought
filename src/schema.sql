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

-- Where to start a return, linked in the reply to "return".
alter table return_policies add column if not exists returns_url text;

-- Return nudges: when the "hasn't shown up in a fit check" nudge went out
-- (claimed before sending, so it goes once), and the keep/return answer.
alter table purchases add column if not exists nudged_at timestamptz;
alter table purchases add column if not exists nudge_answer text;  -- keep | return

-- The impact counter. 'avoided': a shopping check found something they
-- already own (amount = that item's order price, if it came from an order).
-- 'recovered': a purchase went back (amount = its price), counted once per
-- purchase even as it moves from 'returning' to 'returned'. No foreign keys
-- on items or purchases, so taking back a fit check can't erase a count.
create table if not exists impact_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references users (id) on delete cascade,
  kind        text not null check (kind in ('avoided', 'recovered')),
  amount      numeric(10, 2),
  item_id     integer not null,
  purchase_id uuid,
  created_at  timestamptz not null default now()
);
create index if not exists impact_events_user on impact_events (user_id);
create unique index if not exists impact_events_recovered_once on impact_events (purchase_id) where kind = 'recovered';
-- 'sold' / 'donated': they let an item go so someone else wears it (amount =
-- what they sold it for, if they said), once per item. Added after the table
-- existed, so the check is replaced. Thrown away counts nothing.
alter table impact_events drop constraint if exists impact_events_kind_check;
alter table impact_events add constraint impact_events_kind_check check (kind in ('avoided', 'recovered', 'sold', 'donated'));
create unique index if not exists impact_events_let_go_once on impact_events (item_id) where kind in ('sold', 'donated');

-- Return windows for retailers students use most, in days from the order
-- date. Standard online policy as of Oct 2026. Replies tell people to verify
-- on the retailer's site, since policies change and vary by item and member
-- tier. Re-running updates the rows, so editing one here is the migration.
-- Returns pages checked Oct 3, 2026 (H&M, Adidas, American Eagle, Urban
-- Outfitters and Lululemon block automated checks, so theirs are unchecked).
insert into return_policies (retailer, return_days, notes, returns_url) values
  ('Amazon',            30, 'most clothing, from delivery',          'https://www.amazon.com/returns'),
  ('Target',            90, 'most items',                            'https://www.target.com/returns'),
  ('H&M',               30, null,                                    'https://www2.hm.com/en_us/customer-service/returns.html'),
  ('Zara',              30, null,                                    'https://www.zara.com/us/en/help-center/HowToReturn'),
  ('Uniqlo',            30, null,                                    'https://www.uniqlo.com/us/en/returns'),
  ('Nike',              60, null,                                    'https://www.nike.com/help/a/returns-policy'),
  ('Adidas',            30, null,                                    'https://www.adidas.com/us/help/us-returns-refunds'),
  ('Abercrombie',       30, null,                                    'https://www.abercrombie.com/shop/us/help/returns'),
  ('American Eagle',    30, null,                                    'https://www.ae.com/us/en/content/help/returns'),
  ('Urban Outfitters',  30, null,                                    'https://www.urbanoutfitters.com/help/returns'),
  ('Lululemon',         30, 'unworn with tags',                      'https://shop.lululemon.com/help/returns'),
  ('Gap',               30, null,                                    'https://www.gap.com/returns'),
  ('Old Navy',          30, null,                                    'https://oldnavy.gap.com/returns'),
  ('Nordstrom',         30, 'no fixed window, handled case by case', 'https://www.nordstrom.com/browse/services/return-policy'),
  ('Shein',             30, null,                                    'https://us.shein.com/Return-Policy-a-281.html')
on conflict (retailer) do update
  set return_days = excluded.return_days, notes = excluded.notes, returns_url = excluded.returns_url;
