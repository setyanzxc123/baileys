import fs from 'fs';
import { config } from '../config/app.js';
import { logger } from '../utils/logger.js';

export class SessionService {
  constructor(sessionDir = config.sessionDir) {
    this.sessionDir = sessionDir;
  }

  ensureDirectory() {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  clearSession() {
    try {
      if (fs.existsSync(this.sessionDir)) {
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }
    } catch (err) {
      logger.error({ err }, '[WA-GATEWAY] Gagal menghapus direktori sesi');
    }
  }
}

export const sessionService = new SessionService();
