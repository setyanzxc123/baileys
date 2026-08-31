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

  getLockFilePath() {
    return path.join(this.sessionDir, 'gateway.pid');
  }

  isProcessAlive(pid) {
    if (!pid || typeof pid !== 'number' || isNaN(pid)) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err.code === 'EPERM';
    }
  }

  acquireLock() {
    this.ensureDirectory();
    const lockPath = this.getLockFilePath();

    if (fs.existsSync(lockPath)) {
      try {
        const rawContent = fs.readFileSync(lockPath, 'utf8').trim();
        const existingPid = parseInt(rawContent, 10);

        if (existingPid && existingPid !== process.pid) {
          if (this.isProcessAlive(existingPid)) {
            const errorMsg = `FATAL: Gateway sudah berjalan pada PID ${existingPid}. Hanya 1 instance yang diizinkan.`;
            console.error(`[WA-GATEWAY] ${errorMsg}`);
            throw new Error(errorMsg);
          }
          console.warn(`[WA-GATEWAY] Ditemukan stale lock dari PID ${existingPid} yang sudah mati. Membersihkan lock lama...`);
        }
      } catch (err) {
        if (err.message && err.message.startsWith('FATAL:')) {
          throw err;
        }
      }
    }

    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'w' });
    } catch (err) {
      console.error('[WA-GATEWAY] Gagal menulis lockfile:', err.message);
      throw err;
    }
  }

  releaseLock() {
    try {
      const lockPath = this.getLockFilePath();
      if (fs.existsSync(lockPath)) {
        const rawContent = fs.readFileSync(lockPath, 'utf8').trim();
        const existingPid = parseInt(rawContent, 10);
        if (existingPid === process.pid) {
          fs.unlinkSync(lockPath);
        }
      }
    } catch {
      // Ignore cleanup error during shutdown
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
        if (file === 'creds.json' || file === 'gateway.pid' || file.startsWith('app-state-sync-key')) {
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
