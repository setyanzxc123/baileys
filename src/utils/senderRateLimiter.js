export const createSenderRateLimiter = ({ maxPerHour = 30, maxPerDay = 200 } = {}) => {
  const HOUR_MS = 3600000;
  const DAY_MS = 86400000;
  let timestamps = [];

  return {
    tryConsume(now = Date.now()) {
      timestamps = timestamps.filter((t) => now - t < DAY_MS);
      const hourCount = timestamps.filter((t) => now - t < HOUR_MS).length;

      if (hourCount >= maxPerHour) {
        const oldestInHour = timestamps.find((t) => now - t < HOUR_MS);
        return { allowed: false, tier: 'hour', retryAfterMs: oldestInHour ? HOUR_MS - (now - oldestInHour) : HOUR_MS };
      }
      if (timestamps.length >= maxPerDay) {
        return { allowed: false, tier: 'day', retryAfterMs: DAY_MS - (now - timestamps[0]) };
      }
      timestamps.push(now);
      return { allowed: true, tier: null, retryAfterMs: 0 };
    },

    snapshot(now = Date.now()) {
      const active = timestamps.filter((t) => now - t < DAY_MS);
      return {
        max_per_hour: maxPerHour,
        max_per_day: maxPerDay,
        used_hour: active.filter((t) => now - t < HOUR_MS).length,
        used_day: active.length,
      };
    },

    reset() {
      timestamps = [];
    },
  };
};
