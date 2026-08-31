import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import {
  getRootDiscovery,
  getHealth,
  getStatus,
} from '../controllers/systemController.js';

const router = Router();

router.get('/', getRootDiscovery);
router.get('/health', getHealth);
router.get('/status', requireAuth, getStatus);

export default router;
