-- 011: Keep "Your tables" ordering current with the most recently played game
-- first. The lobbies.updated_at column already exists (added in 007); this
-- extends it to bump on direct lobby edits and on every game_sessions write
-- (game moves, bids, cards).

create or replace function public.touch_lobby_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lobbies_touch_updated_at on public.lobbies;
create trigger lobbies_touch_updated_at
  before update on public.lobbies
  for each row execute function public.touch_lobby_updated_at();

-- security definer: members (not just the host) may update an active
-- game_sessions row, and that must bump the parent lobby without tripping
-- the host-only lobbies RLS.
create or replace function public.bump_lobby_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lobbies set updated_at = now() where id = new.lobby_id;
  return new;
end;
$$;

drop trigger if exists game_sessions_touch_lobby on public.game_sessions;
create trigger game_sessions_touch_lobby
  after insert or update on public.game_sessions
  for each row execute function public.bump_lobby_activity();
