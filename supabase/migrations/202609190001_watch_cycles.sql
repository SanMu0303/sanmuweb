-- Observation cycles
--
-- watch_items.symbol remains the storage primary key for compatibility with
-- existing PostgREST/worker deployments.  For legacy rows the storage key is
-- also the ticker.  New cycles use a UUID in that column and keep the actual
-- ticker in document.symbol.  This lets ended and recycled cycles coexist
-- with a new active cycle for the same ticker.
begin;

-- Give old documents an explicit stable identity before the partial index and
-- the cycle-aware RPCs are installed.  Do not change revisions or history.
update public.watch_items
set document = jsonb_set(
  document, '{id}', to_jsonb(symbol), true
)
where document->>'id' is null;

update public.watch_items
set document = jsonb_set(
  document, '{symbol}', to_jsonb(upper(trim(coalesce(document->>'symbol', symbol)))), true
)
where document->>'symbol' is distinct from upper(trim(coalesce(document->>'symbol', symbol)));

create unique index if not exists watch_items_active_symbol_unique
on public.watch_items (upper(trim(coalesce(document->>'symbol', symbol))))
where coalesce(document->>'deletedAt', '') = ''
  and coalesce(document->>'observationStatus', 'active') <> 'ended'
  and coalesce(document->>'endedAt', '') = '';

