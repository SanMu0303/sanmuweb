begin;
create or replace function public.save_research_watch(p_document jsonb,p_revision integer,p_owner text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare old_revision integer; item jsonb; img image_uploads%rowtype; normalized jsonb='[]'; total bigint=0; idx integer=0; result jsonb;
begin
 if p_revision<0 or p_owner is null or p_owner='' then raise exception 'Invalid revision or owner'; end if;
 perform pg_advisory_xact_lock(hashtextextended('watch-focus-limit',0));
 if coalesce((p_document->>'isWeeklyFocus')::boolean,false) and (select count(*) from watch_items where symbol<>p_document->>'symbol' and document->>'isWeeklyFocus'='true')>=3 then raise sqlstate 'PT409' using message='本周重点最多3个，请先取消其他标的'; end if;
 perform pg_advisory_xact_lock(hashtextextended('watch:'||(p_document->>'symbol'),0));
 select revision into old_revision from watch_items where symbol=p_document->>'symbol';
 if coalesce(old_revision,0)<>p_revision then raise sqlstate 'PT409' using message='记录已更新，请重新载入'; end if;
 if jsonb_array_length(coalesce(p_document->'images','[]'))>9 then raise exception '最多9张图片'; end if;
 -- Lock in stable order so competing saves and deletion cannot race.
 perform 1 from image_uploads where id in (select replace(x->>'url','/api/images/','') from jsonb_array_elements(coalesce(p_document->'images','[]')) x) order by id for update;
 for item in select value from jsonb_array_elements(coalesce(p_document->'images','[]')) loop
  if item->>'url' like '/api/images/%' then
   select * into img from image_uploads where id=substring(item->>'url' from 13);
   if not found or img.owner<>p_owner or img.state not in ('temporary','attached') or (img.post_slug is not null and img.post_slug<>('watch:'||(p_document->>'symbol'))) then raise sqlstate 'PT409' using message='图片未完成上传或不属于当前记录'; end if;
   total=total+coalesce((img.document->>'fileSize')::bigint,0);
   normalized=normalized||jsonb_build_array(img.document||jsonb_build_object('alt',coalesce(item->>'alt','研究配图'),'caption',coalesce(item->>'caption',''),'isPreview',coalesce((item->>'isPreview')::boolean,false),'sortOrder',idx));
   update image_uploads set state='attached',post_slug='watch:'||(p_document->>'symbol') where id=img.id;
  else
   if coalesce(item->>'storagePath','')<>'' then raise exception 'Invalid image storage path'; end if;
   normalized=normalized||jsonb_build_array(item||jsonb_build_object('sortOrder',idx));
  end if;
  idx=idx+1;
 end loop;
 if total>52428800 then raise exception '图片总大小不能超过50MB'; end if;
 result=(p_document-'revision')||jsonb_build_object('images',normalized);
 insert into watch_items(symbol,document,revision) values(result->>'symbol',result,p_revision+1)
 on conflict(symbol) do update set document=excluded.document,revision=excluded.revision;
 return result||jsonb_build_object('revision',p_revision+1);
end $$;
revoke all on function public.save_research_watch(jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.save_research_watch(jsonb,integer,text) to service_role;


create or replace function public.save_post_with_watch(p_document jsonb,p_revision integer,p_owner text,p_sync jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved jsonb; old_document jsonb; old_revision integer; next_watch jsonb; symbol_key text=p_document->>'symbol';
begin
 if p_document->>'status'<>'published' or p_document->>'format'<>'short' or coalesce(symbol_key,'')='' or coalesce(p_document->>'trendStage','') not in ('准备','启动','运行','高潮','失效') then raise exception 'Invalid synchronized post'; end if;
 -- Same lock order as independent observation saves; both writes roll back on conflict.
 perform pg_advisory_xact_lock(hashtextextended('watch-focus-limit',0));
 perform pg_advisory_xact_lock(hashtextextended('watch:'||symbol_key,0));
 select document,revision into old_document,old_revision from watch_items where symbol=symbol_key;
 if coalesce(old_revision,0)<>(p_sync->>'revision')::integer then raise sqlstate 'PT409' using message='观察池已更新，请刷新后重新同步'; end if;
 if old_document is not null and old_document->>'market'<>p_document->>'market' then raise sqlstate 'PT409' using message='已有同名标的属于其他市场，请核对市场和标的代码'; end if;
 saved=public.save_research_article(p_document,p_revision,p_owner);
 next_watch=coalesce(old_document,jsonb_build_object('symbol',symbol_key,'name',symbol_key,'market',p_document->>'market','images','[]'::jsonb,'isWeeklyFocus',false))||jsonb_build_object(
 'stage',p_document->>'trendStage','thesis',p_sync->>'summary',
 'invalidation',coalesce(nullif(p_sync->>'invalidation',''),old_document->>'invalidation','尚未设置'),
 'updatedAt',to_char(now() at time zone 'Asia/Shanghai','YYYY-MM-DD'),
 'articleSlug',p_document->>'slug');
 perform public.save_research_watch(next_watch,coalesce(old_revision,0),p_owner);
 return saved;
end $$;
revoke all on function public.save_post_with_watch(jsonb,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_post_with_watch(jsonb,integer,text,jsonb) to service_role;
commit;
