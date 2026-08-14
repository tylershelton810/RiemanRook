-- 009: Give every lobby a memorable name so players can find their tables again.
-- Existing lobbies get a random playful name; new lobbies are named by the app
-- at creation time (random by default, overridable by the host).

alter table public.lobbies
  add column if not exists name text not null default 'Crow Table';

update public.lobbies
set name = (
  select (array[
    'Midnight Rooks', 'Rowdy Crows', 'Hollow Oak', 'Silver Beak',
    'Thistle Table', 'Moonlit Roost', 'Whistling Crows', 'Smoke & Feathers',
    'Blue Ridge Rooks', 'Gilded Perch', 'Scrappy Crows', 'Long Meadow',
    'Cinder Hill', 'Rook & Thorn', 'Dusty Wings', 'Copper Crest'
  ])[1 + floor(random() * 16)::int]
)
where name = 'Crow Table';
