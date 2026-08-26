/**
 * Rate limiter fixed-window sederhana berbasis memori.
 * Dirancang untuk deployment single-instance (PM2 instances: 1) —
 * state tidak perlu dibagi antar proses, sehingga tidak butuh Redis.
 *
 * Kontrak keyFn: mengembalikan string kunci bucket, atau `null` untuk
 * melewati limit (mis. payload belum layak dihitung karena validasi
 * akan menolaknya dengan 4xx).
 */

const sweepInterval = (windowMs) => Math.min(windowMs, 60_000);

export function createRateLimiter(options) {
  const {
    windowMs,
    max,
    keyFn,
    errCode = 'RATE_LIMITED',
    errMessage = 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
  } = options;

  const buckets = new Map(); // key -> { count, resetAt }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now > bucket.resetAt) buckets.delete(key);
    }
  }, sweepInterval(windowMs));
  sweeper.unref?.();

  return (req, res, next) => {
    const key = keyFn(req);
    if (key === null || key === undefined) return next();

    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    const resetSec = Math.ceil((bucket.resetAt - now) / 1000);

    if (bucket.count >= max) {
      res.set('Retry-After', String(resetSec));
      return res.status(429).json({
        status: 'error',
        code: errCode,
        message: `${errMessage} Coba lagi dalam ${resetSec} detik.`,
        retry_after_seconds: resetSec,
      });
    }

    bucket.count += 1;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.set('RateLimit-Reset', String(resetSec));
    return next();
  };
}

/**
 * IP klien untuk key bucket per-pemanggil.
 * Fail-closed: jika req.ip tidak tersedia/melempar (mis. Express 5 di
 * belakang proxy tanpa trust proxy), semua permintaan berbagi satu bucket
 * 'unknown' — lebih ketat daripada kehilangan proteksi.
 */
export const clientIpKey = (req) => {
  try {
    return `ip:${req.ip || 'unknown'}`;
  } catch {
    return 'ip:unknown';
  }
};
