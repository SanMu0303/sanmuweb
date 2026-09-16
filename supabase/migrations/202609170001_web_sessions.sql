-- Browser cookies contain random opaque values. Only their SHA-256 hashes are stored here.
-- Auth credentials never leave these service-only RPCs for a browser/client role.
begin;

create table if not exists public.web_session_versions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 epoch bigint not null default 0 check(epoch>=0)
);
create table if not exists public.web_sessions (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 auth_session_id uuid not null references auth.sessions(id) on delete cascade,
 access_token text not null check(char_length(access_token) between 1 and 32768),
 refresh_token text not null check(char_length(refresh_token) between 1 and 8192),
 access_expires_at timestamptz not null check(isfinite(access_expires_at)),
 last_active_at timestamptz not null default clock_timestamp() check(isfinite(last_active_at)),
 reauthenticated_at timestamptz not null default clock_timestamp() check(isfinite(reauthenticated_at)),
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 refresh_owner uuid,
 refresh_until timestamptz,
 version integer not null default 1 check(version>0),
 check((refresh_owner is null)=(refresh_until is null)),
 check(refresh_until is null or isfinite(refresh_until))
);
create index if not exists web_sessions_user_id on public.web_sessions(user_id);
create index if not exists web_sessions_auth_session_id on public.web_sessions(auth_session_id);
create index if not exists web_sessions_last_active_at on public.web_sessions(last_active_at);
alter table public.web_sessions enable row level security;
alter table public.web_session_versions enable row level security;
revoke all on public.web_sessions,public.web_session_versions from public,anon,authenticated,service_role;

-- A pre-authentication epoch snapshot prevents a password/OTP request that was
-- already in flight from creating a new browser session after logout-all/reset.
create or replace function public.begin_web_login(p_email text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare normalized text=lower(btrim(p_email)); result jsonb;
begin
 if normalized is null or normalized='' or char_length(normalized)>254 then
  raise sqlstate 'PT400' using message='邮箱地址不正确';
 end if;
 select jsonb_build_object('user_id',u.id,'epoch',coalesce(v.epoch,0)) into result
 from auth.users u left join public.web_session_versions v on v.user_id=u.id
 where lower(u.email)=normalized limit 1;
 return coalesce(result,jsonb_build_object('user_id',null,'epoch',0));
end $$;

create or replace function public.create_web_session(p_token_hash text,p_user_id uuid,p_auth_session_id uuid,p_access_token text,p_refresh_token text,p_access_expires_at timestamptz,p_epoch bigint)
returns void language plpgsql security definer set search_path='' as $$
declare current_epoch bigint; current_time_value timestamptz;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_user_id is null or p_auth_session_id is null
  or p_access_token is null or char_length(p_access_token) not between 1 and 32768
  or p_refresh_token is null or char_length(p_refresh_token) not between 1 and 8192
  or p_access_expires_at is null or not isfinite(p_access_expires_at) or p_epoch is null or p_epoch<0 then
  raise sqlstate 'PT400' using message='登录会话数据不正确';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('web-sessions:'||p_user_id::text,0));
 -- Lock the Auth parent before inserting a child, so a concurrent Auth logout
 -- cannot leave a new browser session referring to a deleted Auth session.
 perform 1 from auth.sessions s where s.id=p_auth_session_id and s.user_id=p_user_id for key share;
 if not found then raise sqlstate 'PT401' using message='登录会话已失效，请重新登录'; end if;
 select coalesce((select v.epoch from public.web_session_versions v where v.user_id=p_user_id),0) into current_epoch;
 if p_epoch<>current_epoch then raise sqlstate 'PT409' using message='账号已退出全部设备，请重新登录'; end if;
 current_time_value=clock_timestamp();
 if p_access_expires_at<=current_time_value then raise sqlstate 'PT400' using message='登录凭证已过期，请重新登录'; end if;
 insert into public.web_sessions(token_hash,user_id,auth_session_id,access_token,refresh_token,access_expires_at,last_active_at,reauthenticated_at,created_at)
 values(p_token_hash,p_user_id,p_auth_session_id,p_access_token,p_refresh_token,p_access_expires_at,current_time_value,current_time_value,current_time_value)
 on conflict(token_hash) do nothing;
 if not found then raise sqlstate 'PT409' using message='登录会话冲突，请重新登录'; end if;
end $$;

