# DPRD WhatsApp Gateway Microservice (Baileys v7)

Microservice pengirim pesan WhatsApp OTP dan notifikasi mandiri untuk ekosistem **DPRD Signage & Agenda**, dibangun di atas **Baileys v7 (`@whiskeysockets/baileys`)** dan **Express 5**.

---

## 🌟 Fitur Utama

* 🚀 **Baileys v7 Modern:** Menggunakan arsitektur Pure ESM, dukungan penuh LIDs (*Linked Identity JIDs*), dan ACKs dinonaktifkan secara *default* (*Anti-Ban protection*).
* ⚡ **Optimasi Performa:** Caching Signal Key Store (`makeCacheableSignalKeyStore`) dan `msgRetryCounterCache` (NodeCache).
* 📱 **Dual Pairing Support:**
  * **Visual QR Code:** Laman web otomatis memuat ulang di `GET /qr`.
  * **8-Digit Pairing Code:** Menautkan nomor WhatsApp tanpa scan kamera via `POST /pair-code`.
* 🛡️ **REST API Terproteksi:** Autentikasi API Key via header `x-api-key` atau `Authorization: Bearer <token>`.
* 📊 **Monitoring Realtime:** Endpoint `GET /health` menyertakan info *uptime* dan penggunaan memori RAM Heap Node.js.
* 🔄 **Auto-Reconnect Tangguh:** Menggunakan status code `@hapi/boom` (`401` logout, `515` restart, `408/428/503` exponential backoff).

---

## 🛠️ Instalasi & Menjalankan

### 1. Prasyarat
* **Node.js:** Versi 20.0.0 atau lebih baru.

### 2. Konfigurasi Lingkungan (.env)
Salin `.env.example` ke `.env`:
```bash
cp .env.example .env
```

Isi variabel `.env`:
```ini
PORT=3001
API_KEY=dprd_secret_wa_gateway_key_2026
SESSION_DIR=./sessions/primary
LOG_LEVEL=silent
```

### 3. Menjalankan Server
```bash
# Mode Development (auto-reload)
npm run dev

# Mode Production biasa
npm start

# Mode Production dengan PM2 (Background Daemon)
pm2 start ecosystem.config.cjs
```

---

## 📱 Cara Menghubungkan WhatsApp

1. Buka browser dan akses: `http://localhost:3001/qr`
2. Buka WhatsApp di smartphone ➔ **Perangkat Tertaut** ➔ **Tautkan Perangkat** ➔ Pindai QR Code.
3. Setelah terhubung, status akan berubah menjadi `connected` dan siap mengirim pesan.

---

## 📡 Dokumentasi Endpoint REST API

Semua endpoint pengiriman pesan dilindungi oleh `API_KEY` via header `x-api-key` atau `Authorization: Bearer <API_KEY>`.

### 1. Kirim Kode OTP (`POST /send-otp`)
* **Endpoint:** `http://localhost:3001/send-otp`
* **Header:** `x-api-key: dprd_secret_wa_gateway_key_2026`
* **Request Body (JSON):**
```json
{
  "phone": "081234567890",
  "otp": "748192",
  "app_name": "DPRD Provinsi Sulawesi Tengah"
}
```
* **Response (200 OK):**
```json
{
  "status": "success",
  "message": "Kode OTP berhasil dikirim via WhatsApp.",
  "data": {
    "messageId": "BAE5F618...",
    "phone": "6281234567890",
    "timestamp": 1756180000,
    "otp_length": 6
  }
}
```

### 2. Kirim Pesan Teks Bebas / Notifikasi (`POST /send-message`)
* **Endpoint:** `http://localhost:3001/send-message`
* **Header:** `x-api-key: dprd_secret_wa_gateway_key_2026`
* **Request Body (JSON):**
```json
{
  "phone": "081234567890",
  "message": "*PEMBERITAHUAN RAPAT*\n\nRapat Paripurna DPRD akan diselenggarakan besok pukul 09.00 WITA."
}
```

### 3. Request Pairing Code 8 Digit (`POST /pair-code`)
* **Endpoint:** `http://localhost:3001/pair-code`
* **Header:** `x-api-key: dprd_secret_wa_gateway_key_2026`
* **Request Body (JSON):**
```json
{
  "phone": "081234567890"
}
```

### 4. Kirim Dokumen / Surat Undangan PDF (`POST /send-document`)
* **Endpoint:** `http://localhost:3001/send-document`
* **Header:** `x-api-key: dprd_secret_wa_gateway_key_2026`
* **Request Body (JSON):**
```json
{
  "phone": "081234567890",
  "document_url": "https://example.com/uploads/Undangan_Rapat.pdf",
  "file_name": "Undangan_Rapat_Banmus.pdf",
  "caption": "Surat Undangan Rapat Badan Musyawarah"
}
```

### 5. Kirim Gambar / Dokumentasi Kegiatan (`POST /send-image`)
* **Endpoint:** `http://localhost:3001/send-image`
* **Header:** `x-api-key: dprd_secret_wa_gateway_key_2026`
* **Request Body (JSON):**
```json
{
  "phone": "081234567890",
  "image_url": "https://example.com/uploads/dokumentasi.jpg",
  "caption": "Dokumentasi Kunjungan Kerja Komisi"
}
```

### 6. Kirim Pesan Massal / Broadcast dengan Anti-Spam Jitter (`POST /send-bulk`)
* **Endpoint:** `http://localhost:3001/send-bulk`
* **Header:** `x-api-key: dprd_secret_wa_gateway_key_2026`
* **Request Body (JSON):**
```json
{
  "delay_ms": 1500,
  "recipients": [
    { "phone": "081234567891", "message": "Pemberitahuan Rapat Komisi I" },
    { "phone": "081234567892", "message": "Pemberitahuan Rapat Komisi I" }
  ]
}
```

### 7. Cek Nomor Terdaftar di WhatsApp (`POST /check-number`)
* **Endpoint:** `http://localhost:3001/check-number`
* **Header:** `x-api-key: dprd_secret_wa_gateway_key_2026`
* **Request Body (JSON):**
```json
{
  "phone": "081234567890"
}
```
* **Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "exists": true,
    "phone": "6281234567890",
    "jid": "6281234567890@s.whatsapp.net"
  }
}
```

### 8. Cek Status & Kesehatan Server (`GET /health`)
* **Endpoint:** `http://localhost:3001/health`
* **Response:**
```json
{
  "status": "ok",
  "uptime_seconds": 120,
  "memory": {
    "rss_mb": "48.5",
    "heap_used_mb": "26.3"
  },
  "whatsapp": {
    "status": "connected",
    "connected": true,
    "user": {
      "id": "6281234567890@s.whatsapp.net",
      "name": "Admin DPRD",
      "phone": "6281234567890"
    }
  }
}
```

---

## 🧪 Pengujian Otomatis (Automated Tests)

Jalankan test suite endpoint:
```bash
npm test
```

