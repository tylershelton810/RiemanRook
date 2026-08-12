alter table public.lobbies
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_lobby_on_membership_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.lobbies
  set updated_at = now()
  where id = coalesce(new.lobby_id, old.lobby_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists lobby_membership_changed on public.lobby_players;
create trigger lobby_membership_changed
  after insert or update or delete on public.lobby_players
  for each row execute procedure public.touch_lobby_on_membership_change();
