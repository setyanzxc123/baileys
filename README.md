# DPRD WhatsApp Gateway Microservice (Baileys v7)

Microservice pengirim pesan WhatsApp OTP, notifikasi, dokumen PDF, dan broadcast mandiri untuk ekosistem **DPRD Signage & Agenda**, dibangun di atas **Baileys v7 (`@whiskeysockets/baileys`)** dan **Express 5**.

> 📚 **Dokumen Terkait:**
> * 📄 **[DOKUMENTASI_API.md](./DOKUMENTASI_API.md)** — Spesifikasi detail 13 endpoint REST API headless, tabel parameter, kode error, dan contoh integrasi (PHP CodeIgniter 4, Node.js, cURL).
> * 📖 **[MODUL_PEMBELAJARAN_ARSITEKTUR_BAILEYS.md](./MODUL_PEMBELAJARAN_ARSITEKTUR_BAILEYS.md)** — Modul edukasi mendalam mengenai protokol WhatsApp, Signal Protocol E2EE, arsitektur Baileys v7, LIDs, dan strategi anti-ban.

---

## 🌟 Fitur Utama

* 🚀 **Baileys v7 Modern:** Menggunakan arsitektur Pure ESM, dukungan penuh LIDs (*Linked Identity JIDs*), dan ACKs dinonaktifkan secara *default* (*Anti-Ban protection*).
* ⚡ **Optimasi Performa:** Caching Signal Key Store (`makeCacheableSignalKeyStore`) dan `msgRetryCounterCache` (NodeCache) untuk pengiriman cepat tanpa disk thrashing.
* 📱 **Dual Pairing Support (Headless):**
  * **QR Code JSON:** `GET /qr/raw` (Protected) mengembalikan `qr_data_url` siap render di panel admin Anda.
  * **8-Digit Pairing Code:** Menautkan nomor WhatsApp tanpa scan kamera via `POST /pair-code`.
* 📄 **Dukungan Media & Berkas:** Kirim dokumen PDF (Surat Undangan Rapat / SK) dan gambar secara *streaming*.
* 📢 **Broadcast Massal:** Endpoint `POST /send-bulk` dilengkapi *randomized jitter delay* (1.500ms – 2.300ms) untuk mencegah Meta anti-spam.
* 🛡️ **REST API Terproteksi:** Autentikasi API Key via header `x-api-key` atau `Authorization: Bearer <token>`.
* 🚦 **Rate Limiting Bawaan:** Cap per IP untuk endpoint kirim & pairing, plus dedup OTP per nomor (cooldown 60 detik, maks 5/jam) — respons 429 dengan header `Retry-After`.
* 📊 **Monitoring Realtime:** Endpoint `GET /health` menyertakan info *uptime* dan penggunaan memori RAM Heap Node.js.
* 🔄 **Auto-Reconnect Tangguh:** Penanganan status code `@hapi/boom` (`401` logout, `515` restart, `408/428/503` exponential backoff).

---

## 🛠️ Instalasi & Menjalankan

### 1. Prasyarat
* **Node.js:** Versi 20.0.0 atau lebih baru.

### 2. Konfigurasi Lingkungan (.env)
Salin `.env.example` ke `.env`:
```bash
cp .env.example .env
```

Isi variabel konfigurasi di `.env`:
```ini
PORT=3001
NODE_ENV=development
API_KEY=<buat-kunci-rahasia-anda-sendiri>
SESSION_DIR=./sessions/primary
LOG_LEVEL=silent

# Rate limiting (opsional, ada default)
RATE_LIMIT_SEND_PER_MINUTE=60
RATE_LIMIT_PAIR_PER_MINUTE=5
OTP_COOLDOWN_SECONDS=60
OTP_MAX_PER_PHONE_PER_HOUR=5
TRUST_PROXY=false
```

