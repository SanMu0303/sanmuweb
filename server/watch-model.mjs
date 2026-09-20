// Public observation projections.  Active observations contain execution
// details, so their public shape must be built before leaving the server.
const endedStates = new Set(['ended', '已结束', '结束观察', '结束', '已结束观察']);
const ended = value => {
  const state = String(value?.observationStatus ?? value?.status ?? '').trim().toLowerCase();
  return endedStates.has(state) || !!value?.endedAt;
};
const previewText = value => {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const first = text.split(/[。！？!?\n]/)[0].trim();
  return (first || text).slice(0, 120);
};
const safeLabel = (value, fallback) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text || /(?:做多|做空|买入|卖出|入场|止盈|止损|仓位|目标价|价格|突破|跌破|\b(?:long|short|entry|stop(?:loss)?|take\s*profit|position|leverage|buy|sell)\b|\d+(?:\.\d+)?\s*(?:%|倍|美元|USDT|USD|CNY|元|点)?)/i.test(text)) return fallback;
  return text.slice(0, 100);
};
const safeTicker = value => {
  const ticker = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9._-]{1,20}$/.test(ticker) ? ticker : '';
};
// `summary` is often generated from a member post by the sync transaction and
// must never be assumed safe. Only an explicitly labelled publicSummary can
// cross the active-cycle boundary.
const safeActivePreview = value => {
  const preview = previewText(value?.publicSummary);
  return preview && !/(?:做多|做空|买入|卖出|入场|止盈|止损|仓位|目标价|价格|突破|跌破|\b(?:long|short|entry|stop(?:loss)?|take\s*profit|position|leverage|buy|sell)\b|\d+(?:\.\d+)?\s*(?:%|倍|美元|USDT|USD|CNY|元|点)?)/i.test(preview)
    ? preview
    : '当前正在持续观察，完整判断和后续更新仅限会员查看。';
};
const memberPrompt = {
  label: '会员专享',
  title: '会员专享 · 完整观察记录',
  description: '观察结束后免费公开',
  cta: '开通会员',
};
// Fixed placeholder glyphs intentionally contain no source text or
// source-derived lengths. They are safe to render as a blurred content body.
const memberMaskedLines = [
  '••••••••••••••••••••••',
  '••••••••••••••••',
  '••••••••••••••••••••••••',
  '••••••••••••••••••',
  '••••••••••••••••••••••',
];

const publicImages = images => Array.isArray(images)
  ? images.map(image => {
      if (!image || typeof image !== 'object') return null;
      const {id,url,thumbnailUrl,width,height,mimeType,fileSize,sortOrder,alt,caption,isPreview}=image;
      return {id,url,thumbnailUrl,width,height,mimeType,fileSize,sortOrder,alt,caption,isPreview};
    }).filter(Boolean)
  : [];
const publicWatchFields=['id','symbol','name','market','stage','thesis','invalidation','publicSummary','summary','createdAt','updatedAt','endedAt','articleSlug','observationStatus','isWeeklyFocus','revision'];
const publicWatchBase=value=>Object.fromEntries(publicWatchFields.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));

/**
 * Ended cycles are an archive and are intentionally public. Active cycles are
 * only complete for a verified member; everyone else receives a safe card
 * shape with no thesis, invalidation, image or article resource.
 */
export function projectWatch(value, canReadMembers = false, lifecycleEnded = ended(value)) {
  if (!value) return value;
  const complete = lifecycleEnded || canReadMembers;
  const base = {...publicWatchBase(value), images: publicImages(value.images)};
  if (complete) return {...base, access: lifecycleEnded ? 'public' : 'member', locked: false, memberMessage: undefined, preview: previewText(value.thesis)};
  return {
    id: value.id, symbol: safeTicker(value.symbol), name: safeLabel(value.name, `${safeTicker(value.symbol)||'标的'}观察`),
    market: value.market, stage: value.stage,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    revision: value.revision, isWeeklyFocus: value.isWeeklyFocus,
    observationStatus: 'active',
    thesis: '',
    invalidation: '',
    summary: safeActivePreview(value),
    images: [],
    articleSlug: '',
    locked: true,
    preview: safeActivePreview(value),
    access: 'member_required',
    memberMessage: '会员专享 · 完整观察记录',
    memberPrompt: {...memberPrompt},
    maskedLines: [...memberMaskedLines],
  };
}

export function projectWatchHistory(history, canReadMembers = false, lifecycleEnded = false) {
  if (!Array.isArray(history)) return [];
  return history.map(entry => ({
    ...(entry.revision!==undefined?{revision:entry.revision}:{}),
    ...(entry.recorded_at!==undefined?{recorded_at:entry.recorded_at}:{}),
    ...(entry.recordedAt!==undefined?{recordedAt:entry.recordedAt}:{}),
    // The current cycle controls access for its whole timeline. A stale
    // endedAt flag on one historical snapshot must not unlock an active cycle.
    document: projectWatch(entry.document, canReadMembers, lifecycleEnded),
  }));
}

export function isEndedWatch(value) { return ended(value); }
