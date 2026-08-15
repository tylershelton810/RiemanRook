-- 019: Track statistics for games with AI seats separately
--
-- Player-only games keep counting toward the main columns; games that include
-- any AI at the table count toward the ai_* columns. The home page shows a
-- combined view of both, and the full record splits the two with a divider.

alter table public.player_statistics
  add column if not exists ai_games_won integer not null default 0,
  add column if not exists ai_games_lost integer not null default 0,
  add column if not exists ai_games_unfinished integer not null default 0,
  add column if not exists ai_games_completed integer not null default 0,
  add column if not exists ai_hands_played integer not null default 0,
  add column if not exists ai_hands_bid integer not null default 0,
  add column if not exists ai_winning_bids integer not null default 0,
  add column if not exists ai_favorite_colors jsonb not null default '{}'::jsonb,
  add column if not exists ai_favorite_partners jsonb not null default '{}'::jsonb;

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
  if session_row.status <> 'completed' then
    update public.game_sessions set statistics_applied = true where id = p_session_id;
    return;
  end if;
  has_ai := exists (
    select 1 from jsonb_array_elements(session_row.game_state->'players') item
    where coalesce((item->>'isAi')::boolean, false)
  );
  winner_team := session_row.game_state->'hand'->>'gameWinner';
  for player in select * from jsonb_array_elements(session_row.game_state->'players') loop
    if (player->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then continue; end if;
    player_id := (player->>'id')::uuid;
    player_team := player->>'team';
    player_stats := session_row.game_state->'stats'->(player->>'id');
    select coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(player_stats->'colors', '{}'::jsonb))), '{}'::jsonb) into merged_colors;
    select coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(player_stats->'partners', '{}'::jsonb))), '{}'::jsonb) into merged_partners;
    if has_ai then
      insert into public.player_statistics (user_id, ai_games_won, ai_games_lost, ai_games_unfinished, ai_games_completed, ai_hands_played, ai_hands_bid, ai_winning_bids, ai_favorite_colors, ai_favorite_partners)
      values (player_id,
        case when player_team = winner_team then 1 else 0 end,
        case when player_team <> winner_team then 1 else 0 end,
        0,
        1,
        coalesce((player_stats->>'handsPlayed')::integer, 0),
        coalesce((player_stats->>'handsBid')::integer, 0),
        coalesce((player_stats->>'winningBids')::integer, 0),
        merged_colors,
        merged_partners
      )
      on conflict (user_id) do update set
        ai_games_won = player_statistics.ai_games_won + excluded.ai_games_won,
        ai_games_lost = player_statistics.ai_games_lost + excluded.ai_games_lost,
        ai_games_unfinished = player_statistics.ai_games_unfinished + excluded.ai_games_unfinished,
        ai_games_completed = player_statistics.ai_games_completed + excluded.ai_games_completed,
        ai_hands_played = player_statistics.ai_hands_played + excluded.ai_hands_played,
        ai_hands_bid = player_statistics.ai_hands_bid + excluded.ai_hands_bid,
        ai_winning_bids = player_statistics.ai_winning_bids + excluded.ai_winning_bids,
        ai_favorite_colors = public.merge_stat_counts(player_statistics.ai_favorite_colors, excluded.ai_favorite_colors),
        ai_favorite_partners = public.merge_stat_counts(player_statistics.ai_favorite_partners, excluded.ai_favorite_partners),
        updated_at = now();
    else
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
    end if;
  end loop;
  update public.game_sessions set statistics_applied = true where id = p_session_id;
end;
$$;

grant execute on function public.finalize_session_statistics(uuid) to authenticated;
