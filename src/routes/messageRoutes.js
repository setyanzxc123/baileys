import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { sendLimiter, otpCooldown, otpHourly } from '../middlewares/rateLimiter.js';
import { sendMessage, sendOtp } from '../controllers/messageController.js';

const router = Router();

router.post('/send-message', requireAuth, sendLimiter, sendMessage);
router.post('/send-otp', requireAuth, sendLimiter, otpCooldown, otpHourly, sendOtp);

export default router;
