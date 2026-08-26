import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { waClient } from './whatsapp.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY || 'dprd_secret_wa_gateway_key_2026';

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
      qr_raw: 'GET /qr/raw',
      status: 'GET /status',
      health: 'GET /health',
      send_otp: 'POST /send-otp (Protected)',
      send_message: 'POST /send-message (Protected)',
      send_document: 'POST /send-document (Protected)',
      send_image: 'POST /send-image (Protected)',
      send_bulk: 'POST /send-bulk (Protected)',
      pair_code: 'POST /pair-code (Protected)',
      check_number: 'POST /check-number (Protected)',
      logout: 'POST /logout (Protected)',
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

// 4. Raw QR Data
app.get('/qr/raw', (req, res) => {
  const status = waClient.getStatus();
  res.json({
    status: 'success',
    connected: status.connected,
    qr_available: status.qr_available,
    qr_raw: waClient.qrRaw,
    qr_data_url: waClient.qrDataUrl,
  });
});

// 5. Laman Visual Scan QR Code & Form Pairing Code
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
          .card { background: #1e293b; padding: 2.5rem; border-radius: 1.25rem; text-align: center; max-width: 440px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
          .icon { font-size: 4rem; margin-bottom: 1rem; color: #22c55e; }
          h2 { margin: 0 0 0.5rem; color: #f8fafc; font-size: 1.5rem; }
          p { color: #94a3b8; line-height: 1.5; margin: 0 0 1.5rem; font-size: 0.95rem; }
          .badge { display: inline-block; padding: 0.5rem 1rem; background: #14532d; color: #4ade80; border-radius: 9999px; font-weight: 600; font-size: 0.875rem; border: 1px solid #16a34a; }
          .phone { font-family: monospace; font-size: 1.2rem; color: #38bdf8; margin-top: 1rem; display: block; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✓</div>
          <h2>WhatsApp Terhubung!</h2>
          <p>Gateway siap mengirimkan pesan OTP dan notifikasi agenda DPRD.</p>
          <div class="badge">AKTIF & SIAP PAKAI</div>
          <span class="phone">+${status.user?.phone || 'Nomor Terdaftar'}</span>
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
      <title>Tautkan WhatsApp Gateway</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
        .card { background: #1e293b; padding: 2rem; border-radius: 1.25rem; text-align: center; max-width: 460px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
        h2 { margin: 0 0 0.5rem; color: #f8fafc; font-size: 1.35rem; }
        p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; margin: 0 0 1.25rem; }
        
        .tabs { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; background: #0f172a; padding: 0.35rem; border-radius: 0.75rem; border: 1px solid #334155; }
        .tab-btn { flex: 1; padding: 0.6rem 0.5rem; border: none; background: transparent; color: #94a3b8; font-weight: 600; font-size: 0.85rem; border-radius: 0.5rem; cursor: pointer; transition: all 0.2s; }
        .tab-btn.active { background: #38bdf8; color: #0f172a; }
        
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        
        .qr-box { background: white; padding: 1rem; border-radius: 0.875rem; display: inline-block; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3); }
        .qr-box img { display: block; width: 220px; height: 220px; }
        
        .form-group { text-align: left; margin-bottom: 1rem; }
        label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: #cbd5e1; }
        input[type="text"] { width: 100%; box-sizing: border-box; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #475569; background: #0f172a; color: #f8fafc; font-size: 1rem; }
        input[type="text"]:focus { outline: none; border-color: #38bdf8; }
        
        .btn-submit { width: 100%; padding: 0.75rem; background: #38bdf8; color: #0f172a; border: none; border-radius: 0.5rem; font-weight: 700; font-size: 0.95rem; cursor: pointer; transition: background 0.2s; }
        .btn-submit:hover { background: #0ea5e9; }
        
        .code-display { margin-top: 1.25rem; padding: 1.25rem; background: #0f172a; border-radius: 0.75rem; border: 1px dashed #38bdf8; display: none; }
        .code-val { font-family: monospace; font-size: 2rem; font-weight: 800; letter-spacing: 4px; color: #4ade80; margin: 0.5rem 0; }
        
        .footer { margin-top: 1.25rem; font-size: 0.75rem; color: #64748b; }
        .spinner { border: 3px solid #334155; border-top: 3px solid #38bdf8; border-radius: 50%; width: 28px; height: 28px; animation: spin 1s linear infinite; margin: 1.5rem auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>Tautkan WhatsApp Gateway</h2>
        <p>Pilih metode untuk menautkan akun WhatsApp resmi Sekretariat DPRD:</p>
        
        <div class="tabs">
          <button class="tab-btn active" onclick="switchTab('qr')">1. Scan QR Code</button>
          <button class="tab-btn" onclick="switchTab('pair')">2. Kode Pairing 8 Digit</button>
        </div>
        
        <div id="tab-qr" class="tab-content active">
          ${
            waClient.qrDataUrl
              ? `
            <div class="qr-box">
              <img src="${waClient.qrDataUrl}" alt="WhatsApp QR Code" />
            </div>
            <p style="margin-top: 1rem; font-size: 0.85rem; color: #94a3b8;">Buka WhatsApp di HP ➔ <strong>Perangkat Tertaut</strong> ➔ Pindai QR di atas.</p>
            <div class="footer">Otomatis memuat ulang jika QR kedaluwarsa...</div>
          `
              : `
            <div class="spinner"></div>
            <p>Sedang membuat QR Code baru...</p>
          `
          }
        </div>
        
        <div id="tab-pair" class="tab-content">
          <div class="form-group">
            <label>Nomor WhatsApp Pengirim:</label>
            <input type="text" id="pairPhone" placeholder="Contoh: 081234567890 atau 6281234567890" />
          </div>
          <div class="form-group">
            <label>API Key Gateway:</label>
            <input type="text" id="pairApiKey" value="${API_KEY}" />
          </div>
          <button class="btn-submit" onclick="requestPairCode()">Dapatkan Kode Pairing</button>
          
          <div id="pairResult" class="code-display">
            <div style="font-size: 0.8rem; color: #94a3b8;">KODE PAIRING WHATSAPP:</div>
            <div id="pairCodeDisplay" class="code-val">----</div>
            <div style="font-size: 0.8rem; color: #cbd5e1; line-height: 1.4;">
              Buka WhatsApp di HP ➔ <strong>Perangkat Tertaut</strong> ➔ <strong>Tautkan dengan nomor telepon saja</strong> ➔ Masukkan 8 digit kode di atas.
            </div>
          </div>
        </div>
      </div>

      <script>
        function switchTab(type) {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          if (type === 'qr') {
            document.querySelectorAll('.tab-btn')[0].classList.add('active');
            document.getElementById('tab-qr').classList.add('active');
          } else {
            document.querySelectorAll('.tab-btn')[1].classList.add('active');
            document.getElementById('tab-pair').classList.add('active');
          }
        }

        async function requestPairCode() {
          const phone = document.getElementById('pairPhone').value.trim();
          const apiKey = document.getElementById('pairApiKey').value.trim();
          if (!phone) return alert('Silakan masukkan nomor WhatsApp.');
          
          const resultBox = document.getElementById('pairResult');
          const codeVal = document.getElementById('pairCodeDisplay');
          codeVal.innerText = 'MEMUAT...';
          resultBox.style.display = 'block';

          try {
            const res = await fetch('/pair-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
              body: JSON.stringify({ phone })
            });
            const data = await res.json();
            if (data.status === 'success') {
              codeVal.innerText = data.data.pairing_code;
            } else {
              codeVal.innerText = 'GAGAL';
              alert(data.message || 'Gagal membuat kode pairing.');
            }
          } catch(e) {
            codeVal.innerText = 'ERROR';
            alert('Terjadi kesalahan jaringan.');
          }
        }

        // Auto poll connection status
        setInterval(async () => {
          try {
            const res = await fetch('/status');
            const data = await res.json();
            if (data.data?.connected) {
              window.location.reload();
            }
          } catch(e) {}
        }, 4000);
      </script>
    </body>
    </html>
  `);
});

// 6. Endpoint Kirim Pesan Teks
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

// 7. Endpoint Khusus Kirim OTP
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

// 8. Endpoint Kirim Dokumen PDF / Berkas
app.post('/send-document', requireAuth, async (req, res) => {
  const { phone, document_url, url, file_name, filename, caption, mimetype } = req.body;
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

// 9. Endpoint Kirim Gambar
app.post('/send-image', requireAuth, async (req, res) => {
  const { phone, image_url, url, caption } = req.body;
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

// 10. Endpoint Kirim Pesan Beruntun (Bulk Broadcast)
app.post('/send-bulk', requireAuth, async (req, res) => {
  const { recipients, delay_ms } = req.body;

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

// 11. Endpoint Request Pairing Code 8 Digit
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

// 12. Endpoint Cek Nomor Terdaftar di WhatsApp
app.post('/check-number', requireAuth, async (req, res) => {
  const { phone } = req.body;

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

// 13. Endpoint Logout & Reset Sesi
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
