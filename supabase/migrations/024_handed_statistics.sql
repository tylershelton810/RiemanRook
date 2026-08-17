-- 024: Track statistics per handedness (4-handed vs 5-handed)
--
-- The existing main / ai_* columns are the 4-handed stats. 5-handed games
-- (when they ship) count toward the new games5_* / ai_games5_* columns. The
-- finalize function routes a session to the right column set based on the
-- number of players in its game state.

alter table public.player_statistics
  add column if not exists games5_won integer not null default 0,
  add column if not exists games5_lost integer not null default 0,
  add column if not exists games5_unfinished integer not null default 0,
  add column if not exists games5_completed integer not null default 0,
  add column if not exists hands5_played integer not null default 0,
  add column if not exists hands5_bid integer not null default 0,
  add column if not exists winning5_bids integer not null default 0,
  add column if not exists favorite5_colors jsonb not null default '{}'::jsonb,
  add column if not exists favorite5_partners jsonb not null default '{}'::jsonb,
  add column if not exists ai_games5_won integer not null default 0,
  add column if not exists ai_games5_lost integer not null default 0,
  add column if not exists ai_games5_unfinished integer not null default 0,
  add column if not exists ai_games5_completed integer not null default 0,
  add column if not exists ai_hands5_played integer not null default 0,
  add column if not exists ai_hands5_bid integer not null default 0,
  add column if not exists ai_winning5_bids integer not null default 0,
  add column if not exists ai_favorite5_colors jsonb not null default '{}'::jsonb,
  add column if not exists ai_favorite5_partners jsonb not null default '{}'::jsonb;

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
      case when player_team = winner_team then 1 else 0 end,
      case when player_team <> winner_team then 1 else 0 end,
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
