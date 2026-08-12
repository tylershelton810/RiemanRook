do $$
begin
  alter publication supabase_realtime add table public.game_sessions;
exception when duplicate_object then null;
end $$;
