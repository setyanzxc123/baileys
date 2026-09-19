export const createIdempotencyStore = ({ ttlMs = 600000, maxKeys = 1000 } = {}) => {
  const entries = new Map();

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now > entry.expiresAt) entries.delete(key);
    }
  }, Math.min(ttlMs, 60000));
  sweeper.unref?.();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        entries.delete(key);
        return null;
      }
      return entry;
    },

    begin(key) {
      const now = Date.now();
      for (const [existingKey, entry] of entries) {
        if (now > entry.expiresAt) entries.delete(existingKey);
      }
      if (entries.size >= maxKeys && !entries.has(key)) {
        const oldest = entries.keys().next().value;
        entries.delete(oldest);
      }
      entries.set(key, { pending: true, expiresAt: now + ttlMs });
    },

    complete(key, statusCode, body) {
      const existing = entries.get(key);
      entries.set(key, {
        pending: false,
        statusCode,
        body,
        expiresAt: existing?.expiresAt || Date.now() + ttlMs,
      });
    },

    size() {
      return entries.size;
    },
  };
};
