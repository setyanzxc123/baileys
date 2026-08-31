import express from 'express';
import cors from 'cors';
import { config } from './config/app.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler.js';
import routes from './routes/index.js';
import { waClient } from './services/baileysService.js';

if (!config.apiKey || config.apiKey.trim() === '') {
  console.error('FATAL: API_KEY belum diatur. Gateway tidak akan dijalankan.');
  process.exit(1);
}

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(requestLogger);

app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`[WA-GATEWAY] ${config.serviceName} aktif di port: ${config.port}`);
  console.log(`[WA-GATEWAY] API Key: ${config.apiKey.slice(0, 6)}...`);

  waClient.init().catch((err) => {
    console.error('[WA-GATEWAY] Fatal error saat inisialisasi Baileys:', err);
  });
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

  setTimeout(() => {
    console.log('[WA-GATEWAY] Proses berhenti.');
    process.exit(0);
  }, 500);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

export { app, server };
