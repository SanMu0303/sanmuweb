-- Additive migration: do not reset or seed over existing production content.
begin;
create table if not exists public.articles (
 slug text primary key,
 status text not null check (status in ('draft','published')),
 published_at date not null,
 document jsonb not null check (jsonb_typeof(document) = 'object'),
 revision integer not null default 1 check (revision > 0)
);
create index if not exists articles_status_date on public.articles(status,published_at);
create table if not exists public.watch_items (
 symbol text primary key,
 document jsonb not null check (jsonb_typeof(document) = 'object'),
 revision integer not null default 1 check (revision > 0)
);
create table if not exists public.cms_meta (id text primary key);
create table if not exists public.image_uploads (
 id text primary key,
 owner text not null,
 storage_path text unique not null,
 document jsonb not null check (jsonb_typeof(document) = 'object'),
 state text not null check (state in ('waiting','temporary','attached','deleting')),
 post_slug text,
 created_at bigint not null
);
create index if not exists image_uploads_owner_state on public.image_uploads(owner,state,created_at);
alter table public.articles enable row level security;
alter table public.watch_items enable row level security;
alter table public.cms_meta enable row level security;
alter table public.image_uploads enable row level security;
-- Only the authenticated application server projects public/member previews.
-- Never expose full documents through anonymous PostgREST reads.
revoke all on public.articles,public.watch_items,public.cms_meta,public.image_uploads from anon,authenticated;
grant select,insert,update,delete on public.articles,public.watch_items,public.cms_meta,public.image_uploads to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('research-images','research-images',false,15728640,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
-- Refuse to silently adopt an existing public bucket.
do $$ begin
 if exists(select 1 from storage.buckets where id='research-images' and public=true) then
  raise exception 'research-images must be private; inspect existing bucket before migrating';
 end if;
end $$;
commit;
