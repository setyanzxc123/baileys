import fs from 'fs';
import path from 'path';
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

  housekeep(maxAgeHours = 48) {
    if (!fs.existsSync(this.sessionDir)) return { cleanedCount: 0 };

    let cleanedCount = 0;
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    try {
      const files = fs.readdirSync(this.sessionDir);

      for (const file of files) {
        if (file === 'creds.json' || file.startsWith('app-state-sync-key')) {
          continue;
        }

        if (file.startsWith('pre-key-') || file.startsWith('session-') || file.startsWith('sender-key-')) {
          const filePath = path.join(this.sessionDir, file);
          try {
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > maxAgeMs) {
              fs.unlinkSync(filePath);
              cleanedCount++;
            }
          } catch {
            // Ignore individual file stat/unlink error
          }
        }
      }
    } catch (err) {
      logger.error({ err }, '[WA-GATEWAY] Gagal menjalankan housekeeping sesi');
    }

    return { cleanedCount };
  }
}

export const sessionService = new SessionService();
