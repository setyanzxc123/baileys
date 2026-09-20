import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  getRootDiscovery,
  getHealth,
  getStatus,
  getAudit,
} from '../controllers/systemController.js';

const router = Router();

router.get('/', getRootDiscovery);
router.get('/health', getHealth);
router.get('/status', requireAuth, getStatus);
router.get('/audit/:messageId', requireAuth, getAudit);

export default router;
