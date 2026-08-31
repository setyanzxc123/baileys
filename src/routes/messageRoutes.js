import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { sendLimiter, otpCooldown, otpHourly } from '../middlewares/rateLimiter.js';
import { uploadDocument, uploadImage } from '../middlewares/upload.js';
import {
  sendMessage,
  sendOtp,
  sendDocument,
  sendImage,
  sendBulk,
  getJobStatus,
  checkNumber,
} from '../controllers/messageController.js';

const router = Router();

router.post('/send-message', requireAuth, sendLimiter, sendMessage);
router.post('/send-otp', requireAuth, sendLimiter, otpCooldown, otpHourly, sendOtp);
router.post('/send-document', requireAuth, sendLimiter, uploadDocument.single('file'), sendDocument);
router.post('/send-image', requireAuth, sendLimiter, uploadImage.single('file'), sendImage);
router.post('/send-bulk', requireAuth, sendLimiter, sendBulk);
router.get('/jobs/:job_id', requireAuth, getJobStatus);
router.post('/check-number', requireAuth, sendLimiter, checkNumber);

export default router;
