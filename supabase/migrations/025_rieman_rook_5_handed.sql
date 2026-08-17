-- 025: Rieman Rook 5 Handed
--
-- 1. Registers the 'rieman-rules-5' ruleset so game_sessions can reference it.
-- 2. Loosens lobby_players checks so five-handed lobbies can use seat_index
--    0-4 and the per-player team labels A-E (each player is their own team).
-- 3. Rewrites the statistics/token finalization functions so five-handed
--    sessions credit the winning side from hand.winnerPlayerIds instead of
--    matching a single team label: the winning trio does not share one team
--    value, so team equality would only credit one of the three.

insert into public.rulesets (id, name, config)
values (
  'rieman-rules-5',
  'Rieman Rook 5 Handed',
  '{"winningScore":500,"cardsPerPlayer":11,"kittySize":2,"bidMinimum":60,"bidIncrement":5,"bidMaximum":105,"turnTimerSeconds":30,"clockwise":true}'::jsonb
)
on conflict (id) do nothing;

alter table public.lobby_players drop constraint if exists lobby_players_seat_index_check;
alter table public.lobby_players drop constraint if exists lobby_players_team_check;
alter table public.lobby_players
  add constraint lobby_players_seat_index_check check (seat_index between 0 and 4),
  add constraint lobby_players_team_check check (team in ('A','B','C','D','E'));

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
  winner_ids jsonb;
  player_team text;
  player_id uuid;
  has_ai boolean;
  is_five boolean;
  col_games_won text;
  col_games_lost text;
  col_games_unfinished text;
  col_games_completed text;
  col_hands_played text;
  col_hands_bid text;
  col_winning_bids text;
  col_favorite_colors text;
  col_favorite_partners text;
begin
  select * into session_row from public.game_sessions where id = p_session_id for update;
  if not found or session_row.statistics_applied then return; end if;
  if session_row.status <> 'completed' then
    update public.game_sessions set statistics_applied = true where id = p_session_id;
    return;
  end if;
  has_ai := exists (
    select 1 from jsonb_array_elements(session_row.game_state->'players') item
    where coalesce((item->>'isAi')::boolean, false)
  );
  is_five := (select count(*) from jsonb_array_elements(session_row.game_state->'players')) >= 5;
  col_games_won := (case when has_ai then 'ai_' else '' end) || 'games' || (case when is_five then '5' else '' end) || '_won';
  col_games_lost := (case when has_ai then 'ai_' else '' end) || 'games' || (case when is_five then '5' else '' end) || '_lost';
  col_games_unfinished := (case when has_ai then 'ai_' else '' end) || 'games' || (case when is_five then '5' else '' end) || '_unfinished';
  col_games_completed := (case when has_ai then 'ai_' else '' end) || 'games' || (case when is_five then '5' else '' end) || '_completed';
  col_hands_played := (case when has_ai then 'ai_' else '' end) || 'hands' || (case when is_five then '5' else '' end) || '_played';
  col_hands_bid := (case when has_ai then 'ai_' else '' end) || 'hands' || (case when is_five then '5' else '' end) || '_bid';
  col_winning_bids := (case when has_ai then 'ai_' else '' end) || 'winning' || (case when is_five then '5' else '' end) || '_bids';
  col_favorite_colors := (case when has_ai then 'ai_' else '' end) || 'favorite' || (case when is_five then '5' else '' end) || '_colors';
  col_favorite_partners := (case when has_ai then 'ai_' else '' end) || 'favorite' || (case when is_five then '5' else '' end) || '_partners';
  winner_team := session_row.game_state->'hand'->>'gameWinner';
  winner_ids := session_row.game_state->'hand'->'winnerPlayerIds';
  for player in select * from jsonb_array_elements(session_row.game_state->'players') loop
    if (player->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then continue; end if;
    player_id := (player->>'id')::uuid;
    player_team := player->>'team';
    player_stats := session_row.game_state->'stats'->(player->>'id');
    select coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(player_stats->'colors', '{}'::jsonb))), '{}'::jsonb) into merged_colors;
    select coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(player_stats->'partners', '{}'::jsonb))), '{}'::jsonb) into merged_partners;
    execute format(
      'insert into public.player_statistics (user_id, %s, %s, %s, %s, %s, %s, %s, %s, %s)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (user_id) do update set
         %s = player_statistics.%s + excluded.%s,
         %s = player_statistics.%s + excluded.%s,
         %s = player_statistics.%s + excluded.%s,
         %s = player_statistics.%s + excluded.%s,
         %s = player_statistics.%s + excluded.%s,
         %s = player_statistics.%s + excluded.%s,
         %s = player_statistics.%s + excluded.%s,
         %s = public.merge_stat_counts(player_statistics.%s, excluded.%s),
         %s = public.merge_stat_counts(player_statistics.%s, excluded.%s),
         updated_at = now()',
      col_games_won, col_games_lost, col_games_unfinished, col_games_completed,
      col_hands_played, col_hands_bid, col_winning_bids, col_favorite_colors, col_favorite_partners,
      col_games_won, col_games_won, col_games_won,
      col_games_lost, col_games_lost, col_games_lost,
      col_games_unfinished, col_games_unfinished, col_games_unfinished,
      col_games_completed, col_games_completed, col_games_completed,
      col_hands_played, col_hands_played, col_hands_played,
      col_hands_bid, col_hands_bid, col_hands_bid,
      col_winning_bids, col_winning_bids, col_winning_bids,
      col_favorite_colors, col_favorite_colors, col_favorite_colors,
      col_favorite_partners, col_favorite_partners, col_favorite_partners
    )
    using player_id,
      case when is_five and jsonb_typeof(winner_ids) = 'array' then (case when winner_ids @> to_jsonb((player->>'id')::text) then 1 else 0 end) else (case when player_team = winner_team then 1 else 0 end) end,
      case when is_five and jsonb_typeof(winner_ids) = 'array' then (case when winner_ids @> to_jsonb((player->>'id')::text) then 0 else 1 end) else (case when player_team <> winner_team then 1 else 0 end) end,
      0,
      1,
      coalesce((player_stats->>'handsPlayed')::integer, 0),
      coalesce((player_stats->>'handsBid')::integer, 0),
      coalesce((player_stats->>'winningBids')::integer, 0),
      merged_colors,
      merged_partners;
  end loop;
  update public.game_sessions set statistics_applied = true where id = p_session_id;
end;
$$;

grant execute on function public.finalize_session_statistics(uuid) to authenticated;

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
  winner_ids jsonb;
  is_five boolean;
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
  winner_ids := session_row.game_state->'hand'->'winnerPlayerIds';
  is_five := (select count(*) from jsonb_array_elements(session_row.game_state->'players')) >= 5;
  for player in select * from jsonb_array_elements(session_row.game_state->'players') loop
    -- AI seats carry non-uuid ids; only real users earn tokens.
    if (player->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then continue; end if;
    player_team := player->>'team';
    if is_five and jsonb_typeof(winner_ids) = 'array' then
      if not (winner_ids @> to_jsonb((player->>'id')::text)) then continue; end if;
    else
      if player_team <> winner_team then continue; end if;
    end if;
    player_id := (player->>'id')::uuid;
    update public.profiles
      set tokens = public.profiles.tokens + tokens_per_winner
      where id = player_id;
  end loop;
  update public.game_sessions set tokens_applied = true where id = p_session_id;
end;
$$;

grant execute on function public.award_tokens_for_completed_game(uuid) to authenticated;
