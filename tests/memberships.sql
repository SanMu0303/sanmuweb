-- Supabase SQL Editor, postgres. Only transaction-local fixtures; finish with ROLLBACK.
begin;
do $$
declare
 fixture_actor_id uuid=gen_random_uuid(); member_id uuid=gen_random_uuid(); pending_id uuid=gen_random_uuid();
 prefix text='membership-audit-'||gen_random_uuid()::text;
 fixture_actor_email text; member_email text; display_name text;
 expiry timestamptz=clock_timestamp()+interval '30 days'; renewed timestamptz=clock_timestamp()+interval '60 days';
 result jsonb; listed jsonb; target_role text; target_table text; target_function text;
 audit_before bigint; members_before bigint;
begin
 select count(*) into audit_before from public.membership_audit;
 select count(*) into members_before from public.user_memberships;
 fixture_actor_email=prefix||'-actor@example.invalid';member_email=prefix||'-member@example.invalid';display_name='会员审计'||substr(member_id::text,1,8);
 insert into auth.users(id,instance_id,email,aud,role,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values
 (fixture_actor_id,'00000000-0000-0000-0000-000000000000',fixture_actor_email,'authenticated','authenticated',now(),'{"nickname":"测试管理员"}','{"provider":"email"}',now(),now()),
 (member_id,'00000000-0000-0000-0000-000000000000',member_email,'authenticated','authenticated',now(),'{"role":"admin","unchanged":"keep"}','{"provider":"email"}',now(),now()),
 (pending_id,'00000000-0000-0000-0000-000000000000',prefix||'-pending@example.invalid','authenticated','authenticated',null,'{}','{}',now(),now());
 insert into public.user_nicknames(user_id,nickname,is_default) values(member_id,display_name,false);
 if public.get_user_membership(member_id) <> '{"status":"none","expiresAt":null,"revision":0}'::jsonb then raise exception 'FAIL: default membership'; end if;
 result=public.save_user_membership(fixture_actor_id,fixture_actor_email,member_id,'set',expiry,0);
 if result->>'status'<>'active' or (result->>'revision')::int<>1 or (result->>'expiresAt')::timestamptz<>expiry then raise exception 'FAIL: grant'; end if;
 if public.get_user_membership(member_id)->>'status'<>'active' then raise exception 'FAIL: persisted membership'; end if;
 if not exists(select 1 from public.membership_audit a where a.user_id=member_id and a.actor_id=fixture_actor_id and a.actor_email=fixture_actor_email and action='set' and old_expires_at is null and new_expires_at=expiry and old_revision=0 and new_revision=1) then raise exception 'FAIL: grant audit'; end if;
 begin
  perform public.save_user_membership(fixture_actor_id,fixture_actor_email,member_id,'set',renewed,0);
  raise exception 'FAIL: stale revision accepted';
 exception when sqlstate 'PT409' then null;
 end;
 begin
  perform public.save_user_membership(fixture_actor_id,fixture_actor_email,pending_id,'set',expiry,0);
  raise exception 'FAIL: unconfirmed account granted';
 exception when sqlstate 'PT409' then null;
 end;
 begin
  perform public.save_user_membership(fixture_actor_id,member_email,member_id,'revoke',null,1);
  raise exception 'FAIL: actor email mismatch accepted';
 exception when sqlstate 'PT403' then null;
 end;
 begin
  perform public.save_user_membership(fixture_actor_id,fixture_actor_email,member_id,'set','2000-01-01T00:00:00Z',1);
  raise exception 'FAIL: past expiry accepted';
 exception when sqlstate 'PT400' then null;
 end;
 begin
  perform public.save_user_membership(fixture_actor_id,fixture_actor_email,member_id,'set','infinity',1);
  raise exception 'FAIL: permanent expiry accepted';
 exception when sqlstate 'PT400' then null;
 end;
 begin
  perform public.save_user_membership(fixture_actor_id,fixture_actor_email,member_id,'revoke',null,null);
  raise exception 'FAIL: missing revision accepted';
 exception when sqlstate 'PT400' then null;
 end;
 if (select count(*) from public.membership_audit)<>audit_before+1 then raise exception 'FAIL: failed operation wrote audit'; end if;

 result=public.save_user_membership(fixture_actor_id,fixture_actor_email,member_id,'set',renewed,1);
 if result->>'status'<>'active' or (result->>'revision')::int<>2 or (result->>'expiresAt')::timestamptz<>renewed then raise exception 'FAIL: renewal'; end if;
 result=public.save_user_membership(fixture_actor_id,fixture_actor_email,member_id,'revoke',null,2);
 if result->>'status'<>'revoked' or (result->>'revision')::int<>3 or (result->>'expiresAt')::timestamptz<>renewed then raise exception 'FAIL: revoke'; end if;
 listed=public.list_membership_users(prefix,1,'revoked');
 if (listed->>'total')::int<>1 or listed->'users'->0->>'id'<>member_id::text then raise exception 'FAIL: revoked filter'; end if;
 result=public.save_user_membership(fixture_actor_id,fixture_actor_email,member_id,'set',renewed,3);
 if result->>'status'<>'active' or (result->>'revision')::int<>4 then raise exception 'FAIL: reactivation'; end if;
 -- Simulate an elapsed clock without waiting or altering any real account.
 update public.user_memberships set expires_at='2000-01-01T00:00:00Z' where user_id=member_id;
 if public.get_user_membership(member_id)->>'status'<>'expired' then raise exception 'FAIL: expiry'; end if;
 if public.get_user_membership(fixture_actor_id)->>'status'<>'none' then raise exception 'FAIL: administrator auto-granted'; end if;
 listed=public.list_membership_users(prefix,1,'all');
 if (listed->>'total')::int<>3 or (listed->>'pageSize')::int<>20 or jsonb_array_length(listed->'users')<>3 then raise exception 'FAIL: user listing'; end if;
 if exists(select 1 from jsonb_array_elements(listed->'users') entry where entry ? 'raw_user_meta_data' or entry ? 'encrypted_password' or entry ? 'raw_app_meta_data') then raise exception 'FAIL: private Auth data exposed'; end if;
 listed=public.list_membership_users(display_name,1,'expired');
 if (listed->>'total')::int<>1 or listed->'users'->0->>'id'<>member_id::text then raise exception 'FAIL: nickname search'; end if;
 listed=public.list_membership_users(prefix||'%',1,'all');
 if (listed->>'total')::int<>0 then raise exception 'FAIL: query wildcard interpreted'; end if;
 listed=public.list_membership_users(prefix,2,'all');
 if (listed->>'total')::int<>3 or jsonb_array_length(listed->'users')<>0 then raise exception 'FAIL: page boundary'; end if;
 begin
  perform public.list_membership_users('',0,'all');raise exception 'FAIL: invalid page accepted';
 exception when sqlstate 'PT400' then null;
 end;
 if not exists(select 1 from auth.users where id=member_id and role='authenticated' and aud='authenticated' and raw_user_meta_data->>'role'='admin' and raw_user_meta_data->>'unchanged'='keep' and raw_app_meta_data='{"provider":"email"}'::jsonb and encrypted_password is null) then raise exception 'FAIL: Auth roles or profile modified'; end if;
 if (select count(*) from public.membership_audit)<>audit_before+4 or (select count(*) from public.user_memberships)<>members_before+1 then raise exception 'FAIL: unexpected data writes'; end if;

 foreach target_table in array array['public.user_memberships','public.membership_audit'] loop
  if not (select relrowsecurity from pg_class where oid=target_table::regclass) then raise exception 'FAIL: RLS missing for %',target_table; end if;
  foreach target_role in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(target_role,target_table,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'FAIL: direct access for % to %',target_role,target_table; end if;
  end loop;
 end loop;
 foreach target_function in array array['public.get_user_membership(uuid)','public.list_membership_users(text,integer,text)','public.save_user_membership(uuid,text,uuid,text,timestamp with time zone,integer)'] loop
  foreach target_role in array array['anon','authenticated'] loop
   if has_function_privilege(target_role,target_function,'EXECUTE') then raise exception 'FAIL: RPC exposed to %',target_role; end if;
  end loop;
  if not has_function_privilege('service_role',target_function,'EXECUTE') then raise exception 'FAIL: service RPC missing'; end if;
  if exists(select 1 from pg_proc where oid=target_function::regprocedure and (not prosecdef or not coalesce(proconfig @> array['search_path=""'],false))) then raise exception 'FAIL: unsafe function settings'; end if;
 end loop;
 raise notice 'PASS: none/grant/renew/revoke/reactivate/expiry, revision conflicts, confirmed targets, bounded list/search, audit, unchanged Auth privileges, RLS and service-only RPC';
end $$;
rollback;
