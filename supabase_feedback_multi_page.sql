-- Run once in Supabase SQL Editor.
-- Adds page tracking so the reusable feedback widget can be used on every webpage.

alter table public.client_recommendations
  add column if not exists page text;

-- Existing recommendations were submitted from the home page before page tracking existed.
update public.client_recommendations
set page = 'index.html'
where page is null or btrim(page) = '';

alter table public.client_recommendations
  alter column page set default 'index.html';

alter table public.client_recommendations
  alter column page set not null;

create index if not exists client_recommendations_page_created_at_idx
  on public.client_recommendations (page, created_at desc);

-- No new RLS policy is needed if your existing SELECT/INSERT/UPDATE policies
-- already apply to public.client_recommendations. The page column is part of the same rows.
