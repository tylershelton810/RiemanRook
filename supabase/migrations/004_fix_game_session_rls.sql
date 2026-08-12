drop policy if exists "lobby hosts can create game sessions" on public.game_sessions;
drop policy if exists "lobby hosts can update game sessions" on public.game_sessions;

create policy "lobby hosts can create game sessions" on public.game_sessions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.lobbies as lobby
      where lobby.id = public.game_sessions.lobby_id
        and lobby.host_id = auth.uid()
    )
  );

create policy "lobby hosts can update game sessions" on public.game_sessions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.lobbies as lobby
      where lobby.id = public.game_sessions.lobby_id
        and lobby.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.lobbies as lobby
      where lobby.id = public.game_sessions.lobby_id
        and lobby.host_id = auth.uid()
    )
  );
