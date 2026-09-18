import { waClient } from '../services/baileysService.js';
import { config } from '../config/app.js';

export const getRootDiscovery = (req, res) => {
  return res.json({
    name: config.serviceName,
    version: '1.0.0',
    engine: 'Baileys v7',
    status: 'running',
    whatsapp: waClient.getStatus(),
    endpoints: {
      status: 'GET /status (Protected)',
      qr_raw: 'GET /qr/raw (Protected)',
      health: 'GET /health',
      send_otp: 'POST /send-otp (Protected)',
      send_message: 'POST /send-message (Protected)',
      pair_code: 'POST /pair-code (Protected)',
      logout: 'POST /logout (Protected)',
      restart: 'POST /restart (Protected)',
    },
  });
};

export const getHealth = (req, res) => {
  const wa = waClient.getStatus();
  const mem = process.memoryUsage();

  return res.json({
    status: 'ok',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: {
      rss_mb: (mem.rss / 1024 / 1024).toFixed(1),
      heap_used_mb: (mem.heapUsed / 1024 / 1024).toFixed(1),
    },
    whatsapp: wa,
  });
};

export const getStatus = (req, res) => {
  return res.json({
    status: 'success',
    data: waClient.getStatus(),
  });
};
