-- 010: Let a player remove themselves from a lobby. When the game has already
-- started, the next host's client reconciles the running game_state on the
-- next snapshot and the vacated seat is filled by an AI (see reconcileAiSeats).

create policy "users can leave lobbies" on public.lobby_players
  for delete using (auth.uid() = user_id);

-- The leaver must be able to clear the host flag on the remaining members'
-- rows and promote the next host while they are still the recorded host_id.
create policy "hosts can manage their lobby roster" on public.lobby_players
  for update using (
    exists (
      select 1
      from public.lobbies
      where lobbies.id = public.lobby_players.lobby_id
        and lobbies.host_id = auth.uid()
    )
  );
