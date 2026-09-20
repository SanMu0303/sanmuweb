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
// `summary` is often generated from a member post by the sync transaction and
// must never be assumed safe. Only an explicitly labelled publicSummary can
// cross the active-cycle boundary.
const safeActivePreview = value => previewText(value?.publicSummary) || '当前正在持续观察，完整判断和后续更新仅限会员查看。';
const publicImages = images => Array.isArray(images)
  ? images.map(({storagePath, ...image}) => image)
  : [];

/**
 * Ended cycles are an archive and are intentionally public. Active cycles are
 * only complete for a verified member; everyone else receives a safe card
 * shape with no thesis, invalidation, image or article resource.
 */
export function projectWatch(value, canReadMembers = false, lifecycleEnded = ended(value)) {
  if (!value) return value;
  const complete = lifecycleEnded || canReadMembers;
  const {summary: _summary, publicSummary: _publicSummary, excerpt: _excerpt, ...rest} = value;
  const base = {...rest, ...(value.publicSummary ? {publicSummary: value.publicSummary} : {}), images: publicImages(value.images)};
  if (complete) return {...base, access: lifecycleEnded ? 'public' : 'member', locked: false, memberMessage: undefined, preview: previewText(value.thesis)};
  return {
    ...base,
    thesis: '',
    invalidation: '',
    summary: safeActivePreview(value),
    images: [],
    articleSlug: '',
    locked: true,
    preview: safeActivePreview(value),
    access: 'member_required',
    memberMessage: '正在观察 · 会员内容',
  };
}

export function projectWatchHistory(history, canReadMembers = false, lifecycleEnded = false) {
  if (!Array.isArray(history)) return [];
  return history.map(entry => ({
    ...entry,
    // The current cycle controls access for its whole timeline. A stale
    // endedAt flag on one historical snapshot must not unlock an active cycle.
    document: projectWatch(entry.document, canReadMembers, lifecycleEnded),
  }));
}

export function isEndedWatch(value) { return ended(value); }
