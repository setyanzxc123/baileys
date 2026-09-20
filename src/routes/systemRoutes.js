import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  getRootDiscovery,
  getHealth,
  getStatus,
  getAudit,
  getOtpTemplates,
} from '../controllers/systemController.js';

const router = Router();

router.get('/', getRootDiscovery);
router.get('/health', getHealth);
router.get('/status', requireAuth, getStatus);
router.get('/audit/:messageId', requireAuth, getAudit);
router.get('/otp-templates', requireAuth, getOtpTemplates);

export default router;
