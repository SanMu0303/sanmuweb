-- Persistent, unique display names. Auth remains responsible for credentials.
begin;
create table if not exists public.user_nicknames (
 user_id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null unique check (char_length(nickname) between 1 and 32 and nickname !~ '[[:cntrl:]]' and nickname=btrim(nickname)),
 is_default boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (not is_default or nickname ~ '^交易员[1-9][0-9]{3}$')
);
alter table public.user_nicknames enable row level security;
revoke all on public.user_nicknames from public,anon,authenticated,service_role;
-- Application callers can read their canonical nickname only through these RPCs.
create or replace function public.ensure_user_nickname(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare chosen text; legacy text; metadata jsonb; generated boolean=false;
begin
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then
  raise sqlstate 'PT401' using message='请先验证邮箱并登录';
 end if;
 select nickname into chosen from public.user_nicknames where user_id=p_user_id;
 if found then return jsonb_build_object('nickname',chosen); end if;
 -- All allocations and edits use the same transaction lock. UNIQUE is the final guard.
 perform pg_advisory_xact_lock(hashtextextended('public.user_nicknames',0));
 select raw_user_meta_data into metadata from auth.users where id=p_user_id and email_confirmed_at is not null for update;
 if not found then raise sqlstate 'PT401' using message='请先验证邮箱并登录'; end if;
 select nickname into chosen from public.user_nicknames where user_id=p_user_id;
 if found then return jsonb_build_object('nickname',chosen); end if;
 if jsonb_typeof(metadata->'nickname')='string' then legacy=btrim(metadata->>'nickname'); end if;
 if legacy is not null and legacy<>'' and legacy<>'研究员' and char_length(legacy)<=32 and legacy !~ '[[:cntrl:]]' then
  chosen=legacy;
 else
  generated=true;
  -- Select from remaining slots; no unbounded random retry loop near capacity.
  select '交易员'||slot::text into chosen
  from generate_series(1000,9999) as pool(slot)
  where not exists(select 1 from public.user_nicknames n where n.nickname='交易员'||pool.slot::text)
  order by random() limit 1;
  if chosen is null then raise sqlstate 'PT503' using message='默认昵称号段已满，请联系管理员'; end if;
 end if;
 begin
  insert into public.user_nicknames(user_id,nickname,is_default) values(p_user_id,chosen,generated);
 exception when unique_violation then
  raise sqlstate 'PT409' using message='该昵称已被使用，请更换昵称';
 end;
 update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('nickname',chosen),updated_at=now() where id=p_user_id;
 return jsonb_build_object('nickname',chosen);
end $$;

create or replace function public.set_user_nickname(p_user_id uuid,p_nickname text,p_avatar_path text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare chosen text=btrim(p_nickname); metadata jsonb;
begin
 if chosen is null or char_length(chosen) not between 1 and 32 or chosen ~ '[[:cntrl:]]' then
  raise sqlstate 'PT400' using message='昵称请填写1–32个字符';
 end if;
 if p_avatar_path is not null and (p_avatar_path !~ '^avatars/[a-f0-9-]+/[a-f0-9-]+\.jpg$' or split_part(p_avatar_path,'/',2)<>p_user_id::text) then
  raise sqlstate 'PT400' using message='头像路径不属于当前用户';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('public.user_nicknames',0));
 select raw_user_meta_data into metadata from auth.users where id=p_user_id and email_confirmed_at is not null for update;
 if not found then raise sqlstate 'PT401' using message='请先验证邮箱并登录'; end if;
 begin
  insert into public.user_nicknames(user_id,nickname,is_default) values(p_user_id,chosen,false)
  on conflict(user_id) do update set nickname=excluded.nickname,
   is_default=case when public.user_nicknames.nickname=excluded.nickname then public.user_nicknames.is_default else false end,
   updated_at=now();
 exception when unique_violation then
  raise sqlstate 'PT409' using message='该昵称已被使用，请更换昵称';
 end;
 metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('nickname',chosen);
 if p_avatar_path is not null then metadata=metadata||jsonb_build_object('avatar_path',p_avatar_path); end if;
 update auth.users set raw_user_meta_data=metadata,updated_at=now() where id=p_user_id;
 return jsonb_build_object('nickname',chosen);
end $$;

revoke all on function public.ensure_user_nickname(uuid) from public,anon,authenticated;
revoke all on function public.set_user_nickname(uuid,text,text) from public,anon,authenticated;
grant execute on function public.ensure_user_nickname(uuid),public.set_user_nickname(uuid,text,text) to service_role;

-- Reserve existing custom names first so generated names can never displace them.
-- Duplicate custom names abort the migration for review instead of renaming a user.
do $$ declare account record; begin
 for account in select id from auth.users where email_confirmed_at is not null
  and jsonb_typeof(raw_user_meta_data->'nickname')='string'
  and btrim(raw_user_meta_data->>'nickname') not in ('','研究员')
  and char_length(btrim(raw_user_meta_data->>'nickname'))<=32
  and btrim(raw_user_meta_data->>'nickname') !~ '[[:cntrl:]]'
  order by created_at,id
 loop perform public.ensure_user_nickname(account.id); end loop;
 for account in select id from auth.users where email_confirmed_at is not null order by created_at,id
 loop perform public.ensure_user_nickname(account.id); end loop;
end $$;
commit;
