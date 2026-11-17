import { parseTrackShare } from '../shared/track-share';
import { context, getShareData } from '@devvit/web/client';
const key = 'reddit-racer:pending-track-share:v1';
/** Bridge splash to expanded mode if a host omits share data from the new view. */
export function rememberShareForExpansion(): void {
  let raw: string | undefined;
  try {
    raw = getShareData();
  } catch {
    return;
  }
  // Invalid native links must not silently open a different daily course.
  if (raw !== undefined) parseTrackShare(raw);
  try {
    sessionStorage.removeItem(key);
    if (raw !== undefined && context?.postId)
      sessionStorage.setItem(
        key,
        JSON.stringify({ raw, post: context.postId, at: Date.now() })
      );
  } catch {
    /* Native host data remains primary; storage is an optional bridge. */
  }
}
export function readIncomingShare(): string | undefined {
  let direct: string | undefined;
  try {
    direct = getShareData();
  } catch {
    /* Local browser has no Reddit host. */
  }
  try {
    const stored = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (direct !== undefined) return direct;
    if (stored) {
      const data: unknown = JSON.parse(stored);
      if (
        data &&
        typeof data === 'object' &&
        'post' in data &&
        Boolean(context?.postId) &&
        data.post === context?.postId &&
        'at' in data &&
        typeof data.at === 'number' &&
        Date.now() >= data.at &&
        Date.now() - data.at < 120_000 &&
        'raw' in data &&
        typeof data.raw === 'string' &&
        data.raw.length <= 1024
      )
        return data.raw;
    }
  } catch {
    /* Do not trust or depend on unavailable storage. */
  }
  return direct;
}
