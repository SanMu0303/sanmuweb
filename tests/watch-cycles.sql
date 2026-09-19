-- Run as postgres in a disposable database or Supabase SQL editor after
-- 202609190001_watch_cycles.sql.  The transaction is rolled back at the end.
begin;
do $$
declare
  ticker text := 'CYCLE_TEST_' || substr(replace(gen_random_uuid()::text,'-',''),1,8);
  active_id text := gen_random_uuid()::text;
  ended_id text := gen_random_uuid()::text;
  trash_id text := gen_random_uuid()::text;
  duplicate_failed boolean := false;
  restore_failed boolean := false;
  count_all integer;
begin
  insert into public.watch_items(symbol,document,revision)
  values
    (active_id,jsonb_build_object('id',active_id,'symbol',ticker,'observationStatus','active'),1),
    (ended_id,jsonb_build_object('id',ended_id,'symbol',ticker,'observationStatus','ended','endedAt',now(),'deletedAt',now()),1),
    (trash_id,jsonb_build_object('id',trash_id,'symbol',ticker,'deletedAt',now()),1);

  select count(*) into count_all from public.watch_items
  where document->>'symbol'=ticker;
  if count_all<>3 then raise exception 'FAIL: ended/trash cycles did not coexist'; end if;

  begin
    insert into public.watch_items(symbol,document,revision)
    values (gen_random_uuid()::text,jsonb_build_object('id',gen_random_uuid()::text,'symbol',ticker,'observationStatus','active'),1);
  exception when unique_violation then duplicate_failed := true;
  end;
  if not duplicate_failed then raise exception 'FAIL: duplicate active ticker accepted'; end if;

  -- A historical ended cycle may be restored for inspection even while a new
  -- active cycle exists; an active recycled cycle must remain blocked.
  perform public.archive_research_watch(ended_id,1,true);
  begin
    perform public.archive_research_watch(trash_id,1,true);
  exception when sqlstate 'PT409' then restore_failed := true;
  end;
  if not restore_failed then raise exception 'FAIL: active recycled cycle restored over active cycle'; end if;
end $$;
rollback;
