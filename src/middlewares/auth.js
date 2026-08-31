import crypto from 'node:crypto';
import { config } from '../config/app.js';

const isValidApiKey = (candidate) => {
  if (!candidate || !config.apiKey) return false;
  try {
    const a = crypto.createHash('sha256').update(String(candidate)).digest();
    const b = crypto.createHash('sha256').update(String(config.apiKey)).digest();
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

export const requireAuth = (req, res, next) => {
  const headerKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];
  const bearerKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  const key = headerKey || bearerKey;

  if (key && isValidApiKey(key)) {
    return next();
  }

  return res.status(401).json({
    status: 'error',
    message: 'Akses ditolak. API Key tidak valid atau belum disertakan pada header x-api-key / Authorization Bearer.',
  });
};
