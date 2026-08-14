-- Crow logos: a public storage bucket for fun crow card images, a catalog
-- table to list them, and a per-user selection stored on profiles.
--
-- Default behavior: profiles.crow_logo IS NULL means the classic "C".
-- Uploaded images live in the public `crow-logos` bucket so anyone can add
-- a fun one and every player can pick it.

alter table public.profiles add column crow_logo text;

create table public.crow_logos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_path text not null,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.crow_logos enable row level security;

create policy "crow logos are readable" on public.crow_logos
  for select using (auth.uid() is not null);

create policy "authenticated users can add crow logos" on public.crow_logos
  for insert with check (auth.uid() is not null);

insert into storage.buckets (id, name, public)
values ('crow-logos', 'crow-logos', true)
on conflict (id) do nothing;

create policy "crow logos are publicly readable" on storage.objects
  for select using (bucket_id = 'crow-logos');

create policy "authenticated users can upload crow logos" on storage.objects
  for insert with check (bucket_id = 'crow-logos' and auth.role() = 'authenticated');
