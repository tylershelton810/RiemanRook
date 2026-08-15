-- 014: Card frame animations
--
-- A second shop category: animated card frames for your hand. Each costs
-- 25 tokens, drawn from the same token balance as crow faces. Like crow
-- faces, ownership is enforced server-side; the equipped animation is
-- stored on profiles.card_animation and applies to the owner's hand cards.

alter table public.profiles
  add column if not exists purchased_card_animations text[] not null default '{}';

alter table public.profiles
  add column if not exists card_animation text;

create or replace function public.purchase_card_animation(p_animation_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles;
begin
  if p_animation_id is null or p_animation_id = '' or p_animation_id = 'none' then
    raise exception 'The plain frame is already yours.';
  end if;
  if p_animation_id not in ('pulse','wiggle','wave','shine','sparkle') then
    raise exception 'That frame animation cannot be bought here.';
  end if;
  select * into profile_row from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Profile not found.'; end if;
  if p_animation_id = any(profile_row.purchased_card_animations) then
    return profile_row.tokens;
  end if;
  if profile_row.tokens < 25 then
    raise exception 'You need 25 tokens for that frame animation.';
  end if;
  update public.profiles
    set tokens = profile_row.tokens - 25,
        purchased_card_animations = array_append(profile_row.purchased_card_animations, p_animation_id)
    where id = auth.uid()
    returning tokens into profile_row.tokens;
  return profile_row.tokens;
end;
$$;

grant execute on function public.purchase_card_animation(text) to authenticated;

-- Equipping a frame animation requires ownership; null / 'none' clears it.

create or replace function public.select_card_animation(p_animation_id text)
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
  if p_animation_id is null or p_animation_id = '' or p_animation_id = 'none' then
    update public.profiles set card_animation = null where id = auth.uid();
    return;
  end if;
  if p_animation_id not in ('pulse','wiggle','wave','shine','sparkle') then
    raise exception 'That frame animation is not available.';
  end if;
  if not (p_animation_id = any(profile_row.purchased_card_animations)) then
    raise exception 'Buy that frame animation in the shop before using it.';
  end if;
  update public.profiles set card_animation = p_animation_id where id = auth.uid();
end;
$$;

grant execute on function public.select_card_animation(text) to authenticated;
