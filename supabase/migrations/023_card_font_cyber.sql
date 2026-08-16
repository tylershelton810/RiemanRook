-- 023: Cyber card theme
--
-- A seventh 'set the tone' option: the Cyber theme, which sets the owner's
-- numbered cards against a dark grid-floor backdrop with drifting scanlines,
-- a pulsing neon border, and glitching numerals. Premium like Liquid and
-- Aurora at 25 tokens. Recreates the purchase/select RPCs from 022 with
-- 'cyber' added to the allowlist and the premium price. Safe to run whether
-- or not the earlier migrations have been applied (create or replace).

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
  if p_font_id not in ('pixel','fancy','display','serif','fire','aurora','cyber') then
    raise exception 'That typeface cannot be bought here.';
  end if;
  price := case when p_font_id in ('fire','aurora','cyber') then 25 else 10 end;
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
  if p_font_id not in ('pixel','fancy','display','serif','fire','aurora','cyber') then
    raise exception 'That typeface is not available.';
  end if;
  if not (p_font_id = any(profile_row.purchased_card_fonts)) then
    raise exception 'Buy that typeface in the shop before using it.';
  end if;
  update public.profiles set card_font = p_font_id where id = auth.uid();
end;
$$;

grant execute on function public.select_card_font(text) to authenticated;
