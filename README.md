# WhatsApp Outbound Gateway Microservice (Baileys v7)

Microservice pengirim pesan WhatsApp (OTP, notifikasi, dokumen berkas, gambar, dan broadcast massal) mandiri dan agnostik, dibangun di atas **Baileys v7 (`@whiskeysockets/baileys`)** dan **Express 5**.

> 📚 **Dokumen Terkait:**
> * 📄 **[DOKUMENTASI_API.md](./DOKUMENTASI_API.md)** — Spesifikasi detail 14 endpoint REST API headless, tabel parameter, kode error, dan contoh integrasi lengkap (PHP, JavaScript/Node.js, Python, cURL).

---

## Fitur Utama

* 🚀 **Baileys v7 Modern:** Menggunakan arsitektur Pure ESM, dukungan penuh LIDs (*Linked Identity JIDs*), dan ACKs dinonaktifkan secara *default* (*Anti-Ban protection*).
* ⚡ **Optimasi Performa & Memory:** Caching Signal Key Store (`makeCacheableSignalKeyStore`) dan `msgRetryCounterCache` (NodeCache) untuk efisiensi pengiriman dan perlindungan disk I/O.
* 📦 **Asynchronous Job Queue (`POST /send-bulk`):** Respons instan `202 Accepted` non-blocking dengan `job_id`, anti-spam jitter delay terkalibrasi, serta endpoint pelacakan progres `GET /jobs/:job_id`.
* 👥 **Dukungan Personal & Grup WhatsApp:** Normalisasi otomatis format nomor ponsel (`08xxx`, `628xxx`) dan ID Grup WhatsApp (`xxx@g.us`).
* 📁 **Direct Media Upload & Streaming:** Mengirimkan berkas PDF dokumen (maks 25MB) dan gambar (maks 10MB) baik via URL publik maupun direct file upload (`multipart/form-data`).
* 🛡️ **Outbox Buffering & Resilient Socket:** Menahan pesan keluar sesaat ketika socket sedang *reconnecting* singkat (5 detik) untuk mencegah kegagalan 503 yang tidak perlu.
* 🔒 **REST API Terproteksi:** Autentikasi API Key aman (*timing-safe*) via header `x-api-key` atau `Authorization: Bearer <token>`.
* 🚦 **Rate Limiting & Anti-Spam:** Jaring pengaman limit IP, dedup OTP per nomor (cooldown 60 detik, maks 5/jam), serta proteksi payload size.
* 🧹 **Housekeeping Sesi Otomatis:** Pembersihan file pre-key usang secara berkala menjaga ukuran direktori sesi tetap ringkas.
* 📊 **Monitoring & Health Check:** Endpoint `GET /health` menyertakan info *uptime* dan penggunaan memori RAM Heap Node.js.

---

## Instalasi & Menjalankan

### 1. Prasyarat
* **Node.js:** Versi 20.0.0 atau lebih baru.
* **npm:** Versi 10.0.0 atau lebih baru.

### 2. Konfigurasi Lingkungan (.env)
Salin `.env.example` ke `.env`:
```bash
cp .env.example .env
```

Isi variabel konfigurasi di `.env`:
```ini
PORT=3001
NODE_ENV=development
SERVICE_NAME=WhatsApp Gateway
API_KEY=ubah-dengan-kunci-rahasia-yang-panjang
SESSION_DIR=./sessions/primary
LOG_LEVEL=warn
CORS_ALLOWED_ORIGINS=*

# Rate limiting
RATE_LIMIT_SEND_PER_MINUTE=60
RATE_LIMIT_PAIR_PER_MINUTE=5
OTP_COOLDOWN_SECONDS=60
OTP_MAX_PER_PHONE_PER_HOUR=5
BULK_MAX_RECIPIENTS=100
BULK_MIN_DELAY_MS=1000
BULK_DEFAULT_DELAY_MS=1500
TRUST_PROXY=false
```

> ⚠️ **`API_KEY` wajib diisi.** Server menolak berjalan (*fail-fast*) tanpa kunci. Buat kunci kuat dengan:
> ```bash
> node -e "console.log('gw_' + require('crypto').randomBytes(32).toString('hex'))"
> ```

### 3. Menjalankan Server
```bash
# Mode Development (auto-reload)
npm run dev

# Mode Production biasa
npm start

# Mode Production PM2 (gateway + monitor daemon)
pm2 start ecosystem.config.cjs

# Mode Production PM2 (gateway saja)
pm2 start ecosystem.config.cjs --only wa-gateway
```

