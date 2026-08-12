alter table public.game_sessions
  add column if not exists statistics_applied boolean not null default false;

create or replace function public.merge_stat_counts(existing jsonb, incoming jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(keys.key, to_jsonb(coalesce((existing->>keys.key)::integer, 0) + coalesce((incoming->>keys.key)::integer, 0))), '{}'::jsonb)
  from (
    select key from jsonb_each(coalesce(existing, '{}'::jsonb))
    union
    select key from jsonb_each(coalesce(incoming, '{}'::jsonb))
  ) keys;
$$;

create or replace function public.finalize_session_statistics(p_session_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  session_row public.game_sessions;
  player jsonb;
  player_stats jsonb;
  merged_colors jsonb;
  merged_partners jsonb;
  winner_team text;
  player_team text;
  player_id uuid;
  has_ai boolean;
begin
  select * into session_row from public.game_sessions where id = p_session_id for update;
  if not found or session_row.statistics_applied then return; end if;
  has_ai := exists (
    select 1 from jsonb_array_elements(session_row.game_state->'players') item
    where coalesce((item->>'isAi')::boolean, false)
  );
  if has_ai or session_row.status <> 'completed' then
    update public.game_sessions set statistics_applied = true where id = p_session_id;
    return;
  end if;
  winner_team := session_row.game_state->'hand'->>'gameWinner';
  for player in select * from jsonb_array_elements(session_row.game_state->'players') loop
    if (player->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then continue; end if;
    player_id := (player->>'id')::uuid;
    player_team := player->>'team';
    player_stats := session_row.game_state->'stats'->(player->>'id');
    select coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(player_stats->'colors', '{}'::jsonb))), '{}'::jsonb) into merged_colors;
    select coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(player_stats->'partners', '{}'::jsonb))), '{}'::jsonb) into merged_partners;
    insert into public.player_statistics (user_id, games_won, games_lost, games_completed, hands_played, hands_bid, winning_bids, favorite_colors, favorite_partners)
    values (player_id,
      case when player_team = winner_team then 1 else 0 end,
      case when player_team <> winner_team then 1 else 0 end,
      1,
      coalesce((player_stats->>'handsPlayed')::integer, 0),
      coalesce((player_stats->>'handsBid')::integer, 0),
      coalesce((player_stats->>'winningBids')::integer, 0),
      merged_colors,
      merged_partners
    )
    on conflict (user_id) do update set
      games_won = player_statistics.games_won + excluded.games_won,
      games_lost = player_statistics.games_lost + excluded.games_lost,
      games_completed = player_statistics.games_completed + excluded.games_completed,
      hands_played = player_statistics.hands_played + excluded.hands_played,
      hands_bid = player_statistics.hands_bid + excluded.hands_bid,
      winning_bids = player_statistics.winning_bids + excluded.winning_bids,
      favorite_colors = public.merge_stat_counts(player_statistics.favorite_colors, excluded.favorite_colors),
      favorite_partners = public.merge_stat_counts(player_statistics.favorite_partners, excluded.favorite_partners),
      updated_at = now();
  end loop;
  update public.game_sessions set statistics_applied = true where id = p_session_id;
end;
$$;

grant execute on function public.finalize_session_statistics(uuid) to authenticated;
