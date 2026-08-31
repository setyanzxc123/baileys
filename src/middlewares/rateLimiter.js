import { config } from '../config/app.js';
import { OTP_PATTERN } from '../config/constants.js';
import { cleanPhoneNumber } from '../utils/jidHelper.js';

const sweepInterval = (windowMs) => Math.min(windowMs, 60000);

export function createRateLimiter(options) {
  const {
    windowMs,
    max,
    keyFn,
    errCode = 'RATE_LIMITED',
    errMessage = 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
  } = options;

  const buckets = new Map();

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

export const clientIpKey = (req) => {
  try {
    return `ip:${req.ip || 'unknown'}`;
  } catch {
    return 'ip:unknown';
  }
};

export const otpPhoneKey = (req) => {
  const body = req.body || {};
  if (!body.phone || !body.otp) return null;
  if (!OTP_PATTERN.test(String(body.otp))) return null;
  const clean = cleanPhoneNumber(body.phone);
  return clean ? `otp:${clean}` : null;
};

export const sendLimiter = createRateLimiter({
  windowMs: 60000,
  max: config.rateLimits.sendPerMinute,
  keyFn: clientIpKey,
  errMessage: 'Batas permintaan endpoint pengiriman per menit telah terlampaui.',
});

export const pairLimiter = createRateLimiter({
  windowMs: 60000,
  max: config.rateLimits.pairPerMinute,
  keyFn: clientIpKey,
  errMessage: 'Batas operasi device (pairing/logout/restart) per menit telah terlampaui.',
});

export const otpCooldown = createRateLimiter({
  windowMs: config.rateLimits.otpCooldownSeconds * 1000,
  max: 1,
  keyFn: otpPhoneKey,
  errCode: 'OTP_COOLDOWN',
  errMessage: 'OTP ke nomor ini baru saja dikirim.',
});

export const otpHourly = createRateLimiter({
  windowMs: 3600000,
  max: config.rateLimits.otpMaxPerHour,
  keyFn: otpPhoneKey,
  errCode: 'OTP_HOURLY_LIMIT',
  errMessage: 'Batas maksimum OTP per nomor dalam satu jam telah tercapai.',
});
