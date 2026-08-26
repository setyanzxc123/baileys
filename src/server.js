import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { waClient } from './whatsapp.js';
import { createRateLimiter, clientIpKey } from './rateLimit.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY;

// Fail-fast: gateway tidak boleh berjalan tanpa API key yang eksplisit.
// Sebelumnya ada fallback ke key default yang tercatat di git, sehingga
// produksi bisa berjalan diam-diam dengan kunci yang diketahui publik.
if (!API_KEY || API_KEY.trim() === '') {
  console.error('====================================================');
  console.error('FATAL: API_KEY belum diatur. Gateway tidak akan dijalankan.');
  console.error('Tambahkan API_KEY pada file .env, contoh membuat kunci kuat:');
  console.error('  node -e "console.log(\'gw_\' + require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('====================================================');
  process.exit(1);
}

// Saat gateway dijalankan di belakang nginx/reverse proxy, aktifkan
// TRUST_PROXY=true agar req.ip membaca IP asli dari X-Forwarded-For —
// tanpa ini semua pemanggil tampak sebagai satu IP proxy yang sama.
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Request logging
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
// Perbandingan dilakukan constant-time (timingSafeEqual via hash SHA-256)
// agar durasi respons tidak membocorkan isi kunci sedikit demi sedikit.
const isValidApiKey = (candidate) => {
  try {
    const a = crypto.createHash('sha256').update(String(candidate)).digest();
    const b = crypto.createHash('sha256').update(String(API_KEY)).digest();
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

const requireAuth = (req, res, next) => {
  const headerKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];
  const bearerKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  const key = headerKey || bearerKey;

  // Hanya via header — query string tidak diterima agar kunci tidak
  // mengendap di access log proxy maupun riwayat browser.
  if (key && isValidApiKey(key)) {
    return next();
  }

  return res.status(401).json({
    status: 'error',
    message: 'Akses ditolak. API Key tidak valid atau belum disertakan pada header x-api-key / Authorization Bearer.',
  });
};

// ============================================================
// Rate Limiting — jaring pengaman di sisi gateway.
// App konsumen tetap memegang kebijakan bisnis yang detail;
// limit di sini membatasi dampak terburuk (bug loop, key bocor,
// atau caller nakal) terhadap nomor WhatsApp institusi.
// Dijalankan SETELAH auth agar percobaan 401 tidak memakan kuota.
// ============================================================
const envInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

// Cap global per IP untuk semua endpoint yang memicu aktivitas WhatsApp
const sendLimiter = createRateLimiter({
  windowMs: 60_000,
  max: envInt(process.env.RATE_LIMIT_SEND_PER_MINUTE, 60),
  keyFn: clientIpKey,
  errMessage: 'Batas permintaan endpoint pengiriman per menit telah terlampaui.',
});

// Cap untuk operasi device yang menumbuk endpoint WhatsApp sensitif:
// pairing code, logout, dan restart koneksi
const pairLimiter = createRateLimiter({
  windowMs: 60_000,
  max: envInt(process.env.RATE_LIMIT_PAIR_PER_MINUTE, 5),
  keyFn: clientIpKey,
  errMessage: 'Batas operasi device (pairing/logout/restart) per menit telah terlampaui.',
});

// Dedup OTP per nomor: cegah spam OTP beruntun ke nomor yang sama.
// Payload tanpa phone/otp tidak dihitung (biar validasi 422 yang menolak).
const otpPhoneKey = (req) => {
  const body = req.body || {};
  if (!body.phone || !body.otp) return null;
  const clean = waClient.cleanPhoneNumber(body.phone);
  return clean ? `otp:${clean}` : null;
};

const otpCooldown = createRateLimiter({
  windowMs: envInt(process.env.OTP_COOLDOWN_SECONDS, 60) * 1000,
  max: 1,
  keyFn: otpPhoneKey,
  errCode: 'OTP_COOLDOWN',
  errMessage: 'OTP ke nomor ini baru saja dikirim.',
});

const otpHourly = createRateLimiter({
  windowMs: 3_600_000,
  max: envInt(process.env.OTP_MAX_PER_PHONE_PER_HOUR, 5),
  keyFn: otpPhoneKey,
  errCode: 'OTP_HOURLY_LIMIT',
  errMessage: 'Batas maksimum OTP per nomor dalam satu jam telah tercapai.',
});

// 1. Root Info & Endpoints Discovery
app.get('/', (req, res) => {
  res.json({
    name: 'DPRD WhatsApp Gateway Service',
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
      send_document: 'POST /send-document (Protected)',
      send_image: 'POST /send-image (Protected)',
      send_bulk: 'POST /send-bulk (Protected)',
      pair_code: 'POST /pair-code (Protected)',
      check_number: 'POST /check-number (Protected)',
      logout: 'POST /logout (Protected)',
      restart: 'POST /restart (Protected)',
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
app.get('/status', requireAuth, (req, res) => {
  res.json({
    status: 'success',
    data: waClient.getStatus(),
  });
});

// 4. Raw QR Data (JSON headless — dirender oleh panel admin melalui app backend)
app.get('/qr/raw', requireAuth, (req, res) => {
  const status = waClient.getStatus();
  res.json({
    status: 'success',
    connected: status.connected,
    qr_available: status.qr_available,
    qr_raw: waClient.qrRaw,
    qr_data_url: waClient.qrDataUrl,
  });
});

// 5. Endpoint Kirim Pesan Teks
app.post('/send-message', requireAuth, sendLimiter, async (req, res) => {
  const { phone, message, text } = req.body || {};
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

// 6. Endpoint Khusus Kirim OTP
app.post('/send-otp', requireAuth, sendLimiter, otpCooldown, otpHourly, async (req, res) => {
  const { phone, otp, app_name } = req.body || {};

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

// 7. Endpoint Kirim Dokumen PDF / Berkas
app.post('/send-document', requireAuth, sendLimiter, async (req, res) => {
  const { phone, document_url, url, file_name, filename, caption, mimetype } = req.body || {};
  const docUrl = document_url || url;
  const docName = file_name || filename || 'Undangan_DPRD.pdf';

  if (!phone) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  if (!docUrl) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'document_url' (atau 'url') wajib diisi.",
    });
  }

  try {
    const result = await waClient.sendDocument(phone, docUrl, {
      fileName: docName,
      caption: caption || '',
      mimetype: mimetype || 'application/pdf',
    });

    return res.json({
      status: 'success',
      message: 'Dokumen berhasil dikirim via WhatsApp.',
      data: result,
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal mengirim dokumen WhatsApp.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'SEND_DOCUMENT_FAILED',
    });
  }
});

// 8. Endpoint Kirim Gambar
app.post('/send-image', requireAuth, sendLimiter, async (req, res) => {
  const { phone, image_url, url, caption } = req.body || {};
  const imgUrl = image_url || url;

  if (!phone) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  if (!imgUrl) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'image_url' (atau 'url') wajib diisi.",
    });
  }

  try {
    const result = await waClient.sendImage(phone, imgUrl, caption || '');
    return res.json({
      status: 'success',
      message: 'Gambar berhasil dikirim via WhatsApp.',
      data: result,
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal mengirim gambar WhatsApp.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'SEND_IMAGE_FAILED',
    });
  }
});

// 9. Endpoint Kirim Pesan Beruntun (Bulk Broadcast)
app.post('/send-bulk', requireAuth, sendLimiter, async (req, res) => {
  const { recipients, delay_ms } = req.body || {};

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'recipients' harus berupa array yang berisi daftar pesan ({ phone, message }).",
    });
  }

  try {
    const result = await waClient.sendBulk(recipients, delay_ms || 1500);
    return res.json({
      status: 'success',
      message: `Proses pengiriman bulk selesai. Berhasil: ${result.success_count}, Gagal: ${result.failed_count}`,
      data: result,
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal menjalankan pengiriman massal.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'BULK_FAILED',
    });
  }
});

// 10. Endpoint Request Pairing Code 8 Digit
app.post('/pair-code', requireAuth, pairLimiter, async (req, res) => {
  const { phone } = req.body || {};

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

// 11. Endpoint Cek Nomor Terdaftar di WhatsApp
app.post('/check-number', requireAuth, sendLimiter, async (req, res) => {
  const { phone } = req.body || {};

  if (!phone) {
    return res.status(422).json({
      status: 'error',
      message: "Parameter 'phone' wajib diisi.",
    });
  }

  try {
    const result = await waClient.checkNumber(phone);
    return res.json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    const isOffline = !waClient.getStatus().connected;
    return res.status(isOffline ? 503 : 500).json({
      status: 'error',
      message: error.message || 'Gagal memeriksa nomor telepon.',
      code: isOffline ? 'WA_GATEWAY_OFFLINE' : 'CHECK_FAILED',
    });
  }
});

// 12. Endpoint Logout & Reset Sesi
app.post('/logout', requireAuth, pairLimiter, async (req, res) => {
  try {
    await waClient.logout();
    return res.json({
      status: 'success',
      message: 'WhatsApp berhasil logout. Sesi lama telah dibersihkan. Lakukan pairing ulang via POST /pair-code atau GET /qr/raw.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Gagal melakukan logout sesi WhatsApp.',
    });
  }
});

// 13. Endpoint Restart Koneksi Tanpa Hapus Sesi
// Untuk kasus koneksi macet namun kredensial masih valid — tidak perlu scan QR ulang.
app.post('/restart', requireAuth, pairLimiter, async (req, res) => {
  try {
    const previousStatus = waClient.getStatus().status;
    const currentStatus = await waClient.restart();

    return res.json({
      status: 'success',
      message: 'Koneksi WhatsApp dimulai ulang tanpa menghapus sesi. Pantau GET /status hingga connected.',
      data: {
        previous_status: previousStatus,
        current_status: currentStatus.status,
        connected: currentStatus.connected,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Gagal memulai ulang koneksi WhatsApp.',
      code: 'RESTART_FAILED',
    });
  }
});

// 14. Fallback 404 — tanpa ini Express menjawab HTML default; API harus konsisten JSON.
app.use((req, res) => {
  return res.status(404).json({
    status: 'error',
    code: 'NOT_FOUND',
    message: `Endpoint '${req.method} ${req.path}' tidak ditemukan.`,
  });
});

// Penangan error terakhir: menjawab JSON konsisten untuk semua kegagalan,
// termasuk error body-parser (JSON rusak = 400). Pesan error hanya
// diteruskan untuk kegagalan 4xx yang ditandai expose oleh body-parser;
// error internal disembunyikan agar stack trace dan path server tidak
// bocor ke pemanggil — cukup dicatat di log sisi server.
app.use((err, req, res, next) => {
  const isClientError = Number.isInteger(err.status) && err.status >= 400 && err.status < 500;
  const status = isClientError ? err.status : 500;
  const message = isClientError && err.expose && err.message
    ? err.message
    : 'Terjadi kesalahan internal saat memproses permintaan.';

  if (!isClientError) {
    console.error(`[HTTP] Unhandled error pada ${req.method} ${req.path}:`, err);
  }

  return res.status(status).json({
    status: 'error',
    code: isClientError ? (err.type || 'BAD_REQUEST') : 'INTERNAL_ERROR',
    message,
  });
});

// Jalankan server Express dan inisialisasi Baileys v7
const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 DPRD WhatsApp Gateway (Baileys v7) aktif di port: ${PORT}`);
  console.log(`📱 Mode headless: QR pairing via GET /qr/raw (Protected) — render di panel admin Anda`);
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
