import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { waClient } from './whatsapp.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY || 'dprd_secret_wa_gateway_key_2026';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging sederhana
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/qr') && !req.path.startsWith('/health')) {
      console.log(`[HTTP] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Middleware autentikasi API Key
const requireAuth = (req, res, next) => {
  const headerKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];
  const bearerKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const queryKey = req.query.api_key;

  const key = headerKey || bearerKey || queryKey;

  if (!API_KEY || key === API_KEY) {
    return next();
  }

  return res.status(401).json({
    status: 'error',
    message: 'Akses ditolak. API Key tidak valid atau belum disertakan pada header x-api-key / Authorization Bearer.',
  });
};

// 1. Root Info & Endpoints Discovery
app.get('/', (req, res) => {
  res.json({
    name: 'DPRD WhatsApp Gateway Service',
    version: '1.0.0',
    engine: 'Baileys v7',
    status: 'running',
    whatsapp: waClient.getStatus(),
    endpoints: {
      qr_scan: 'GET /qr',
      status: 'GET /status',
      health: 'GET /health',
      send_otp: 'POST /send-otp (Protected by API Key)',
      send_message: 'POST /send-message (Protected by API Key)',
      pair_code: 'POST /pair-code (Protected by API Key)',
      logout: 'POST /logout (Protected by API Key)',
    },
  });
});

// 2. Health check & Memory Metrics
app.get('/health', (req, res) => {
  const wa = waClient.getStatus();
  const mem = process.memoryUsage();

  res.json({
    status: 'ok',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: {
      rss_mb: (mem.rss / 1024 / 1024).toFixed(1),
      heap_used_mb: (mem.heapUsed / 1024 / 1024).toFixed(1),
    },
    whatsapp: wa,
  });
});

// 3. Status WhatsApp
app.get('/status', (req, res) => {
  res.json({
    status: 'success',
    data: waClient.getStatus(),
  });
});

// 4. Laman Visual Scan QR Code & Form Pairing Code
app.get('/qr', (req, res) => {
  const status = waClient.getStatus();

  if (status.connected) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Gateway - Terhubung</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
          .card { background: #1e293b; padding: 2.5rem; border-radius: 1.25rem; text-align: center; max-width: 440px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
          .icon { font-size: 4rem; margin-bottom: 1rem; color: #22c55e; }
          h2 { margin: 0 0 0.5rem; color: #f8fafc; }
          p { color: #94a3b8; line-height: 1.5; margin: 0 0 1.5rem; font-size: 0.95rem; }
          .badge { display: inline-block; padding: 0.5rem 1rem; background: #14532d; color: #4ade80; border-radius: 9999px; font-weight: 600; font-size: 0.875rem; border: 1px solid #16a34a; }
          .phone { font-family: monospace; font-size: 1.1rem; color: #38bdf8; margin-top: 0.75rem; display: block; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✓</div>
          <h2>WhatsApp Terhubung!</h2>
          <p>Gateway siap mengirim pesan OTP dan notifikasi agenda DPRD.</p>
          <div class="badge">AKTIF & SIAP PAKAI</div>
          <span class="phone">+${status.user?.phone || 'Nomor Terdaftar'}</span>
        </div>
      </body>
      </html>
    `);
  }

  if (status.qr_available && waClient.qrDataUrl) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tautkan WhatsApp Gateway</title>
        <meta http-equiv="refresh" content="5">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
          .card { background: #1e293b; padding: 2.5rem; border-radius: 1.25rem; text-align: center; max-width: 440px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
          h2 { margin: 0 0 0.5rem; color: #f8fafc; font-size: 1.4rem; }
          p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; margin: 0 0 1.5rem; }
          .qr-box { background: white; padding: 1.25rem; border-radius: 0.875rem; display: inline-block; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3); }
          .qr-box img { display: block; width: 240px; height: 240px; }
          .footer { margin-top: 1.5rem; font-size: 0.8rem; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Tautkan Perangkat WhatsApp</h2>
          <p>Buka WhatsApp di HP ➔ Menu Titik Tiga / Pengaturan ➔ <strong>Perangkat Tertaut</strong> ➔ Pindai QR Code di bawah ini:</p>
          <div class="qr-box">
            <img src="${waClient.qrDataUrl}" alt="WhatsApp QR Code" />
          </div>
          <div class="footer">Laman otomatis memuat ulang setiap 5 detik</div>
        </div>
      </body>
      </html>
    `);
  }

  return res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Menyiapkan WhatsApp Gateway...</title>
      <meta http-equiv="refresh" content="3">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
        .card { background: #1e293b; padding: 2.5rem; border-radius: 1.25rem; text-align: center; max-width: 440px; border: 1px solid #334155; }
        .spinner { border: 4px solid #334155; border-top: 4px solid #38bdf8; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 1.5rem; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="spinner"></div>
        <h2>Menghubungkan ke WhatsApp...</h2>
        <p>Sedang menginisialisasi sesi Baileys v7. Mohon tunggu beberapa detik...</p>
      </div>
    </body>
    </html>
  `);
});

