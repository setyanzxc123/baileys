import { config } from './config/app.js';
import { app } from './app.js';
import { waClient } from './services/baileysService.js';
import { sessionService } from './services/sessionService.js';

if (!config.apiKey || config.apiKey.trim() === '') {
  console.error('FATAL: API_KEY belum diatur. Gateway tidak akan dijalankan.');
  process.exit(1);
}

try {
  sessionService.acquireLock();
} catch {
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`[WA-GATEWAY] ${config.serviceName} aktif di port: ${config.port}`);
  console.log(`[WA-GATEWAY] API Key: ${config.apiKey.slice(0, 6)}...`);

  if (config.autostartWa) {
    waClient.init().catch((err) => {
      console.error('[WA-GATEWAY] Fatal error saat inisialisasi Baileys:', err);
    });
  }

  const housekeepingInterval = setInterval(() => {
    sessionService.housekeep(48);
  }, 12 * 60 * 60 * 1000);
  housekeepingInterval.unref?.();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[WA-GATEWAY] FATAL: Port ${config.port} sudah digunakan oleh proses lain.`);
    sessionService.releaseLock();
    process.exit(1);
  } else {
    console.error('[WA-GATEWAY] Server error:', err);
  }
});

let shuttingDown = false;
const handleShutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[WA-GATEWAY] Menerima sinyal ${signal}. Menutup server secara aman...`);

  setTimeout(() => {
    console.error('[WA-GATEWAY] Timeout penutupan 10 detik terlampaui. Keluar paksa.');
    process.exit(1);
  }, 10000);

  server.closeAllConnections?.();
  server.close(() => {
    console.log('[WA-GATEWAY] HTTP Server ditutup.');
  });

  waClient.shutdown();
  sessionService.releaseLock();

  setTimeout(() => {
    console.log('[WA-GATEWAY] Proses berhenti.');
    process.exit(0);
  }, 500);
};

process.on('unhandledRejection', (reason) => {
  console.error('[WA-GATEWAY] Unhandled Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.error('[WA-GATEWAY] Uncaught Exception:', err?.message || err);
});

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('exit', () => sessionService.releaseLock());

export { server };
