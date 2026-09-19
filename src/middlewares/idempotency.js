export const createIdempotencyMiddleware = (store) => {
  return (req, res, next) => {
    const rawKey = req.headers['idempotency-key'];
    if (!rawKey || String(rawKey).trim() === '') return next();

    const key = String(rawKey).trim().slice(0, 128);

    const existing = store.get(key);
    if (existing) {
      if (existing.pending) {
        return res.status(409).json({
          status: 'error',
          code: 'IDEMPOTENCY_IN_PROGRESS',
          message: 'Permintaan dengan Idempotency-Key yang sama sedang diproses.',
        });
      }
      res.set('Idempotent-Replay', 'true');
      return res.status(existing.statusCode).json(existing.body);
    }

    store.begin(key);
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      store.complete(key, res.statusCode, body);
      return originalJson(body);
    };
    return next();
  };
};
