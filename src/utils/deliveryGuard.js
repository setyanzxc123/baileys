export const BREAKER_463_ESCALATION_MS = [60000, 300000, 900000, 1800000];

export const createDeliveryGuard = ({ windowMs = 900000, escalations = BREAKER_463_ESCALATION_MS } = {}) => {
  let hits = [];
  let openUntil = 0;

  return {
    registerHit(now = Date.now()) {
      hits = hits.filter((t) => now - t < windowMs);
      hits.push(now);
      const index = Math.min(hits.length - 1, escalations.length - 1);
      openUntil = Math.max(openUntil, now + escalations[index]);
      return { hits: hits.length, openUntil };
    },

    isOpen(now = Date.now()) {
      return openUntil > now;
    },

    retryAfterMs(now = Date.now()) {
      return openUntil > now ? openUntil - now : 0;
    },

    snapshot(now = Date.now()) {
      return {
        open: openUntil > now,
        open_until: openUntil > now ? new Date(openUntil).toISOString() : null,
        retry_after_ms: Math.max(0, openUntil - now),
        hits_in_window: hits.filter((t) => now - t < windowMs).length,
      };
    },

    reset() {
      hits = [];
      openUntil = 0;
    },
  };
};
