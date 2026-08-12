create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  stats_public boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.rulesets (
  id text primary key,
  name text not null unique,
  config jsonb not null,
  created_at timestamptz not null default now()
);

create table public.lobbies (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  host_id uuid not null references public.profiles(id),
  status text not null default 'waiting' check (status in ('waiting','in_progress','finished')),
  settings jsonb not null default '{"ruleset":"rieman-rules","turnTimer":30}'::jsonb,
  seats jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.lobby_players (
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seat_index integer not null check (seat_index between 0 and 3),
  team text not null check (team in ('A','B')),
  is_host boolean not null default false,
  connected_at timestamptz not null default now(),
  primary key (lobby_id, user_id),
  unique (lobby_id, seat_index)
);

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id),
  ruleset_id text not null references public.rulesets(id),
  status text not null default 'active' check (status in ('active','completed','unfinished')),
  game_state jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.player_statistics (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  games_won integer not null default 0,
  games_lost integer not null default 0,
  games_unfinished integer not null default 0,
  games_completed integer not null default 0,
  hands_played integer not null default 0,
  hands_bid integer not null default 0,
  winning_bids integer not null default 0,
  favorite_colors jsonb not null default '{}'::jsonb,
  favorite_partners jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.lobbies enable row level security;
alter table public.lobby_players enable row level security;
alter table public.game_sessions enable row level security;
alter table public.player_statistics enable row level security;

create policy "profiles are readable" on public.profiles for select using (true);
create policy "users manage own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "authenticated users can create lobbies" on public.lobbies for insert with check (auth.uid() = host_id);
create policy "lobby hosts manage lobbies" on public.lobbies for all using (auth.uid() = host_id) with check (auth.uid() = host_id);
create policy "players can read active lobbies" on public.lobbies for select using (auth.uid() is not null);
create policy "players can read lobby members" on public.lobby_players for select using (auth.uid() is not null);
create policy "users can join lobbies" on public.lobby_players for insert with check (auth.uid() = user_id);
create policy "users can update their lobby seat" on public.lobby_players for update using (auth.uid() = user_id);
create policy "players can read sessions" on public.game_sessions for select using (auth.uid() is not null);
create policy "players can read public stats" on public.player_statistics for select using (auth.uid() is not null);

insert into public.rulesets (id, name, config) values ('rieman-rules', 'Rieman Rules', '{"winningScore":500,"cardsPerPlayer":13,"kittySize":5,"bidMinimum":65,"bidIncrement":5,"bidMaximum":110,"turnTimerSeconds":30,"clockwise":true}'::jsonb)
on conflict (id) do nothing;
