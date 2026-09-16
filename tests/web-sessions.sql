-- Run as postgres in a disposable database or Supabase SQL Editor after the migration.
-- Random fixture users/sessions only. The final ROLLBACK removes every fixture and mutation.
begin;
do $$
declare
 fixture_user uuid=gen_random_uuid(); other_user uuid=gen_random_uuid();
 auth_one uuid=gen_random_uuid(); auth_two uuid=gen_random_uuid(); other_auth uuid=gen_random_uuid();
 owner_one uuid=gen_random_uuid(); owner_two uuid=gen_random_uuid();
 prefix text='web-session-test-'||gen_random_uuid()::text;
 email_one text;
 hash_one text=repeat('a',32)||replace(gen_random_uuid()::text,'-','');
 hash_two text=repeat('b',32)||replace(gen_random_uuid()::text,'-','');
 hash_three text=repeat('c',32)||replace(gen_random_uuid()::text,'-','');
 hash_four text=repeat('d',32)||replace(gen_random_uuid()::text,'-','');
 hash_five text=repeat('e',32)||replace(gen_random_uuid()::text,'-','');
 hash_other text=repeat('f',32)||replace(gen_random_uuid()::text,'-','');
 result jsonb; snapshot jsonb; operation_ok boolean; previous_reauth timestamptz; previous_activity timestamptz;
 previous_created timestamptz; lease_start timestamptz; original_count bigint; original_versions bigint;
 target_role text; target_table text; target_function text;
