import { waClient } from '../services/baileysService.js';
import { auditService } from '../services/auditService.js';
import { config } from '../config/app.js';
import { DEFAULT_OTP_TEMPLATES, OTP_PLACEHOLDERS } from '../utils/otpTemplateHelper.js';

export const getRootDiscovery = (req, res) => {
  return res.json({
    name: config.serviceName,
    version: '1.0.0',
    engine: 'Baileys v7',
    status: 'running',
    endpoints: {
      status: 'GET /status (Protected)',
      qr_raw: 'GET /qr/raw (Protected)',
      health: 'GET /health',
      send_otp: 'POST /send-otp (Protected)',
      send_message: 'POST /send-message (Protected)',
      pair_code: 'POST /pair-code (Protected)',
      logout: 'POST /logout (Protected)',
      restart: 'POST /restart (Protected)',
      audit: 'GET /audit/:messageId (Protected)',
      otp_templates: 'GET /otp-templates (Protected)',
    },
  });
};

export const getHealth = (req, res) => {
  const mem = process.memoryUsage();

  return res.json({
    status: 'ok',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: {
      rss_mb: (mem.rss / 1024 / 1024).toFixed(1),
      heap_used_mb: (mem.heapUsed / 1024 / 1024).toFixed(1),
    },
    whatsapp: {
      connected: waClient.getStatus().connected,
    },
  });
};

export const getStatus = (req, res) => {
  return res.json({
    status: 'success',
    data: waClient.getStatus(),
  });
};

export const getOtpTemplates = (req, res) => {
  return res.json({
    status: 'success',
    data: {
      templates: DEFAULT_OTP_TEMPLATES,
      placeholders: OTP_PLACEHOLDERS,
      spintax: '{pilihan1|pilihan2|pilihan3}',
      custom_template_rule: "Template kustom dikirim via field 'template' pada POST /send-otp dan wajib memuat placeholder {{otp}}.",
    },
  });
};

export const getAudit = (req, res) => {
  const messageId = String(req.params.messageId || '');
  const entry = auditService.find(messageId);

  if (!entry) {
    return res.status(404).json({
      status: 'error',
      code: 'AUDIT_NOT_FOUND',
      message: `Tidak ada catatan pengiriman untuk message_id '${messageId}'.`,
    });
  }

  return res.json({
    status: 'success',
    data: entry,
  });
};
