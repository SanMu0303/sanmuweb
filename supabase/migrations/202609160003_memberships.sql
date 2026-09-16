-- Paid-content access is independent from authentication and administrator roles.
-- No existing account is automatically made a member.
begin;
create table if not exists public.user_memberships (
 user_id uuid primary key references auth.users(id) on delete cascade,
 expires_at timestamptz,
 revoked_at timestamptz,
 revision integer not null check(revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(expires_at is null or isfinite(expires_at)),
 check(expires_at is not null or revoked_at is not null)
);
create table if not exists public.membership_audit (
 id bigint generated always as identity primary key,
 -- Snapshot IDs intentionally survive deletion of an Auth account.
 user_id uuid not null,
 actor_id uuid not null,
 actor_email text not null,
 action text not null check(action in ('set','revoke')),
 old_expires_at timestamptz,
 new_expires_at timestamptz,
 old_revoked_at timestamptz,
 new_revoked_at timestamptz,
 old_revision integer not null,
 new_revision integer not null,
 created_at timestamptz not null default now(),
 check(old_revision>=0 and new_revision=old_revision+1)
);
create index if not exists membership_audit_user_created on public.membership_audit(user_id,created_at desc);
alter table public.user_memberships enable row level security;
alter table public.membership_audit enable row level security;
revoke all on public.user_memberships,public.membership_audit from public,anon,authenticated,service_role;
revoke all on sequence public.membership_audit_id_seq from public,anon,authenticated,service_role;

create or replace function public.get_user_membership(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((
  select jsonb_build_object(
   'status',case when m.revoked_at is not null then 'revoked' when m.expires_at>statement_timestamp() then 'active' else 'expired' end,
   'expiresAt',m.expires_at,'revision',m.revision)
  from public.user_memberships m where m.user_id=p_user_id
 ),jsonb_build_object('status','none','expiresAt',null,'revision',0));
$$;

create or replace function public.list_membership_users(p_query text default '',p_page integer default 1,p_status text default 'all')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; needle text=btrim(coalesce(p_query,''));
begin
 if p_page is null or p_page<1 or p_page>100000 or char_length(needle)>100 or p_status is null or p_status not in ('all','none','active','expired','revoked') then
  raise sqlstate 'PT400' using message='会员列表筛选或页码不正确';
 end if;
 with projected as (
  select u.id,u.email,coalesce(n.nickname,'未设置') as nickname,u.created_at,
   (u.email_confirmed_at is not null) as confirmed,
   case when m.user_id is null then 'none' when m.revoked_at is not null then 'revoked' when m.expires_at>statement_timestamp() then 'active' else 'expired' end as membership_status,
   m.expires_at,coalesce(m.revision,0) as revision
  from auth.users u left join public.user_nicknames n on n.user_id=u.id left join public.user_memberships m on m.user_id=u.id
  where needle='' or position(lower(needle) in lower(coalesce(u.email,'')))>0 or position(lower(needle) in lower(coalesce(n.nickname,'')))>0
 ), filtered as (
  select * from projected where p_status='all' or membership_status=p_status
 ), paged as (
  select * from filtered order by created_at desc nulls last,id limit 20 offset ((p_page-1)*20)
 )
 select jsonb_build_object(
  'users',coalesce((select jsonb_agg(jsonb_build_object(
   'id',id,'email',coalesce(email,''),'nickname',nickname,'createdAt',created_at,'confirmed',confirmed,
   'membership',jsonb_build_object('status',membership_status,'expiresAt',expires_at,'revision',revision)
  ) order by created_at desc nulls last,id) from paged),'[]'::jsonb),
  'page',p_page,'pageSize',20,'total',(select count(*) from filtered)
 ) into result;
 return result;
end $$;

create or replace function public.save_user_membership(p_actor_id uuid,p_actor_email text,p_user_id uuid,p_action text,p_expires_at timestamptz,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.user_memberships%rowtype; next_expiry timestamptz; next_revoked timestamptz; current_revision integer=0;
begin
 if p_actor_id is null or p_actor_email is null or not exists(select 1 from auth.users where id=p_actor_id and lower(email)=lower(btrim(p_actor_email)) and email_confirmed_at is not null) then
  raise sqlstate 'PT403' using message='管理员身份验证失败，请重新登录';
 end if;
 -- The service verifies ADMIN_EMAILS. No client role or Auth metadata grants admin access.
 if p_user_id is null or p_action is null or p_action not in ('set','revoke') or p_revision is null or p_revision<0 or p_revision>=2147483647 then
  raise sqlstate 'PT400' using message='会员操作或版本号不正确';
 end if;
 if p_action='set' and (p_expires_at is null or not isfinite(p_expires_at)) then
  raise sqlstate 'PT400' using message='请设置有效的未来到期时间';
 end if;
 -- Serialize edits, including two administrators creating the first row concurrently.
 perform pg_advisory_xact_lock(hashtextextended('membership:'||p_user_id::text,0));
 perform 1 from auth.users where id=p_user_id and email_confirmed_at is not null for update;
 if not found then raise sqlstate 'PT409' using message='用户不存在或邮箱尚未确认，不能修改会员'; end if;
 select * into previous from public.user_memberships where user_id=p_user_id for update;
 if found then current_revision=previous.revision; end if;
 if p_revision<>current_revision then raise sqlstate 'PT409' using message='会员信息已更新，请刷新后重试'; end if;
 if p_action='set' then
  if p_expires_at<=clock_timestamp() then raise sqlstate 'PT400' using message='请设置有效的未来到期时间'; end if;
  next_expiry=p_expires_at;next_revoked=null;
 else
  next_expiry=previous.expires_at;next_revoked=clock_timestamp();
 end if;
 insert into public.user_memberships(user_id,expires_at,revoked_at,revision)
 values(p_user_id,next_expiry,next_revoked,current_revision+1)
 on conflict(user_id) do update set expires_at=excluded.expires_at,revoked_at=excluded.revoked_at,revision=excluded.revision,updated_at=now();
 insert into public.membership_audit(user_id,actor_id,actor_email,action,old_expires_at,new_expires_at,old_revoked_at,new_revoked_at,old_revision,new_revision)
 values(p_user_id,p_actor_id,lower(btrim(p_actor_email)),p_action,previous.expires_at,next_expiry,previous.revoked_at,next_revoked,current_revision,current_revision+1);
 return jsonb_build_object('status',case when next_revoked is not null then 'revoked' when next_expiry>clock_timestamp() then 'active' else 'expired' end,'expiresAt',next_expiry,'revision',current_revision+1);
end $$;

revoke all on function public.get_user_membership(uuid),public.list_membership_users(text,integer,text),public.save_user_membership(uuid,text,uuid,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.get_user_membership(uuid),public.list_membership_users(text,integer,text),public.save_user_membership(uuid,text,uuid,text,timestamptz,integer) to service_role;
commit;