// 5. Endpoint Kirim Pesan Teks
app.post('/send-message', requireAuth, async (req, res) => {
  const { phone, message, text } = req.body;
  const content = message || text;

  if (!phone) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  if (!content) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'message' (atau 'text') wajib diisi.",
    });
  }

  try {
    const result = await waClient.sendMessage(phone, content);
    return res.json({
      status: 'success',
      message: 'Pesan berhasil dikirim via WhatsApp.',
      data: result,
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal mengirim pesan WhatsApp.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'SEND_FAILED',
    });
  }
});

// 6. Endpoint Khusus Kirim OTP (Format pesan terstandar)
app.post('/send-otp', requireAuth, async (req, res) => {
  const { phone, otp, app_name } = req.body;

  if (!phone || !otp) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' dan 'otp' wajib diisi.",
    });
  }

  const appTitle = app_name || 'DPRD Provinsi Sulawesi Tengah';
  const textMessage = `*KODE VERIFIKASI LOGIN*\n\nKode OTP Anda untuk portal *${appTitle}* adalah:\n\n👉 *${otp}*\n\n_Kode ini berlaku selama 5 menit. Jangan berikan kode ini kepada siapapun termasuk petugas._`;

  try {
    const result = await waClient.sendMessage(phone, textMessage);
    return res.json({
      status: 'success',
      message: 'Kode OTP berhasil dikirim via WhatsApp.',
      data: {
        ...result,
        otp_length: String(otp).length,
      },
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal mengirim kode OTP WhatsApp.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'SEND_FAILED',
    });
  }
});

// 7. Endpoint Request Pairing Code 8 Digit (Alternatif Scan QR)
app.post('/pair-code', requireAuth, async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  try {
    const result = await waClient.requestPairingCode(phone);
    return res.json({
      status: 'success',
      message: 'Pairing Code berhasil dibuat.',
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Gagal membuat Pairing Code.',
    });
  }
});

// 8. Endpoint Logout & Reset Sesi
app.post('/logout', requireAuth, async (req, res) => {
  try {
    await waClient.logout();
    return res.json({
      status: 'success',
      message: 'WhatsApp berhasil logout. Sesi lama telah dibersihkan. Silakan scan QR baru di /qr.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Gagal melakukan logout sesi WhatsApp.',
    });
  }
});

// Jalankan server Express dan inisialisasi Baileys v7
const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 DPRD WhatsApp Gateway (Baileys v7) aktif di port: ${PORT}`);
  console.log(`📱 Laman Scan QR: http://localhost:${PORT}/qr`);
  console.log(`🔑 API Key: ${API_KEY.slice(0, 6)}... (Protected)`);
  console.log(`====================================================`);

  // Inisialisasi koneksi WhatsApp
  waClient.init().catch((err) => {
    console.error('[WA-GATEWAY] Fatal error saat inisialisasi Baileys:', err);
  });
});

// Graceful shutdown handling
const handleShutdown = () => {
  console.log('\n[WA-GATEWAY] Menutup server secara aman...');
  server.close(() => {
    console.log('[WA-GATEWAY] HTTP Server ditutup.');
    process.exit(0);
  });
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
