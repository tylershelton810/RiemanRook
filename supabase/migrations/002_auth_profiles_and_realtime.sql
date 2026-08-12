create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  insert into public.player_statistics (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.player_statistics (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

create policy "users can manage own statistics" on public.player_statistics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.lobbies;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lobby_players;
exception when duplicate_object then null;
end $$;