create or replace function public.save_research_watch(
  p_document jsonb,
  p_revision integer,
  p_owner text
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  storage_key text := nullif(trim(p_document->>'id'), '');
  legacy_ticker boolean := storage_key is null and p_revision > 0;
  actual_symbol text := upper(trim(coalesce(p_document->>'symbol', '')));
  old_document jsonb;
  old_revision integer;
  item jsonb;
  img image_uploads%rowtype;
  normalized jsonb := '[]';
  total bigint := 0;
  idx integer := 0;
  result jsonb;
begin
  -- Legacy clients addressed rows by ticker.  Keep that identity when they
  -- send a positive revision; only a brand-new revision zero receives a UUID.
  if storage_key is null and p_revision > 0 then storage_key := actual_symbol; end if;
  if storage_key is null and p_revision = 0 then storage_key := gen_random_uuid()::text; end if;
  if p_revision < 0 or p_owner is null or p_owner = ''
     or storage_key is null or actual_symbol = '' then
    raise exception 'Invalid revision, owner, or observation identity';
  end if;

  -- All mutations acquire locks in this order: global focus, ticker, cycle.
  -- This matches save_post_with_watch and prevents focus-limit and cycle
  -- updates from deadlocking each other.
  perform pg_advisory_xact_lock(hashtextextended('watch-focus-limit', 0));
  perform pg_advisory_xact_lock(hashtextextended('watch-symbol:' || actual_symbol, 0));
  perform pg_advisory_xact_lock(hashtextextended('watch-id:' || storage_key, 0));

  select document, revision into old_document, old_revision
  from watch_items where symbol = storage_key for update;

  -- A legacy deployment may have stored the primary key with different case
  -- from the normalized ticker it sends now.  The ticker advisory lock already
  -- serializes this fallback lookup, so it remains safe before the row lock.
  if legacy_ticker and old_document is null then
    select symbol, document, revision into storage_key, old_document, old_revision
    from watch_items
    where upper(trim(coalesce(document->>'symbol', symbol))) = actual_symbol
    order by revision desc limit 1 for update;
    if storage_key is not null and storage_key <> actual_symbol then
      perform pg_advisory_xact_lock(hashtextextended('watch-id:' || storage_key, 0));
    end if;
  end if;

  if old_document is not null and coalesce(old_document->>'id', storage_key) <> storage_key then
    raise sqlstate 'PT409' using message = '观察周期标识不匹配，请重新载入';
  end if;
  if old_document is not null and upper(trim(coalesce(old_document->>'symbol',''))) <> actual_symbol then
    raise sqlstate 'PT409' using message = '观察周期与标的代码不匹配';
  end if;
  if coalesce(old_revision, 0) <> p_revision then
    raise sqlstate 'PT409' using message = '记录已更新，请重新载入';
  end if;
  -- A deleted or ended cycle is immutable.  Recycle-bin restore is handled by
  -- archive_research_watch, and a new active cycle receives a new UUID.
  if old_document is not null and (
       coalesce(old_document->>'deletedAt', '') <> ''
       or coalesce(old_document->>'observationStatus', '') = 'ended'
       or coalesce(old_document->>'endedAt', '') <> ''
     ) then
    raise sqlstate 'PT409' using message = '该观察周期已结束或已在回收站，不能继续更新';
  end if;
  if old_document is null and exists (
    select 1 from watch_items w
    where w.symbol <> storage_key
      and upper(trim(coalesce(w.document->>'symbol',w.symbol))) = actual_symbol
      and coalesce(w.document->>'deletedAt','') = ''
      and coalesce(w.document->>'observationStatus','active') <> 'ended'
      and coalesce(w.document->>'endedAt','') = ''
  ) then
    raise sqlstate 'PT409' using message = '该标的已有正在观察的周期，请先结束当前观察';
  end if;
  if coalesce((p_document->>'isWeeklyFocus')::boolean, false)
     and (select count(*) from watch_items w
          where w.symbol <> storage_key
            and coalesce(w.document->>'deletedAt', '') = ''
            and coalesce(w.document->>'observationStatus', 'active') <> 'ended'
            and coalesce(w.document->>'endedAt', '') = ''
            and coalesce((w.document->>'isWeeklyFocus')::boolean, false)) >= 3 then
    raise sqlstate 'PT409' using message = '本周重点最多3个，请先取消其他标的';
  end if;

  if jsonb_array_length(coalesce(p_document->'images', '[]')) > 9 then
    raise exception '最多9张图片';
  end if;
  -- Lock in stable order so image cleanup cannot race a cycle save.
  perform 1 from image_uploads
   where id in (select replace(x->>'url','/api/images/','')
                from jsonb_array_elements(coalesce(p_document->'images','[]')) x)
   order by id for update;
  for item in select value from jsonb_array_elements(coalesce(p_document->'images','[]')) loop
    if item->>'url' like '/api/images/%' then
      select * into img from image_uploads where id=substring(item->>'url' from 13);
      if not found or img.owner <> p_owner
         or img.state not in ('temporary','attached')
         or (img.post_slug is not null and img.post_slug <> ('watch:' || storage_key)) then
        raise sqlstate 'PT409' using message = '图片未完成上传或不属于当前记录';
      end if;
      total := total + coalesce((img.document->>'fileSize')::bigint, 0);
      normalized := normalized || jsonb_build_array(
        img.document || jsonb_build_object(
          'alt', coalesce(item->>'alt','研究配图'),
          'caption', coalesce(item->>'caption',''),
          'isPreview', coalesce((item->>'isPreview')::boolean,false),
          'sortOrder', idx));
      update image_uploads set state='attached', post_slug='watch:' || storage_key
      where id = img.id;
    else
      if coalesce(item->>'storagePath','') <> '' then
        raise exception 'Invalid image storage path';
      end if;
      normalized := normalized || jsonb_build_array(item || jsonb_build_object('sortOrder',idx));
    end if;
    idx := idx + 1;
  end loop;
  if total > 52428800 then raise exception '图片总大小不能超过50MB'; end if;

  result := (p_document - 'revision')
    || jsonb_build_object('id', storage_key, 'symbol', actual_symbol, 'images', normalized);
  insert into watch_items(symbol, document, revision)
  values(storage_key, result, p_revision + 1)
  on conflict(symbol) do update set document=excluded.document, revision=excluded.revision;
  return result || jsonb_build_object('revision', p_revision + 1);
end $$;
revoke all on function public.save_research_watch(jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.save_research_watch(jsonb,integer,text) to service_role;

-- Archive/restore is a transactionally serialized operation too.  In
-- particular, restoring a recycled active cycle cannot race creation of a new
-- active cycle for the same ticker (the partial index is the final guard).
create or replace function public.archive_research_watch(
  p_id text,
  p_revision integer,
  p_restore boolean default false
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  old_document jsonb;
  old_revision integer;
  actual_symbol text;
  result jsonb;
begin
  if nullif(trim(p_id),'') is null or p_revision < 0 then raise exception 'Invalid archive request'; end if;
  select document, revision into old_document, old_revision from watch_items where symbol=p_id;
  if old_document is null then raise sqlstate 'PT404' using message='记录不存在'; end if;
  actual_symbol := upper(trim(coalesce(old_document->>'symbol',p_id)));
  perform pg_advisory_xact_lock(hashtextextended('watch-focus-limit', 0));
  perform pg_advisory_xact_lock(hashtextextended('watch-symbol:' || actual_symbol, 0));
  perform pg_advisory_xact_lock(hashtextextended('watch-id:' || p_id, 0));
  select document, revision into old_document, old_revision from watch_items where symbol=p_id for update;
  if old_revision <> p_revision then raise sqlstate 'PT409' using message='内容已在其他窗口更新，请重新载入后合并。'; end if;
  if p_restore and coalesce(old_document->>'deletedAt','') <> '' then
    if coalesce(old_document->>'observationStatus','active') <> 'ended'
       and coalesce(old_document->>'endedAt','') = ''
       and exists (select 1 from watch_items w
      where w.symbol<>p_id
        and upper(trim(coalesce(w.document->>'symbol',w.symbol)))=actual_symbol
        and coalesce(w.document->>'deletedAt','')=''
        and coalesce(w.document->>'observationStatus','active')<>'ended'
        and coalesce(w.document->>'endedAt','')='') then
      raise sqlstate 'PT409' using message='该标的已有正在观察的周期，无法恢复';
    end if;
    result := old_document - 'deletedAt';
  elsif p_restore then
    result := old_document;
  else
    result := (old_document - 'isWeeklyFocus')
      || jsonb_build_object('deletedAt',to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'isWeeklyFocus',false);
  end if;
  update watch_items set document=result, revision=p_revision+1 where symbol=p_id and revision=p_revision;
  if not found then raise sqlstate 'PT409' using message='内容已在其他窗口更新，请重新载入后合并。'; end if;
  return result || jsonb_build_object('revision',p_revision+1);
end $$;
revoke all on function public.archive_research_watch(text,integer,boolean) from public,anon,authenticated;
grant execute on function public.archive_research_watch(text,integer,boolean) to service_role;

create or replace function public.save_post_with_watch(
  p_document jsonb,
  p_revision integer,
  p_owner text,
  p_sync jsonb
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  saved jsonb;
  old_document jsonb;
  old_revision integer;
  target_id text := nullif(trim(p_sync->>'watchId'),'');
  actual_symbol text := upper(trim(p_document->>'symbol'));
  expected_watch_revision integer := coalesce(nullif(p_sync->>'revision',''),'0')::integer;
  next_watch jsonb;
  watch_result jsonb;
begin
  if p_document->>'status' <> 'published' or p_document->>'format' <> 'short'
     or actual_symbol = '' or coalesce(p_document->>'trendStage','') not in ('准备','启动','运行','高潮','失效') then
    raise exception 'Invalid synchronized post';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('watch-focus-limit', 0));
  perform pg_advisory_xact_lock(hashtextextended('watch-symbol:' || actual_symbol, 0));

  if target_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('watch-id:' || target_id, 0));
    select document,revision into old_document,old_revision from watch_items where symbol=target_id for update;
    if old_document is null then raise sqlstate 'PT409' using message='指定的观察周期不存在或已失效'; end if;
    if upper(trim(coalesce(old_document->>'symbol',''))) <> actual_symbol then raise sqlstate 'PT409' using message='观察周期与标的代码不匹配'; end if;
    if coalesce(old_document->>'deletedAt','')<>'' or coalesce(old_document->>'observationStatus','')='ended' or coalesce(old_document->>'endedAt','')<>'' then
      raise sqlstate 'PT409' using message='该观察周期已结束或已在回收站，不能继续同步更新';
    end if;
  else
    select symbol,document,revision into target_id,old_document,old_revision
    from watch_items
    where upper(trim(coalesce(document->>'symbol',symbol)))=actual_symbol
      and coalesce(document->>'deletedAt','')=''
      and coalesce(document->>'observationStatus','active')<>'ended'
      and coalesce(document->>'endedAt','')=''
    order by revision desc limit 1 for update;
  end if;
  if coalesce(old_revision,0) <> expected_watch_revision then
    raise sqlstate 'PT409' using message='观察池已更新，请刷新后重新同步';
  end if;
  if old_document is not null and upper(trim(coalesce(old_document->>'market',''))) <> upper(trim(coalesce(p_document->>'market',''))) then
    raise sqlstate 'PT409' using message='已有同名标的属于其他市场，请核对市场和标的代码';
  end if;

  if target_id is null then target_id := gen_random_uuid()::text; end if;
  saved := public.save_research_article(p_document,p_revision,p_owner);
  next_watch := coalesce(old_document,jsonb_build_object(
    'id',target_id,'symbol',actual_symbol,'name',actual_symbol,'market',p_document->>'market',
    'images','[]'::jsonb,'isWeeklyFocus',false,
    'createdAt',to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    || jsonb_build_object('id',target_id,'symbol',actual_symbol,
      'stage',p_document->>'trendStage','thesis',p_sync->>'summary',
      'invalidation',coalesce(nullif(p_sync->>'invalidation',''),old_document->>'invalidation','尚未设置'),
      'createdAt',coalesce(old_document->>'createdAt',to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      'updatedAt',to_char(now() at time zone 'Asia/Shanghai','YYYY-MM-DD'),
      'isWeeklyFocus',coalesce((p_sync->>'weeklyFocus')::boolean,(old_document->>'isWeeklyFocus')::boolean,false),
      'articleSlug',p_document->>'slug');
  watch_result := public.save_research_watch(next_watch,coalesce(old_revision,0),p_owner);
  return saved || jsonb_build_object('watchSyncResult',jsonb_build_object(
    'id',target_id,'symbol',actual_symbol,'revision',(watch_result->>'revision')::integer,
    'isWeeklyFocus',coalesce((watch_result->>'isWeeklyFocus')::boolean,false)));
end $$;
revoke all on function public.save_post_with_watch(jsonb,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_post_with_watch(jsonb,integer,text,jsonb) to service_role;

commit;