create or replace function public.resolve_web_session(p_token_hash text,p_refresh_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_session public.web_sessions%rowtype; current_time_value timestamptz; next_state text;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state','missing'); end if;
 select * into current_session from public.web_sessions where token_hash=p_token_hash for update;
 if not found then return jsonb_build_object('state','missing'); end if;
 current_time_value=clock_timestamp();
 -- This check MUST precede any activity update. A stale cookie cannot revive itself.
 if current_session.last_active_at<=current_time_value-interval '30 days'
  or not exists(select 1 from auth.sessions s where s.id=current_session.auth_session_id and s.user_id=current_session.user_id) then
  delete from public.web_sessions where token_hash=p_token_hash;
  return jsonb_build_object('state','missing');
 end if;
 if current_session.access_expires_at<=current_time_value+interval '60 seconds' then
  if current_session.refresh_until>current_time_value then
   update public.web_sessions set last_active_at=current_time_value where token_hash=p_token_hash;
   return jsonb_build_object('state','busy');
  end if;
  if p_refresh_owner is null then raise sqlstate 'PT400' using message='缺少会话刷新标识'; end if;
  update public.web_sessions set last_active_at=current_time_value,refresh_owner=p_refresh_owner,refresh_until=current_time_value+interval '45 seconds' where token_hash=p_token_hash;
  next_state='refresh';
 else
  update public.web_sessions set last_active_at=current_time_value where token_hash=p_token_hash;
  next_state='ready';
 end if;
 return jsonb_build_object('state',next_state,'user_id',current_session.user_id,'auth_session_id',current_session.auth_session_id,
  'access_token',current_session.access_token,'refresh_token',current_session.refresh_token,
  'access_expires_at',current_session.access_expires_at,'reauthenticated_at',current_session.reauthenticated_at,'version',current_session.version);
end $$;

create or replace function public.finish_web_session_refresh(p_token_hash text,p_refresh_owner uuid,p_version integer,p_access_token text,p_refresh_token text,p_access_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_session public.web_sessions%rowtype; current_time_value timestamptz;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_refresh_owner is null or p_version is null or p_version<1 or p_version>=2147483647 then return false; end if;
 if p_access_token is null or char_length(p_access_token) not between 1 and 32768
  or p_refresh_token is null or char_length(p_refresh_token) not between 1 and 8192
  or p_access_expires_at is null or not isfinite(p_access_expires_at) then
  raise sqlstate 'PT400' using message='会话刷新数据不正确';
 end if;
 select * into current_session from public.web_sessions where token_hash=p_token_hash for update;
 if not found then return false; end if;
 current_time_value=clock_timestamp();
 if current_session.last_active_at<=current_time_value-interval '30 days'
  or not exists(select 1 from auth.sessions s where s.id=current_session.auth_session_id and s.user_id=current_session.user_id) then
  delete from public.web_sessions where token_hash=p_token_hash;
  return false;
 end if;
 if current_session.refresh_owner is distinct from p_refresh_owner or current_session.version<>p_version
  or current_session.refresh_until is null or current_session.refresh_until<=current_time_value or p_access_expires_at<=current_time_value then return false; end if;
 update public.web_sessions set access_token=p_access_token,refresh_token=p_refresh_token,access_expires_at=p_access_expires_at,
  version=version+1,refresh_owner=null,refresh_until=null where token_hash=p_token_hash;
 -- Token refresh is not fresh password authentication, and does not extend idle activity.
 return true;
end $$;

create or replace function public.release_web_session_refresh(p_token_hash text,p_refresh_owner uuid,p_version integer)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_refresh_owner is null or p_version is null then return false; end if;
 update public.web_sessions set refresh_owner=null,refresh_until=null
 where token_hash=p_token_hash and refresh_owner=p_refresh_owner and version=p_version;
 return found;
end $$;

create or replace function public.revoke_web_session(p_token_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.web_sessions where token_hash=p_token_hash;
end $$;

create or replace function public.revoke_user_web_sessions(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_user_id is null then raise sqlstate 'PT400' using message='用户标识不正确'; end if;
 perform pg_advisory_xact_lock(hashtextextended('web-sessions:'||p_user_id::text,0));
 perform 1 from auth.users where id=p_user_id for key share;
 if not found then return; end if;
 insert into public.web_session_versions(user_id,epoch) values(p_user_id,1)
 on conflict(user_id) do update set epoch=public.web_session_versions.epoch+1;
 delete from public.web_sessions where user_id=p_user_id;
end $$;

create or replace function public.mark_web_session_reauthenticated(p_token_hash text,p_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_session public.web_sessions%rowtype; current_time_value timestamptz;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_user_id is null then return false; end if;
 select * into current_session from public.web_sessions where token_hash=p_token_hash and user_id=p_user_id for update;
 if not found then return false; end if;
 current_time_value=clock_timestamp();
 if current_session.last_active_at<=current_time_value-interval '30 days'
  or not exists(select 1 from auth.sessions s where s.id=current_session.auth_session_id and s.user_id=p_user_id) then
  delete from public.web_sessions where token_hash=p_token_hash;
  return false;
 end if;
 update public.web_sessions set reauthenticated_at=current_time_value,last_active_at=current_time_value where token_hash=p_token_hash;
 return true;
end $$;

revoke all on function public.begin_web_login(text),public.create_web_session(text,uuid,uuid,text,text,timestamptz,bigint),public.resolve_web_session(text,uuid),public.finish_web_session_refresh(text,uuid,integer,text,text,timestamptz),public.release_web_session_refresh(text,uuid,integer),public.revoke_web_session(text),public.revoke_user_web_sessions(uuid),public.mark_web_session_reauthenticated(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_web_login(text),public.create_web_session(text,uuid,uuid,text,text,timestamptz,bigint),public.resolve_web_session(text,uuid),public.finish_web_session_refresh(text,uuid,integer,text,text,timestamptz),public.release_web_session_refresh(text,uuid,integer),public.revoke_web_session(text),public.revoke_user_web_sessions(uuid),public.mark_web_session_reauthenticated(text,uuid) to service_role;
commit;
