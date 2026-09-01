export const TC_TOKEN_INDEX_KEY = '__index';

export const TC_TOKEN_BUCKET_DURATION = 604800;
export const TC_TOKEN_NUM_BUCKETS = 4;

export function isTcTokenExpired(timestamp) {
  if (timestamp === null || timestamp === undefined) return true;
  const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
  if (Number.isNaN(ts)) return true;
  const now = Math.floor(Date.now() / 1000);
  const currentBucket = Math.floor(now / TC_TOKEN_BUCKET_DURATION);
  const cutoffBucket = currentBucket - (TC_TOKEN_NUM_BUCKETS - 1);
  return ts < cutoffBucket * TC_TOKEN_BUCKET_DURATION;
}