begin
 select count(*) into original_count from public.web_sessions;
 select count(*) into original_versions from public.web_session_versions;
 email_one=prefix||'-one@example.invalid';
 insert into auth.users(id,instance_id,email,aud,role,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values
 (fixture_user,'00000000-0000-0000-0000-000000000000',email_one,'authenticated','authenticated',now(),'{"untouched":"one"}','{"provider":"email"}',now(),now()),
 (other_user,'00000000-0000-0000-0000-000000000000',prefix||'-other@example.invalid','authenticated','authenticated',now(),'{"untouched":"other"}','{"provider":"email"}',now(),now());
 insert into auth.sessions(id,user_id,created_at,updated_at)
 values(auth_one,fixture_user,now(),now()),(auth_two,fixture_user,now(),now()),(other_auth,other_user,now(),now());

 snapshot=public.begin_web_login('  '||upper(email_one)||'  ');
 if snapshot<>jsonb_build_object('user_id',fixture_user,'epoch',0) then raise exception 'FAIL: normalized initial login epoch'; end if;
 if public.begin_web_login(prefix||'-absent@example.invalid')<>jsonb_build_object('user_id',null,'epoch',0) then raise exception 'FAIL: missing account login epoch'; end if;
 result=public.resolve_web_session('not-a-hash',null);
 if result<>'{"state":"missing"}'::jsonb then raise exception 'FAIL: invalid opaque hash'; end if;
 begin
  perform public.create_web_session(upper(hash_one),fixture_user,auth_one,'access','refresh',clock_timestamp()+interval '1 hour',0);
  raise exception 'FAIL: noncanonical hash accepted';
 exception when sqlstate 'PT400' then null;
 end;
 begin
  perform public.create_web_session(hash_one,fixture_user,other_auth,'access','refresh',clock_timestamp()+interval '1 hour',0);
  raise exception 'FAIL: another user Auth session accepted';
 exception when sqlstate 'PT401' then null;
 end;
 begin
  perform public.create_web_session(hash_one,fixture_user,gen_random_uuid(),'access','refresh',clock_timestamp()+interval '1 hour',0);
  raise exception 'FAIL: missing Auth session accepted';
 exception when sqlstate 'PT401' then null;
 end;
 begin
  perform public.create_web_session(hash_one,fixture_user,auth_one,'access','refresh','infinity',0);
  raise exception 'FAIL: infinite access expiry accepted';
 exception when sqlstate 'PT400' then null;
 end;
 begin
  perform public.create_web_session(hash_one,fixture_user,auth_one,'access','refresh',clock_timestamp()-interval '1 second',0);
  raise exception 'FAIL: expired access credential accepted';
 exception when sqlstate 'PT400' then null;
 end;

 perform public.create_web_session(hash_one,fixture_user,auth_one,'test-access-original','test-refresh-original',clock_timestamp()+interval '1 hour',0);
 select created_at into previous_created from public.web_sessions where token_hash=hash_one;
 if not exists(select 1 from public.web_sessions where token_hash=hash_one and version=1 and reauthenticated_at=created_at and last_active_at=created_at) then raise exception 'FAIL: initial timestamps/version'; end if;
 begin
  perform public.create_web_session(hash_one,other_user,other_auth,'overwrite-access','overwrite-refresh',clock_timestamp()+interval '1 hour',0);
  raise exception 'FAIL: duplicate hash replaced a session';
 exception when sqlstate 'PT409' then null;
 end;
 previous_reauth=clock_timestamp()-interval '20 minutes';
 previous_activity=clock_timestamp()-interval '1 day';
 update public.web_sessions set last_active_at=previous_activity,reauthenticated_at=previous_reauth where token_hash=hash_one;
 result=public.resolve_web_session(hash_one,null);
 if result->>'state'<>'ready' or result->>'user_id'<>fixture_user::text or result->>'auth_session_id'<>auth_one::text
  or result->>'access_token'<>'test-access-original' or result->>'refresh_token'<>'test-refresh-original' or (result->>'version')::int<>1 then raise exception 'FAIL: ready credentials/identity'; end if;
 if (result->>'reauthenticated_at')::timestamptz<>previous_reauth then raise exception 'FAIL: ordinary activity renewed admin authentication'; end if;
 if not exists(select 1 from public.web_sessions where token_hash=hash_one and last_active_at>previous_activity and created_at=previous_created and refresh_owner is null) then raise exception 'FAIL: activity touch changed immutable fields'; end if;

 -- The refresh threshold includes the final 60 seconds; the lease is 45 seconds.
 update public.web_sessions set access_expires_at=clock_timestamp()+interval '60 seconds' where token_hash=hash_one;
 lease_start=clock_timestamp();
 result=public.resolve_web_session(hash_one,owner_one);
 if result->>'state'<>'refresh' or (result->>'version')::int<>1 then raise exception 'FAIL: refresh threshold'; end if;
 if not exists(select 1 from public.web_sessions where token_hash=hash_one and refresh_owner=owner_one and refresh_until between lease_start+interval '44 seconds' and clock_timestamp()+interval '45 seconds') then raise exception 'FAIL: refresh lease duration/owner'; end if;
 result=public.resolve_web_session(hash_one,owner_two);
 if result<>'{"state":"busy"}'::jsonb then raise exception 'FAIL: second worker received credentials/lease'; end if;
 result=public.resolve_web_session(hash_one,owner_one);
 if result<>'{"state":"busy"}'::jsonb then raise exception 'FAIL: duplicate worker may reuse refresh token'; end if;
 operation_ok=public.finish_web_session_refresh(hash_one,owner_two,1,'wrong-access','wrong-refresh',clock_timestamp()+interval '1 hour');
 if operation_ok then raise exception 'FAIL: wrong refresh owner saved'; end if;
 operation_ok=public.finish_web_session_refresh(hash_one,owner_one,2,'wrong-access','wrong-refresh',clock_timestamp()+interval '1 hour');
 if operation_ok then raise exception 'FAIL: wrong refresh version saved'; end if;
 operation_ok=public.release_web_session_refresh(hash_one,owner_two,1);
 if operation_ok then raise exception 'FAIL: another worker released lease'; end if;
 operation_ok=public.release_web_session_refresh(hash_one,owner_one,2);
 if operation_ok then raise exception 'FAIL: another version released lease'; end if;
 operation_ok=public.release_web_session_refresh(hash_one,owner_one,1);
 if not operation_ok then raise exception 'FAIL: matching release failed'; end if;
 result=public.resolve_web_session(hash_one,owner_two);
 if result->>'state'<>'refresh' then raise exception 'FAIL: released lease could not be reclaimed'; end if;
 operation_ok=public.finish_web_session_refresh(hash_one,owner_two,1,'test-access-rotated','test-refresh-rotated',clock_timestamp()+interval '1 hour');
 if not operation_ok then raise exception 'FAIL: valid refresh failed'; end if;
 result=public.resolve_web_session(hash_one,null);
 if result->>'state'<>'ready' or result->>'access_token'<>'test-access-rotated' or result->>'refresh_token'<>'test-refresh-rotated' or (result->>'version')::int<>2 then raise exception 'FAIL: refresh persistence/version'; end if;
 if (result->>'reauthenticated_at')::timestamptz<>previous_reauth or exists(select 1 from public.web_sessions where token_hash=hash_one and (refresh_owner is not null or refresh_until is not null)) then raise exception 'FAIL: refresh extended reauth or retained lease'; end if;
 operation_ok=public.finish_web_session_refresh(hash_one,owner_two,1,'replayed-access','replayed-refresh',clock_timestamp()+interval '1 hour');
 if operation_ok then raise exception 'FAIL: completed refresh replay accepted'; end if;

 -- Expired leases cannot finish, and a new owner blocks the old worker even at the same version.
 update public.web_sessions set access_expires_at=clock_timestamp() where token_hash=hash_one;
 perform public.resolve_web_session(hash_one,owner_one);
 update public.web_sessions set refresh_until=clock_timestamp()-interval '1 second' where token_hash=hash_one;
 operation_ok=public.finish_web_session_refresh(hash_one,owner_one,2,'late-access','late-refresh',clock_timestamp()+interval '1 hour');
 if operation_ok then raise exception 'FAIL: expired lease saved'; end if;
 result=public.resolve_web_session(hash_one,owner_two);
 if result->>'state'<>'refresh' then raise exception 'FAIL: expired lease not reclaimed'; end if;
 operation_ok=public.finish_web_session_refresh(hash_one,owner_one,2,'late-access','late-refresh',clock_timestamp()+interval '1 hour');
 if operation_ok then raise exception 'FAIL: old lease owner overwrote replacement'; end if;
 operation_ok=public.finish_web_session_refresh(hash_one,owner_two,2,'test-access-final','test-refresh-final',clock_timestamp()+interval '1 hour');
 if not operation_ok then raise exception 'FAIL: reclaimed refresh failed'; end if;

 operation_ok=public.mark_web_session_reauthenticated(hash_one,other_user);

 if operation_ok then raise exception 'FAIL: another identity refreshed administrator authentication'; end if;
 if (select reauthenticated_at from public.web_sessions where token_hash=hash_one)<>previous_reauth then raise exception 'FAIL: mismatched reauth changed timestamp'; end if;
 operation_ok=public.mark_web_session_reauthenticated(hash_one,fixture_user);
 if not operation_ok then raise exception 'FAIL: verified reauthentication failed'; end if;
 if not exists(select 1 from public.web_sessions where token_hash=hash_one and reauthenticated_at>previous_reauth and reauthenticated_at>clock_timestamp()-interval '15 minutes' and version=3 and access_token='test-access-final') then raise exception 'FAIL: reauth changed credentials/version or did not update time'; end if;

 -- Thirty days is inclusive. Touching the cookie must never renew an expired record.
 perform public.create_web_session(hash_two,fixture_user,auth_two,'idle-access','idle-refresh',clock_timestamp()+interval '1 hour',0);
 update public.web_sessions set last_active_at=clock_timestamp()-interval '29 days 23 hours 59 minutes' where token_hash=hash_two;
 result=public.resolve_web_session(hash_two,null);
 if result->>'state'<>'ready' then raise exception 'FAIL: under-30-day session rejected'; end if;
 update public.web_sessions set last_active_at=clock_timestamp()-interval '30 days' where token_hash=hash_two;
 -- Execute mutating RPCs in their own statements. A subquery in the same
 -- expression may use the pre-call snapshot or run before a volatile function.
 result=public.resolve_web_session(hash_two,owner_one);
 if result<>'{"state":"missing"}'::jsonb then raise exception 'FAIL: expired idle resolve was not missing'; end if;
 if exists(select 1 from public.web_sessions where token_hash=hash_two) then raise exception 'FAIL: expired idle record revived'; end if;
 operation_ok=public.finish_web_session_refresh(hash_two,owner_one,1,'revived-access','revived-refresh',clock_timestamp()+interval '1 hour');
 if operation_ok then raise exception 'FAIL: missing idle record revived by completion'; end if;
 operation_ok=public.mark_web_session_reauthenticated(hash_two,fixture_user);
 if operation_ok then raise exception 'FAIL: missing idle record revived by reauth'; end if;

 perform public.create_web_session(hash_three,fixture_user,auth_two,'idle-reauth-access','idle-reauth-refresh',clock_timestamp()+interval '1 hour',0);
 update public.web_sessions set last_active_at=clock_timestamp()-interval '30 days' where token_hash=hash_three;
 operation_ok=public.mark_web_session_reauthenticated(hash_three,fixture_user);
 if operation_ok then raise exception 'FAIL: reauth accepted idle record'; end if;
 if exists(select 1 from public.web_sessions where token_hash=hash_three) then raise exception 'FAIL: reauth revived idle record'; end if;
 perform public.create_web_session(hash_three,fixture_user,auth_two,'idle-refresh-access','idle-refresh-token',clock_timestamp()+interval '30 seconds',0);
 perform public.resolve_web_session(hash_three,owner_one);
 update public.web_sessions set last_active_at=clock_timestamp()-interval '30 days' where token_hash=hash_three;
 operation_ok=public.finish_web_session_refresh(hash_three,owner_one,1,'revived-access','revived-refresh',clock_timestamp()+interval '1 hour');
 if operation_ok then raise exception 'FAIL: refresh completion accepted idle record'; end if;
 if exists(select 1 from public.web_sessions where token_hash=hash_three) then raise exception 'FAIL: refresh completion revived idle record'; end if;

 -- Defensive Auth binding checks remain necessary beyond the two individual FKs.
 perform public.create_web_session(hash_three,fixture_user,auth_two,'binding-access','binding-refresh',clock_timestamp()+interval '30 seconds',0);
 perform public.resolve_web_session(hash_three,owner_one);
 update public.web_sessions set auth_session_id=other_auth where token_hash=hash_three;
 operation_ok=public.finish_web_session_refresh(hash_three,owner_one,1,'foreign-access','foreign-refresh',clock_timestamp()+interval '1 hour');
 if operation_ok then raise exception 'FAIL: Auth session/user mismatch accepted at refresh'; end if;
 if exists(select 1 from public.web_sessions where token_hash=hash_three) then raise exception 'FAIL: Auth session/user mismatch record retained at refresh'; end if;
 perform public.create_web_session(hash_three,fixture_user,auth_two,'binding-access','binding-refresh',clock_timestamp()+interval '1 hour',0);
 update public.web_sessions set auth_session_id=other_auth where token_hash=hash_three;
 result=public.resolve_web_session(hash_three,null);
 if result->>'state'<>'missing' then raise exception 'FAIL: Auth session/user mismatch at resolve'; end if;

 -- A pending refresh cannot recreate a session after explicit logout.
 update public.web_sessions set access_expires_at=clock_timestamp() where token_hash=hash_one;
 perform public.resolve_web_session(hash_one,owner_one);
 perform public.revoke_web_session(hash_one);
 result=public.resolve_web_session(hash_one,owner_two);
 if result->>'state'<>'missing' then raise exception 'FAIL: logged-out session still resolves'; end if;
 operation_ok=public.finish_web_session_refresh(hash_one,owner_one,3,'logged-out-access','logged-out-refresh',clock_timestamp()+interval '1 hour');
 if operation_ok then raise exception 'FAIL: logout revived by delayed refresh'; end if;

 -- Logout-all advances the epoch even with no browser records, invalidating earlier login snapshots.
 perform public.create_web_session(hash_four,fixture_user,auth_one,'device-one-access','device-one-refresh',clock_timestamp()+interval '1 hour',0);
 perform public.create_web_session(hash_five,fixture_user,auth_two,'device-two-access','device-two-refresh',clock_timestamp()+interval '1 hour',0);
 perform public.create_web_session(hash_other,other_user,other_auth,'other-user-access','other-user-refresh',clock_timestamp()+interval '1 hour',0);
 snapshot=public.begin_web_login(email_one);
 perform public.revoke_user_web_sessions(fixture_user);
 if exists(select 1 from public.web_sessions where user_id=fixture_user) or not exists(select 1 from public.web_sessions where token_hash=hash_other) then raise exception 'FAIL: logout-all deletion scope'; end if;
 if public.begin_web_login(email_one)<>jsonb_build_object('user_id',fixture_user,'epoch',1) then raise exception 'FAIL: logout-all epoch'; end if;
 begin
  perform public.create_web_session(hash_four,fixture_user,auth_one,'delayed-login-access','delayed-login-refresh',clock_timestamp()+interval '1 hour',(snapshot->>'epoch')::bigint);
  raise exception 'FAIL: old grant epoch recreated login';
 exception when sqlstate 'PT409' then null;
 end;
 snapshot=public.begin_web_login(email_one);
 perform public.create_web_session(hash_four,fixture_user,auth_one,'fresh-login-access','fresh-login-refresh',clock_timestamp()+interval '1 hour',(snapshot->>'epoch')::bigint);
 result=public.resolve_web_session(hash_four,null);
 if result->>'state'<>'ready' then raise exception 'FAIL: fresh epoch login rejected'; end if;
 perform public.revoke_user_web_sessions(fixture_user);
 perform public.revoke_user_web_sessions(fixture_user);
 if (public.begin_web_login(email_one)->>'epoch')::bigint<>3 then raise exception 'FAIL: logout-all with no sessions did not advance epoch'; end if;
 operation_ok=public.mark_web_session_reauthenticated(hash_four,fixture_user);
 if operation_ok then raise exception 'FAIL: reauth revived logout-all session'; end if;

 delete from auth.sessions where id=other_auth;
 if exists(select 1 from public.web_sessions where token_hash=hash_other) then raise exception 'FAIL: Auth session deletion did not cascade'; end if;
 result=public.resolve_web_session(hash_other,null);
 if result->>'state'<>'missing' then raise exception 'FAIL: deleted Auth session still resolves'; end if;
 begin
  perform public.create_web_session(hash_other,other_user,other_auth,'deleted-auth-access','deleted-auth-refresh',clock_timestamp()+interval '1 hour',0);
  raise exception 'FAIL: deleted Auth session recreated app session';
 exception when sqlstate 'PT401' then null;
 end;
 if not exists(select 1 from auth.users where id=fixture_user and role='authenticated' and raw_user_meta_data='{"untouched":"one"}'::jsonb and encrypted_password is null) then raise exception 'FAIL: app sessions changed Auth password/metadata'; end if;

 foreach target_table in array array['public.web_sessions','public.web_session_versions'] loop
  if not (select relrowsecurity from pg_class where oid=target_table::regclass) then raise exception 'FAIL: table RLS missing'; end if;
  if exists(select 1 from pg_policy where polrelid=target_table::regclass) then raise exception 'FAIL: unexpected client table policy'; end if;
  foreach target_role in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(target_role,target_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'FAIL: direct table access for % to %',target_role,target_table; end if;
  end loop;
 end loop;
 foreach target_function in array array[
  'public.begin_web_login(text)',
  'public.create_web_session(text,uuid,uuid,text,text,timestamp with time zone,bigint)',
  'public.resolve_web_session(text,uuid)',
  'public.finish_web_session_refresh(text,uuid,integer,text,text,timestamp with time zone)',
  'public.release_web_session_refresh(text,uuid,integer)',
  'public.revoke_web_session(text)',
  'public.revoke_user_web_sessions(uuid)',
  'public.mark_web_session_reauthenticated(text,uuid)'
 ] loop
  foreach target_role in array array['anon','authenticated'] loop
   if has_function_privilege(target_role,target_function,'EXECUTE') then raise exception 'FAIL: client RPC access for %',target_role; end if;
  end loop;
  if not has_function_privilege('service_role',target_function,'EXECUTE') then raise exception 'FAIL: missing service RPC'; end if;
  if exists(select 1 from pg_proc where oid=target_function::regprocedure and (not prosecdef or not coalesce(proconfig @> array['search_path=""'],false))) then raise exception 'FAIL: unsafe RPC security/search_path'; end if;
 end loop;

 delete from auth.users where id in(fixture_user,other_user);
 if exists(select 1 from auth.sessions where id in(auth_one,auth_two,other_auth)) or exists(select 1 from public.web_session_versions where user_id in(fixture_user,other_user)) then raise exception 'FAIL: user deletion cascade'; end if;
 if (select count(*) from public.web_sessions)<>original_count or (select count(*) from public.web_session_versions)<>original_versions then raise exception 'FAIL: unexpected real-session writes'; end if;
 raise notice 'PASS: opaque hashes, verified Auth binding, refresh threshold/leases/version/replay, idle 30-day boundary, reauth, revoke/revoke-all epochs, Auth cascades, RLS and service-only RPCs';
end $$;
rollback;
