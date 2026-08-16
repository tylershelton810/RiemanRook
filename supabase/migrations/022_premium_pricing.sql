-- 022: Premium shop pricing
--
-- Reworks shop prices: premium items (the three animated crow faces —
-- Cosmic, Hologram, Ember — and the two animated card themes — Liquid
-- and Aurora) cost 25 tokens, while every other paid shop item (the
-- remaining crow faces, the classic typefaces, frame animations, and
-- crow placements) costs 10. Recreates the four purchase RPCs with
-- tiered prices; select RPCs already recognize all ids, so only the
-- purchase side changes. Safe to run whether or not the earlier
-- migrations have been applied (create or replace).

create or replace function public.purchase_crow_logo(p_logo_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles;
  price integer;
begin
  if p_logo_id is null or p_logo_id = '' or p_logo_id = 'classic' then
    raise exception 'The classic crow is already yours.';
  end if;
  if p_logo_id not in ('bird','party','cool','crown','chef','fox','owl','cat','panda','cosmic','holo','ember') then
    raise exception 'That crow face cannot be bought here.';
  end if;
  price := case when p_logo_id in ('cosmic','holo','ember') then 25 else 10 end;
  select * into profile_row from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Profile not found.'; end if;
  if p_logo_id = any(profile_row.purchased_crow_logos) then
    return profile_row.tokens;
  end if;
  if profile_row.tokens < price then
    raise exception 'You need % tokens for that crow face.', price;
  end if;
  update public.profiles
    set tokens = profile_row.tokens - price,
        purchased_crow_logos = array_append(profile_row.purchased_crow_logos, p_logo_id)
    where id = auth.uid()
    returning tokens into profile_row.tokens;
  return profile_row.tokens;
end;
$$;

grant execute on function public.purchase_crow_logo(text) to authenticated;

create or replace function public.purchase_card_font(p_font_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles;
  price integer;
begin
  if p_font_id is null or p_font_id = '' or p_font_id = 'none' then
    raise exception 'The plain typeface is already yours.';
  end if;
  if p_font_id not in ('pixel','fancy','display','serif','fire','aurora') then
    raise exception 'That typeface cannot be bought here.';
  end if;
  price := case when p_font_id in ('fire','aurora') then 25 else 10 end;
  select * into profile_row from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Profile not found.'; end if;
  if p_font_id = any(profile_row.purchased_card_fonts) then
    return profile_row.tokens;
  end if;
  if profile_row.tokens < price then
    raise exception 'You need % tokens for that typeface.', price;
  end if;
  update public.profiles
    set tokens = profile_row.tokens - price,
        purchased_card_fonts = array_append(profile_row.purchased_card_fonts, p_font_id)
    where id = auth.uid()
    returning tokens into profile_row.tokens;
  return profile_row.tokens;
end;
$$;

grant execute on function public.purchase_card_font(text) to authenticated;

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
  if profile_row.tokens < 10 then
    raise exception 'You need 10 tokens for that frame animation.';
  end if;
  update public.profiles
    set tokens = profile_row.tokens - 10,
        purchased_card_animations = array_append(profile_row.purchased_card_animations, p_animation_id)
    where id = auth.uid()
    returning tokens into profile_row.tokens;
  return profile_row.tokens;
end;
$$;

grant execute on function public.purchase_card_animation(text) to authenticated;

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
  if profile_row.tokens < 10 then
    raise exception 'You need 10 tokens for that crow placement.';
  end if;
  update public.profiles
    set tokens = profile_row.tokens - 10,
        purchased_placements = array_append(profile_row.purchased_placements, p_placement_id)
    where id = auth.uid()
    returning tokens into profile_row.tokens;
  return profile_row.tokens;
end;
$$;

grant execute on function public.purchase_placement(text) to authenticated;
