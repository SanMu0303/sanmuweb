/**
 * Keep the last successful leaderboard snapshot in the browser.  The server
 * may also know a previous rank, but this gives a stable in-session movement
 * indicator even when serverless instances rotate.
 */
export function decorateContractHeatItems(items, previousRanks, hasSnapshot) {
  const source = Array.isArray(items) ? items : [];
  const nextRanks = new Map();

  const ranked = source.slice(0, 20).map((item, index) => {
    const rank = Number.isFinite(Number(item?.rank))
      ? Number(item.rank)
      : index + 1;
    const symbol = String(item?.symbol || "").toUpperCase();
    const previousRank = symbol ? previousRanks.get(symbol) : undefined;
    const existedBefore = hasSnapshot && Number.isFinite(previousRank);

    if (symbol) nextRanks.set(symbol, rank);

    return {
      ...item,
      rank,
      // The first response is intentionally neutral.  Calling every entry
      // “NEW” before this browser has seen a prior ranking is misleading.
      previousRank: existedBefore ? previousRank : null,
      rankChange: existedBefore ? previousRank - rank : null,
      isNew: hasSnapshot && Boolean(symbol) && !previousRanks.has(symbol),
      firstSnapshot: !hasSnapshot,
    };
  });

  return { items: ranked, nextRanks };
}
