-- 020: Aurora card theme
--
-- A sixth 'set the tone' option: the Aurora theme, which sets the owner's
-- numbered cards against a dark night sky with drifting northern lights and
-- a field of twinkling stars. Recreates the purchase/select RPCs from 018
-- with 'aurora' added to the allowlist so the id is recognized server-side.
-- Safe to run whether or not 018 has been applied yet (create or replace).

create or replace function public.purchase_card_font(p_font_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles;
begin
  if p_font_id is null or p_font_id = '' or p_font_id = 'none' then
    raise exception 'The plain typeface is already yours.';
  end if;
  if p_font_id not in ('pixel','fancy','display','serif','fire','aurora') then
    raise exception 'That typeface cannot be bought here.';
  end if;
  select * into profile_row from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Profile not found.'; end if;
  if p_font_id = any(profile_row.purchased_card_fonts) then
    return profile_row.tokens;
  end if;
  if profile_row.tokens < 25 then
    raise exception 'You need 25 tokens for that typeface.';
  end if;
  update public.profiles
    set tokens = profile_row.tokens - 25,
        purchased_card_fonts = array_append(profile_row.purchased_card_fonts, p_font_id)
    where id = auth.uid()
    returning tokens into profile_row.tokens;
  return profile_row.tokens;
end;
$$;

grant execute on function public.purchase_card_font(text) to authenticated;

create or replace function public.select_card_font(p_font_id text)
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
  if p_font_id is null or p_font_id = '' or p_font_id = 'none' then
    update public.profiles set card_font = null where id = auth.uid();
    return;
  end if;
  if p_font_id not in ('pixel','fancy','display','serif','fire','aurora') then
    raise exception 'That typeface is not available.';
  end if;
  if not (p_font_id = any(profile_row.purchased_card_fonts)) then
    raise exception 'Buy that typeface in the shop before using it.';
  end if;
  update public.profiles set card_font = p_font_id where id = auth.uid();
end;
$$;

grant execute on function public.select_card_font(text) to authenticated;
