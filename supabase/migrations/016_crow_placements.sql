-- 016: Crow placement effects
--
-- A third shop category: entrance effects that play when your crow card is
-- played onto the table. Each costs 25 tokens (same price as frame
-- animations) and is stored on profiles.placement. Like the other shop
-- items, ownership is enforced server-side.

alter table public.profiles
  add column if not exists purchased_placements text[] not null default '{}';

alter table public.profiles
  add column if not exists placement text;

create or replace function public.purchase_placement(p_placement_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles;
begin
  if p_placement_id is null or p_placement_id = '' or p_placement_id = 'none' then
    raise exception 'The plain landing is already yours.';
  end if;
  if p_placement_id not in ('crack','teleport','slam','flash','zoom') then
    raise exception 'That crow placement cannot be bought here.';
  end if;
  select * into profile_row from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Profile not found.'; end if;
  if p_placement_id = any(profile_row.purchased_placements) then
    return profile_row.tokens;
  end if;
  if profile_row.tokens < 25 then
    raise exception 'You need 25 tokens for that crow placement.';
  end if;
  update public.profiles
    set tokens = profile_row.tokens - 25,
        purchased_placements = array_append(profile_row.purchased_placements, p_placement_id)
    where id = auth.uid()
    returning tokens into profile_row.tokens;
  return profile_row.tokens;
end;
$$;

grant execute on function public.purchase_placement(text) to authenticated;

-- Equipping a crow placement requires ownership; null / 'none' clears it.

create or replace function public.select_placement(p_placement_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles;
begin
  select * into profile_row from public.profiles where id = auth.uid();
  if not found then raise exception 'Profile not found.'; end if;
  if p_placement_id is null or p_placement_id = '' or p_placement_id = 'none' then
    update public.profiles set placement = null where id = auth.uid();
    return;
  end if;
  if p_placement_id not in ('crack','teleport','slam','flash','zoom') then
    raise exception 'That crow placement is not available.';
  end if;
  if not (p_placement_id = any(profile_row.purchased_placements)) then
    raise exception 'Buy that crow placement in the shop before using it.';
  end if;
  update public.profiles set placement = p_placement_id where id = auth.uid();
end;
$$;

grant execute on function public.select_placement(text) to authenticated;
