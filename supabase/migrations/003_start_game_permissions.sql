create policy "lobby hosts can create game sessions" on public.game_sessions
  for insert with check (
    exists (
      select 1 from public.lobbies
      where public.lobbies.id = lobby_id
        and public.lobbies.host_id = auth.uid()
    )
  );

create policy "lobby hosts can update game sessions" on public.game_sessions
  for update using (
    exists (
      select 1 from public.lobbies
      where public.lobbies.id = lobby_id
        and public.lobbies.host_id = auth.uid()
    )
  );
