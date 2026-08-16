-- 021: Animated crow faces
--
-- Extends the crow-face shop with three animated faces — Cosmic, Hologram,
-- and Ember — at the same 10-token price as the other paid faces. Each
-- carries its own animated card background, rendered entirely client-side.
-- Recreates the purchase/select RPCs from 015 so the server recognizes the
-- new ids; safe to run whether or not 015 has been applied yet.

create or replace function public.purchase_crow_logo(p_logo_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles;
begin
  if p_logo_id is null or p_logo_id = '' or p_logo_id = 'classic' then
    raise exception 'The classic crow is already yours.';
  end if;
  if p_logo_id not in ('bird','party','cool','crown','chef','fox','owl','cat','panda','cosmic','holo','ember') then
    raise exception 'That crow face cannot be bought here.';
  end if;
  select * into profile_row from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Profile not found.'; end if;
  if p_logo_id = any(profile_row.purchased_crow_logos) then
    return profile_row.tokens;
  end if;
  if profile_row.tokens < 10 then
    raise exception 'You need 10 tokens for that crow face.';
  end if;
  update public.profiles
    set tokens = profile_row.tokens - 10,
        purchased_crow_logos = array_append(profile_row.purchased_crow_logos, p_logo_id)
    where id = auth.uid()
    returning tokens into profile_row.tokens;
  return profile_row.tokens;
end;
$$;

grant execute on function public.purchase_crow_logo(text) to authenticated;

create or replace function public.select_crow_logo(p_logo_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles;
  catalog_id uuid;
begin
  select * into profile_row from public.profiles where id = auth.uid();
  if not found then raise exception 'Profile not found.'; end if;
  if p_logo_id is null or p_logo_id = '' or p_logo_id = 'classic' then
    update public.profiles set crow_logo = null where id = auth.uid();
    return;
  end if;
  if p_logo_id in ('bird','party','cool','crown','chef','fox','owl','cat','panda','cosmic','holo','ember') then
    if not (p_logo_id = any(profile_row.purchased_crow_logos)) then
      raise exception 'Buy that crow face in the shop before using it.';
    end if;
  else
    select id into catalog_id from public.crow_logos where id::text = p_logo_id;
    if not found then raise exception 'That crow logo is not in the catalog.'; end if;
  end if;
  update public.profiles set crow_logo = p_logo_id where id = auth.uid();
end;
$$;

grant execute on function public.select_crow_logo(text) to authenticated;
