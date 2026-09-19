import { config } from './config/app.js';
import { app } from './app.js';
import { waClient } from './services/baileysService.js';
import { sessionService } from './services/sessionService.js';
import { logger } from './utils/logger.js';

if (!config.apiKey || config.apiKey.trim() === '') {
  logger.error('FATAL: API_KEY belum diatur. Gateway tidak akan dijalankan.');
  process.exit(1);
}

try {
  sessionService.acquireLock();
} catch {
  process.exit(1);
}

const server = app.listen(config.port, config.host, () => {
  logger.info(`[WA-GATEWAY] ${config.serviceName} aktif di ${config.host}:${config.port}`);
  logger.info(`[WA-GATEWAY] API Key: ${config.apiKey.slice(0, 6)}...`);

  if (config.autostartWa) {
    waClient.init().catch((err) => {
      logger.error({ err }, '[WA-GATEWAY] Fatal error saat inisialisasi Baileys');
    });
  }

  const housekeepingInterval = setInterval(() => {
    sessionService.housekeep(48);
  }, 12 * 60 * 60 * 1000);
  housekeepingInterval.unref?.();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`[WA-GATEWAY] FATAL: Port ${config.port} sudah digunakan oleh proses lain.`);
    sessionService.releaseLock();
    process.exit(1);
  } else {
    logger.error({ err }, '[WA-GATEWAY] Server error');
  }
});

let shuttingDown = false;
const handleShutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[WA-GATEWAY] Menerima sinyal ${signal}. Menutup server secara aman...`);

  setTimeout(() => {
    logger.error('[WA-GATEWAY] Timeout penutupan 10 detik terlampaui. Keluar paksa.');
    process.exit(1);
  }, 10000);

  server.closeAllConnections?.();
  server.close(() => {
    logger.info('[WA-GATEWAY] HTTP Server ditutup.');
  });

  waClient.shutdown();
  sessionService.releaseLock();

  setTimeout(() => {
    logger.info('[WA-GATEWAY] Proses berhenti.');
    process.exit(0);
  }, 500);
};

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: reason?.message || String(reason) }, '[WA-GATEWAY] Unhandled Rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, '[WA-GATEWAY] Uncaught Exception, keluar untuk pemulihan PM2');
  process.exit(1);
});

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('exit', () => sessionService.releaseLock());

export { server };
