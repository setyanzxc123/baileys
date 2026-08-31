import { Router } from 'express';
import systemRoutes from './systemRoutes.js';
import authRoutes from './authRoutes.js';
import messageRoutes from './messageRoutes.js';

const router = Router();

router.use(systemRoutes);
router.use(authRoutes);
router.use(messageRoutes);

export default router;
