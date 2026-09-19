import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { sendLimiter, otpCooldown, otpHourly } from '../middlewares/rateLimiter.js';
import { createIdempotencyMiddleware } from '../middlewares/idempotency.js';
import { createIdempotencyStore } from '../utils/idempotencyStore.js';
import { config } from '../config/app.js';
import { sendMessage, sendOtp } from '../controllers/messageController.js';

const idempotencyGuard = createIdempotencyMiddleware(
  createIdempotencyStore({
    ttlMs: config.idempotency.ttlMs,
    maxKeys: config.idempotency.maxKeys,
  })
);

const router = Router();

router.post('/send-message', requireAuth, idempotencyGuard, sendLimiter, sendMessage);
router.post('/send-otp', requireAuth, idempotencyGuard, sendLimiter, otpCooldown, otpHourly, sendOtp);

export default router;