---

## Cara Menghubungkan WhatsApp (Headless)

Gateway beroperasi secara *headless* (tanpa antarmuka web statis) — semua operasi penautan perangkat dilakukan melalui REST API yang dapat dipanggil dari dashboard admin aplikasi Anda atau terminal.

**Metode 1 — Kode Pairing 8 Digit (Direkomendasikan):**
```bash
curl -X POST http://localhost:3001/pair-code \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY_ANDA" \
  -d '{"phone": "081234567890"}'
```
Buka WhatsApp di HP ➔ **Perangkat Tertaut ➔ Tautkan dengan nomor telepon saja** ➔ Masukkan kode 8 digit.

**Metode 2 — QR Code (JSON Data URL):**
```bash
curl http://localhost:3001/qr/raw -H "x-api-key: $API_KEY_ANDA"
```
Render nilai `qr_data_url` pada tag `<img>` di panel admin Anda, lalu pindai melalui HP: **Perangkat Tertaut ➔ Tautkan Perangkat**.

---

## Ringkasan Endpoint REST API

Semua endpoint kecuali `GET /` dan `GET /health` dilindungi oleh API Key via header `x-api-key` atau `Authorization: Bearer`.

| Method | Endpoint | Fungsi & Deskripsi |
|---|---|---|
| `GET` | `/` | Service Discovery & Metadata gateway (Public) |
| `GET` | `/health` | Health check, Uptime, & RAM Heap Memory metrics (Public) |
| `GET` | `/status` | Cek kondisi koneksi WhatsApp & metadata akun (Protected) |
| `GET` | `/qr/raw` | QR pairing Data URL JSON untuk dashboard admin (Protected) |
| `POST` | `/pair-code` | Request 8-digit Pairing Code tanpa kamera (Protected) |
| `POST` | `/send-otp` | Kirim kode OTP format standar / custom template (Protected) |
| `POST` | `/send-message` | Kirim pesan teks bebas ke nomor personal atau Grup `@g.us` (Protected) |
| `POST` | `/send-document` | Kirim dokumen PDF via URL publik atau direct multipart upload (Protected) |
| `POST` | `/send-image` | Kirim gambar via URL publik atau direct multipart upload (Protected) |
| `POST` | `/send-bulk` | Antrean broadcast massal non-blocking `202 Accepted` (Protected) |
| `GET` | `/jobs/:job_id` | Cek progres dan riwayat pengiriman background job (Protected) |
| `POST` | `/check-number` | Validasi apakah nomor HP terdaftar di WhatsApp (Protected) |
| `POST` | `/restart` | Restart koneksi socket tanpa menghapus sesi login (Protected) |
| `POST` | `/logout` | Logout sesi & bersihkan storage kredensial (Protected) |

> 📖 Untuk contoh JSON request/response lengkap, silakan buka **[DOKUMENTASI_API.md](./DOKUMENTASI_API.md)**.

---

## Operasional & Monitoring Produksi

### 1. Health & WhatsApp Monitor Daemon (`scripts/monitor.js`)
Service `wa-monitor` di PM2 memantau endpoint `GET /health` setiap 30 detik (dapat diatur via `MONITOR_INTERVAL_MS`).
* Mendeteksi jika gateway mati (`HEALTH_DOWN`) atau WhatsApp terputus lebih lama dari ambang batas (`MONITOR_OFFLINE_THRESHOLD_MS`).
* Mengirimkan notifikasi JSON via webhook jika `MONITOR_WEBHOOK_URL` diisi di `.env`.

### 2. Backup Sesi Kredensial Otomatis (`scripts/backup-sessions.sh`)
Folder `sessions/` menyimpan kunci enkripsi Signal Protocol hasil pairing.
* Skrip `scripts/backup-sessions.sh` mengompres folder sesi ke format `.tar.gz` di folder `backups/` dengan retensi otomatis 14 backup terakhir.
* Pasang di cron server (misal setiap pukul 03.00 malam):
```cron
0 3 * * * cd /path/to/baileys && ./scripts/backup-sessions.sh >> /var/log/wa-backup.log 2>&1
```

---

## Pengujian Otomatis (Automated Smoke Tests)

Test suite integrasi memverifikasi seluruh lapisan Express, middleware keamanan, rate limiter, outbox buffer, dan katalog routing:

```bash
# Terminal 1: jalankan gateway
npm start

# Terminal 2: jalankan test suite
npm test
```
