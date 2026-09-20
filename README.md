# WhatsApp Outbound Gateway Microservice (Baileys v7)

Microservice pengirim pesan WhatsApp yang dikhususkan untuk **OTP dan notifikasi teks** (send-only), dibangun di atas **Baileys v7 (`@whiskeysockets/baileys`)** dan **Express 5**. Manajemen logika OTP dilakukan oleh aplikasi konsumen; gateway hanya menjadi jalur pengiriman yang aman.

> **Dokumen Terkait:**
> * **[DOKUMENTASI_API.md](./DOKUMENTASI_API.md)** — Spesifikasi detail endpoint REST API headless, tabel parameter, kode error, dan contoh integrasi (PHP, JavaScript/Node.js, Python, cURL).

---

## Fitur Utama

* **Baileys v7 Modern:** Arsitektur Pure ESM, dukungan penuh LIDs (*Linked Identity JIDs*), dan ACKs dinonaktifkan secara *default* (*Anti-Ban protection*).
* **Optimasi Performa & Memory:** Caching Signal Key Store (`makeCacheableSignalKeyStore`) dan `msgRetryCounterCache` (NodeCache) untuk efisiensi pengiriman dan perlindungan disk I/O.
* **Proteksi Anti-Restriction:** Circuit breaker bertingkat untuk sinyal 463/tctoken, kuota pengirim sliding-window (per jam & per hari), pre-warm privacy token (tcToken) sebelum kirim 1:1, dan penolakan kirim ke nomor tak terdaftar.
* **Server ACK Await:** Respons HTTP dapat menunggu konfirmasi server WhatsApp (centang 1) sebelum dinyatakan sukses.
* **Target Personal Saja:** Normalisasi format nomor (`08xxx`, `628xxx`); nomor grup dan format lain ditolak untuk menjaga reputasi akun.
* **REST API Terproteksi:** Autentikasi API Key aman (*timing-safe*) via header `x-api-key` atau `Authorization: Bearer <token>`.
* **Rate Limiting & Anti-Spam:** Jaring pengaman limit IP, dedup pesan per nomor tujuan (cooldown 60 detik, maks 5/jam), serta proteksi payload size.
* **Housekeeping Sesi Otomatis:** Pembersihan file pre-key usang secara berkala menjaga ukuran direktori sesi tetap ringkas.
* **Monitoring & Health Check:** Endpoint `GET /health` menyertakan info *uptime* dan penggunaan memori RAM Heap Node.js.

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

# Rate limiting
RATE_LIMIT_SEND_PER_MINUTE=60
RATE_LIMIT_PAIR_PER_MINUTE=5
OTP_COOLDOWN_SECONDS=60
OTP_MAX_PER_PHONE_PER_HOUR=5
TRUST_PROXY=false
```

> **`API_KEY` wajib diisi.** Server menolak berjalan (*fail-fast*) tanpa kunci. Buat kunci kuat dengan:
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
Buka WhatsApp di HP: **Perangkat Tertaut**, pilih **Tautkan dengan nomor telepon saja**, lalu masukkan kode 8 digit.

**Metode 2 — QR Code (JSON Data URL):**
```bash
curl http://localhost:3001/qr/raw -H "x-api-key: $API_KEY_ANDA"
```
Render nilai `qr_data_url` pada tag `<img>` di panel admin Anda, lalu pindai melalui HP: **Perangkat Tertaut**, pilih **Tautkan Perangkat**.

---

## Ringkasan Endpoint REST API

Semua endpoint kecuali `GET /` dan `GET /health` dilindungi oleh API Key via header `x-api-key` atau `Authorization: Bearer`.

| Method | Endpoint | Fungsi & Deskripsi |
|---|---|---|
| `GET` | `/` | Service Discovery & Metadata gateway (Public) |
| `GET` | `/health` | Health check, Uptime, & RAM Heap Memory metrics (Public) |
| `GET` | `/status` | Cek kondisi koneksi WhatsApp, circuit breaker, & kuota pengirim (Protected) |
| `GET` | `/audit/:messageId` | Rekonsiliasi status pengiriman dari audit log (Protected) |
| `GET` | `/qr/raw` | QR pairing Data URL JSON untuk dashboard admin (Protected) |
| `POST` | `/pair-code` | Request 8-digit Pairing Code tanpa kamera (Protected) |
| `POST` | `/send-message` | Kirim pesan teks ke nomor personal; isi pesan (termasuk template OTP) dirakit sepenuhnya oleh konsumen (Protected) |
| `POST` | `/restart` | Restart koneksi socket tanpa menghapus sesi login (Protected) |
| `POST` | `/logout` | Logout sesi & bersihkan storage kredensial (Protected) |

> Untuk contoh JSON request/response lengkap, silakan buka **[DOKUMENTASI_API.md](./DOKUMENTASI_API.md)**.

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

### 3. Runbook Restart Aman (Penting untuk OTP)
Seluruh pengaman anti-abuse berada **di RAM** dan **tereset setiap kali proses restart** (baik manual `pm2 restart` maupun otomatis karena crash): kuota pengirim 30/jam & 200/hari, cooldown OTP per nomor, dan penyimpanan `Idempotency-Key`. Ini membawa dua konsekuensi yang harus dipahami operator:

1. **Jangan restart saat jam sibuk OTP.** Lakukan restart/deploy pada jendela sepi (mis. dini hari), karena restart mengisi ulang kuota dan menghapus cooldown yang sedang berjalan.
2. **Risiko OTP dobel pasca-restart.** Bila konsumen melakukan retry dengan `Idempotency-Key` yang sama tepat setelah gateway restart, key lama sudah hilang sehingga gateway menganggapnya permintaan baru dan **dapat mengirim OTP kedua**. Panduan konsumen: setelah menerima error jaringan/503, jangan retry buta; cek dulu status pengiriman sebelumnya.

**Rekonsiliasi status pengiriman.** Setiap percobaan kirim (sukses maupun gagal) dicatat ke audit log append-only `logs/audit.jsonl` dengan nomor telepon ter-mask dan tanpa konten OTP. Untuk memeriksa nasib sebuah pengiriman (khususnya respons `504` yang ambigu), gunakan endpoint:
```bash
curl http://127.0.0.1:3001/audit/<MESSAGE_ID> -H "x-api-key: $API_KEY_ANDA"
```
Respons memuat `result` (`success` atau `failed`), `http_status`, `code`, `ref_id`, dan `latency_ms`, sehingga operator dapat membedakan "terkirim tapi ACK hilang" dari "memang gagal". Perilaku ini dapat diatur via `AUDIT_LOG_ENABLED`, `AUDIT_LOG_FILE`, dan `AUDIT_INDEX_MAX`.

---

## Verifikasi

```bash
npm run lint            # ESLint (flat config)
npm test                # Suite test utama: HTTP + service dengan mock sock, aman tanpa koneksi WhatsApp
npm run test:integration# Smoke test kontrak HTTP, butuh gateway berjalan di PORT
```

Suite `npm test` tidak pernah mengirim pesan nyata dan tidak memerlukan sesi WhatsApp; koneksi socket dimock penuh. Gunakan `npm run test:integration` hanya terhadap gateway yang sengaja dijalankan untuk verifikasi.
