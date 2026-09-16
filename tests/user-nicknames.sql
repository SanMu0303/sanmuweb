-- Run as postgres in Supabase SQL Editor after migration 202609160002.
-- Every fixture and change is inside one transaction and is rolled back.
begin;
do $$
declare
 first_id uuid=gen_random_uuid(); second_id uuid=gen_random_uuid(); pending_id uuid=gen_random_uuid();
 first_name text; second_name text; custom_name text; changed_name text; result jsonb; metadata jsonb;
 count_before bigint; target_role text;
begin
 select count(*) into count_before from public.user_nicknames;
 custom_name='昵称审计'||substr(second_id::text,1,8);
 changed_name='已修改'||substr(first_id::text,1,8);
 insert into auth.users(id,instance_id,email,aud,role,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values
 (first_id,'00000000-0000-0000-0000-000000000000',first_id::text||'@nickname-test.invalid','authenticated','authenticated',now(),'{"nickname":"研究员","unchanged":"keep"}','{"provider":"email","role":"keep-app-role"}',now(),now()),
 (second_id,'00000000-0000-0000-0000-000000000000',second_id::text||'@nickname-test.invalid','authenticated','authenticated',now(),jsonb_build_object('nickname',custom_name),'{}',now(),now()),
 (pending_id,'00000000-0000-0000-0000-000000000000',pending_id::text||'@nickname-test.invalid','authenticated','authenticated',null,'{}','{}',now(),now());

 first_name=public.ensure_user_nickname(first_id)->>'nickname';
 if first_name !~ '^交易员[1-9][0-9]{3}$' then raise exception 'FAIL: four-digit default format'; end if;
 if public.ensure_user_nickname(first_id)->>'nickname' <> first_name then raise exception 'FAIL: unstable default'; end if;
 if (select raw_user_meta_data->>'nickname' from auth.users where id=first_id) <> first_name then raise exception 'FAIL: metadata mirror'; end if;
 if not (select is_default from public.user_nicknames where user_id=first_id) then raise exception 'FAIL: default flag'; end if;
 second_name=public.ensure_user_nickname(second_id)->>'nickname';
 if second_name<>custom_name then raise exception 'FAIL: custom nickname not preserved'; end if;
 if (select is_default from public.user_nicknames where user_id=second_id) then raise exception 'FAIL: custom flagged as default'; end if;

 begin
  perform public.set_user_nickname(second_id,first_name);
  raise exception 'FAIL: duplicate nickname accepted';
 exception when sqlstate 'PT409' then null;
 end;
 if public.ensure_user_nickname(second_id)->>'nickname' <> custom_name then raise exception 'FAIL: collision changed existing nickname'; end if;
 begin
  perform public.ensure_user_nickname(pending_id);
  raise exception 'FAIL: unconfirmed user allocated nickname';
 exception when sqlstate 'PT401' then null;
 end;
 begin
  perform public.set_user_nickname(pending_id,'未确认昵称');
  raise exception 'FAIL: unconfirmed user edited nickname';
 exception when sqlstate 'PT401' then null;
 end;
 if exists(select 1 from public.user_nicknames where user_id=pending_id) then raise exception 'FAIL: unconfirmed row persisted'; end if;

 result=public.set_user_nickname(first_id,changed_name,'avatars/'||first_id::text||'/'||gen_random_uuid()::text||'.jpg');
 if result->>'nickname'<>changed_name then raise exception 'FAIL: nickname edit'; end if;
 if (select is_default from public.user_nicknames where user_id=first_id) then raise exception 'FAIL: edited default flag'; end if;
 select raw_user_meta_data into metadata from auth.users where id=first_id;
 if metadata->>'unchanged'<>'keep' or metadata->>'nickname'<>changed_name or metadata->>'avatar_path' not like 'avatars/'||first_id::text||'/%' then raise exception 'FAIL: profile metadata preservation'; end if;
 if not exists(select 1 from auth.users where id=first_id and role='authenticated' and aud='authenticated' and raw_app_meta_data->>'role'='keep-app-role' and encrypted_password is null) then raise exception 'FAIL: auth/privilege fields modified'; end if;
 begin
  perform public.set_user_nickname(first_id,'不该保存','avatars/'||second_id::text||'/'||gen_random_uuid()::text||'.jpg');
  raise exception 'FAIL: foreign avatar accepted';
 exception when sqlstate 'PT400' then null;
 end;
 begin
  perform public.set_user_nickname(first_id,' ');
  raise exception 'FAIL: empty nickname accepted';
 exception when sqlstate 'PT400' then null;
 end;
 if public.ensure_user_nickname(first_id)->>'nickname'<>changed_name then raise exception 'FAIL: failed edit was not atomic'; end if;

 if not (select relrowsecurity from pg_class where oid='public.user_nicknames'::regclass) then raise exception 'FAIL: RLS disabled'; end if;
 foreach target_role in array array['anon','authenticated'] loop
  if has_table_privilege(target_role,'public.user_nicknames','SELECT,INSERT,UPDATE,DELETE') then raise exception 'FAIL: direct table privileges for %',target_role; end if;
  if has_function_privilege(target_role,'public.ensure_user_nickname(uuid)','EXECUTE') or has_function_privilege(target_role,'public.set_user_nickname(uuid,text,text)','EXECUTE') then raise exception 'FAIL: RPC exposed to %',target_role; end if;
 end loop;
 if not has_function_privilege('service_role','public.ensure_user_nickname(uuid)','EXECUTE') or not has_function_privilege('service_role','public.set_user_nickname(uuid,text,text)','EXECUTE') then raise exception 'FAIL: missing service RPC privileges'; end if;
 if exists(select 1 from pg_proc where oid in ('public.ensure_user_nickname(uuid)'::regprocedure,'public.set_user_nickname(uuid,text,text)'::regprocedure) and (not prosecdef or not coalesce(proconfig @> array['search_path=""'],false))) then raise exception 'FAIL: unsafe function search_path'; end if;
 if (select count(*) from public.user_nicknames)<>count_before+2 then raise exception 'FAIL: unexpected profile count'; end if;
 raise notice 'PASS: allocation, stable default, custom preservation, conflict rejection, confirmed-user guard, atomic avatar ownership, metadata preservation, RLS and RPC privileges';
end $$;
rollback;
