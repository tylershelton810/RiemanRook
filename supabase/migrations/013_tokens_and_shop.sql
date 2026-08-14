-- 013: Tokens & crow-face shop
--
-- Winning a completed game earns tokens for everyone on the winning team.
-- Tokens are spent in the Settings shop on the built-in crow faces
-- (10 tokens each). Unlike statistics, token rewards are NOT skipped when
-- AI sits at the table — every win counts.
--
-- Payout scale (winningScore => tokens per winning player):
--   500 => 2, 750 => 3, 1000 => 4  (formula: floor(score / 250), min 1)

alter table public.profiles
  add column if not exists tokens integer not null default 0;

alter table public.profiles
  add column if not exists purchased_crow_logos text[] not null default '{}';

alter table public.game_sessions
  add column if not exists tokens_applied boolean not null default false;

create or replace function public.award_tokens_for_completed_game(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.game_sessions;
  winning_score int;
  tokens_per_winner int;
  winner_team text;
  player jsonb;
  player_team text;
  player_id uuid;
begin
  select * into session_row from public.game_sessions where id = p_session_id for update;
  if not found or session_row.tokens_applied then return; end if;
  if session_row.status <> 'completed' then
    update public.game_sessions set tokens_applied = true where id = p_session_id;
    return;
  end if;
  winning_score := coalesce((session_row.game_state->>'winningScore')::int, 500);
  tokens_per_winner := greatest(1, floor(winning_score / 250.0))::int;
  winner_team := session_row.game_state->'hand'->>'gameWinner';
  for player in select * from jsonb_array_elements(session_row.game_state->'players') loop
    -- AI seats carry non-uuid ids; only real users earn tokens.
    if (player->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then continue; end if;
    player_team := player->>'team';
    if player_team <> winner_team then continue; end if;
    player_id := (player->>'id')::uuid;
    update public.profiles
      set tokens = public.profiles.tokens + tokens_per_winner
      where id = player_id;
  end loop;
  update public.game_sessions set tokens_applied = true where id = p_session_id;
end;
$$;

grant execute on function public.award_tokens_for_completed_game(uuid) to authenticated;

-- Shop: buy a built-in crow face for a fixed token price (idempotent).

create or replace function public.purchase_crow_logo(p_logo_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles;
begin
  if p_logo_id is null or p_logo_id = '' or p_logo_id = 'classic' then
    raise exception 'The classic crow is already yours.';
  end if;
  if p_logo_id not in ('bird','party','cool','crown','chef') then
    raise exception 'That crow face cannot be bought here.';
  end if;
  select * into profile_row from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Profile not found.'; end if;
  if p_logo_id = any(profile_row.purchased_crow_logos) then
    return profile_row.tokens;
  end if;
  if profile_row.tokens < 10 then
    raise exception 'You need 10 tokens for that crow face.';
  end if;
  update public.profiles
    set tokens = profile_row.tokens - 10,
        purchased_crow_logos = array_append(profile_row.purchased_crow_logos, p_logo_id)
    where id = auth.uid()
    returning tokens into profile_row.tokens;
  return profile_row.tokens;
end;
$$;

grant execute on function public.purchase_crow_logo(text) to authenticated;

-- Selecting a crow face: built-ins require ownership; uploaded logos just
-- need to exist in the shared catalog. Classic (null) is always free.

create or replace function public.select_crow_logo(p_logo_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles;
  catalog_id uuid;
begin
  select * into profile_row from public.profiles where id = auth.uid();
  if not found then raise exception 'Profile not found.'; end if;
  if p_logo_id is null or p_logo_id = '' or p_logo_id = 'classic' then
    update public.profiles set crow_logo = null where id = auth.uid();
    return;
  end if;
  if p_logo_id in ('bird','party','cool','crown','chef') then
    if not (p_logo_id = any(profile_row.purchased_crow_logos)) then
      raise exception 'Buy that crow face in the shop before using it.';
    end if;
  else
    select id into catalog_id from public.crow_logos where id::text = p_logo_id;
    if not found then raise exception 'That crow logo is not in the catalog.'; end if;
  end if;
  update public.profiles set crow_logo = p_logo_id where id = auth.uid();
end;
$$;

grant execute on function public.select_crow_logo(text) to authenticated;
