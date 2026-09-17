begin;
create table if not exists public.video_cover_uploads (
 id uuid primary key,
 owner uuid not null references auth.users(id) on delete cascade,
 storage_path text not null unique,
 mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
 file_size bigint not null check (file_size between 1 and 5242880),
 state text not null default 'waiting' check (state in ('waiting','complete')),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 check (storage_path = 'covers/' || id::text),
 check ((state = 'complete') = (completed_at is not null))
);
create index if not exists video_cover_uploads_owner_idx on public.video_cover_uploads(owner);
alter table public.video_cover_uploads enable row level security;
revoke all on public.video_cover_uploads from public,anon,authenticated;
grant select,insert,update,delete on public.video_cover_uploads to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('research-video-covers','research-video-covers',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
do $$ begin
 if exists(select 1 from storage.buckets where id='research-video-covers' and public=true) then
  raise exception 'research-video-covers must be private';
 end if;
end $$;
-- Even unrelated permissive Storage policies cannot give browser roles direct
-- access to this bucket. Service-role/signed-token Storage operations bypass RLS.
drop policy if exists research_video_covers_server_only on storage.objects;
create policy research_video_covers_server_only on storage.objects as restrictive
 for all to anon,authenticated
 using (bucket_id <> 'research-video-covers')
 with check (bucket_id <> 'research-video-covers');
-- The server issues immutable upload tickets and authorizes every signed cover
-- read. Attached objects are retained; this migration removes no video records.
commit;
