-- 017: Card fonts
--
-- A third shop category: typefaces for the numbered cards. Each costs 25
-- tokens, drawn from the same token balance as the other cosmetics. The
-- equipped font is stored on profiles.card_font and applies to every
-- numbered card the owner plays, in their hand and on the table.

alter table public.profiles
  add column if not exists purchased_card_fonts text[] not null default '{}';

alter table public.profiles
  add column if not exists card_font text;

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
  if p_font_id not in ('pixel','fancy','display','serif') then
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

-- Equipping a typeface requires ownership; null / 'none' clears it.

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
  if p_font_id not in ('pixel','fancy','display','serif') then
    raise exception 'That typeface is not available.';
  end if;
  if not (p_font_id = any(profile_row.purchased_card_fonts)) then
    raise exception 'Buy that typeface in the shop before using it.';
  end if;
  update public.profiles set card_font = p_font_id where id = auth.uid();
end;
$$;

grant execute on function public.select_card_font(text) to authenticated;
