import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { pairLimiter } from '../middlewares/rateLimiter.js';
import {
  getRawQr,
  requestPairCode,
  logoutSession,
  restartConnection,
} from '../controllers/authController.js';

const router = Router();

router.get('/qr/raw', requireAuth, getRawQr);
router.post('/pair-code', requireAuth, pairLimiter, requestPairCode);
router.post('/logout', requireAuth, pairLimiter, logoutSession);
router.post('/restart', requireAuth, pairLimiter, restartConnection);

export default router;
