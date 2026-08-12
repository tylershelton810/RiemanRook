create policy "players can update active game sessions" on public.game_sessions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.lobbies as lobby
      join public.lobby_players as member on member.lobby_id = lobby.id
      where lobby.id = public.game_sessions.lobby_id
        and member.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.lobbies as lobby
      join public.lobby_players as member on member.lobby_id = lobby.id
      where lobby.id = public.game_sessions.lobby_id
        and member.user_id = auth.uid()
    )
  );