> ⚠️ **`API_KEY` wajib diisi.** Server menolak berjalan (fail-fast) tanpa kunci. Buat kunci kuat dengan:
> ```bash
> node -e "console.log('gw_' + require('crypto').randomBytes(32).toString('hex'))"
> ```

### 3. Menjalankan Server
```bash
# Mode Development (auto-reload saat kode diubah)
npm run dev

# Mode Production biasa
npm start

# Mode Production Background Daemon (PM2)
pm2 start ecosystem.config.cjs
```

---

## 📱 Cara Menghubungkan WhatsApp (Headless)

Gateway tidak memiliki antarmuka web — semua operasi pairing dilakukan lewat REST API, dipanggil dari panel admin Anda (via app backend) atau cURL langsung.

**Metode 1 — Kode Pairing 8 Digit (paling praktis):**
```bash
curl -X POST http://localhost:3001/pair-code \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY_ANDA" \
  -d '{"phone": "081234567890"}'
```
Masukkan kode 8 digit dari respons ke WhatsApp HP: **Perangkat Tertaut ➔ Tautkan dengan nomor telepon saja**.

**Metode 2 — QR Code (JSON):**
```bash
curl http://localhost:3001/qr/raw -H "x-api-key: $API_KEY_ANDA"
```
Render nilai `qr_data_url` sebagai gambar `<img>` di panel admin (polling ±4 detik — QR berotasi otomatis), lalu scan dari HP: **Perangkat Tertaut ➔ Tautkan Perangkat**.

Pantau `GET /status` hingga `connected: true`.

---

## 📡 Ringkasan Endpoint REST API

Semua endpoint kecuali `/` dan `/health` dilindungi oleh API Key via header `x-api-key` atau `Authorization: Bearer` (kunci diambil dari variabel `API_KEY` di file `.env` Anda).

| Method | Endpoint | Fungsi & Deskripsi |
|---|---|---|
| `GET` | `/` | Service Discovery & Metadata gateway |
| `GET` | `/health` | Health check, Uptime, & RAM Heap Memory metrics |
| `GET` | `/status` | Cek kondisi koneksi WhatsApp + `last_disconnect` (Protected) |
| `GET` | `/qr/raw` | QR pairing JSON `qr_data_url` untuk dirender panel admin (Protected) |
| `POST` | `/send-otp` | Kirim kode OTP format baku DPRD |
| `POST` | `/send-message` | Kirim pesan teks bebas / pengumuman markdown |
| `POST` | `/send-document` | Kirim dokumen PDF / Surat Undangan Rapat |
| `POST` | `/send-image` | Kirim foto dokumentasi kegiatan + caption |
| `POST` | `/send-bulk` | Kirim pesan massal dengan anti-spam jitter delay |
| `POST` | `/pair-code` | Request 8-digit Pairing Code tanpa kamera |
| `POST` | `/check-number` | Validasi apakah nomor HP terdaftar di WhatsApp |
| `POST` | `/logout` | Logout sesi & bersihkan storage disk |
| `POST` | `/restart` | Restart koneksi tanpa menghapus sesi (tanpa scan ulang) |

> 📖 Untuk contoh JSON request/response lengkap, silakan buka **[DOKUMENTASI_API.md](./DOKUMENTASI_API.md)**.

---

### Contoh Cepat Pengujian (cURL):

```bash
# 1. Kirim Pesan OTP
curl -X POST http://localhost:3001/send-otp \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY_ANDA" \
  -d '{"phone": "081234567890", "otp": "748192", "app_name": "DPRD Sulteng"}'

# 2. Cek Kesehatan Server
curl http://localhost:3001/health

# 3. Cek Apakah Nomor Terdaftar di WhatsApp
curl -X POST http://localhost:3001/check-number \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY_ANDA" \
  -d '{"phone": "081234567890"}'
```

---

## 🧪 Pengujian Otomatis (Automated Tests)

Jalankan seluruh test suite endpoint:
```bash
npm test
```
