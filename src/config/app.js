import dotenv from 'dotenv';

dotenv.config();

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export const config = {
  port: parsePositiveInt(process.env.PORT, 3001),
  apiKey: process.env.API_KEY || '',
  sessionDir: process.env.SESSION_DIR || './sessions/primary',
  logLevel: process.env.LOG_LEVEL || 'silent',
  serviceName: process.env.SERVICE_NAME || 'WhatsApp Gateway',
  trustProxy: process.env.TRUST_PROXY === 'true',
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : '*',
  rateLimits: {
    sendPerMinute: parsePositiveInt(process.env.RATE_LIMIT_SEND_PER_MINUTE, 60),
    pairPerMinute: parsePositiveInt(process.env.RATE_LIMIT_PAIR_PER_MINUTE, 5),
    otpCooldownSeconds: parsePositiveInt(process.env.OTP_COOLDOWN_SECONDS, 60),
    otpMaxPerHour: parsePositiveInt(process.env.OTP_MAX_PER_PHONE_PER_HOUR, 5),
  },
  bulk: {
    maxRecipients: parsePositiveInt(process.env.BULK_MAX_RECIPIENTS, 100),
    minDelayMs: parsePositiveInt(process.env.BULK_MIN_DELAY_MS, 1000),
    defaultDelayMs: parsePositiveInt(process.env.BULK_DEFAULT_DELAY_MS, 1500),
  },
};
