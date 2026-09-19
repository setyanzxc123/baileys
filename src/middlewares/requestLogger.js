import { logger } from '../utils/logger.js';

export const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/qr') && !req.path.startsWith('/health')) {
      logger.info({ method: req.method, path: req.path, statusCode: res.statusCode, durationMs: duration }, '[HTTP]');
    }
  });
  next();
};
