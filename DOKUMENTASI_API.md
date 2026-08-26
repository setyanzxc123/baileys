# 📡 DOKUMENTASI REST API: DPRD WhatsApp Gateway (Baileys v7)

> **Spesifikasi Teknis & Panduan Integrasi Lengkap**  
> Versi API: `1.0.0`  
> Engine: `Baileys v7.0.0-rc14 (Pure ESM)`  
> Port Default: `3001`  
> Format Pertukaran Data: `JSON (application/json)`  

---

## 📑 DAFTAR ISI

1. [Informasi Umum & Autentikasi](#1-informasi-umum--autentikasi)
2. [Standar Format Respons & Error Codes](#2-standar-format-respons--error-codes)
3. [Katalog Endpoint Lengkap](#3-katalog-endpoint-lengkap)
   * [A. Sistem & Monitoring](#a-sistem--monitoring)
     * [`GET /`](#1-service-discovery-get-)
     * [`GET /health`](#2-cek-kesehatan--memori-ram-get-health)
     * [`GET /status`](#3-cek-status-koneksi-whatsapp-get-status)
     * [`GET /qr`](#4-laman-visual-scan-qr--pairing-code-get-qr)
     * [`GET /qr/raw`](#5-raw-qr-code-json-get-qrraw)
   * [B. Autentikasi & Penautan Perangkat](#b-autentikasi--penautan-perangkat)
     * [`POST /pair-code`](#6-request-kode-pairing-8-digit-post-pair-code)
     * [`POST /logout`](#7-putuskan-sesi--logout-post-logout)
   * [C. Pengiriman Pesan & Dokumen](#c-pengiriman-pesan--dokumen)
     * [`POST /send-otp`](#8-kirim-kode-otp-post-send-otp)
     * [`POST /send-message`](#9-kirim-pesan-teks-bebas-post-send-message)
     * [`POST /send-document`](#10-kirim-dokumen-pdf--undangan-rapat-post-send-document)
     * [`POST /send-image`](#11-kirim-gambar--dokumentasi-post-send-image)
     * [`POST /send-bulk`](#12-kirim-pesan-massal--broadcast-post-send-bulk)
   * [D. Utilitas & Validasi](#d-utilitas--validasi)
     * [`POST /check-number`](#13-cek-nomor-terdaftar-di-whatsapp-post-check-number)
4. [Contoh Kode Integrasi](#4-contoh-kode-integrasi)
   * [PHP (cURL Native & CodeIgniter 4)](#1-integrasi-php--codeigniter-4)
   * [JavaScript / Node.js (Fetch)](#2-integrasi-javascript--nodejs-fetch)
   * [cURL (Command Line)](#3-integrasi-curl-terminal)

---

## 1. Informasi Umum & Autentikasi

### Base URL
```text
http://127.0.0.1:3001
# atau alamat server/domain gateway:
http://localhost:3001
```

### Skema Keamanan API Key
Semua endpoint pengiriman pesan dan operasi sensitif dilindungi menggunakan **API Key** (diambil dari variabel `API_KEY` di file `.env` server). Klien wajib menyertakan API Key melalui salah satu metode berikut:

1. **Header `x-api-key` (Sangat Disarankan):**
   ```http
   x-api-key: <API_KEY_ANDA>
   ```
2. **Header `Authorization: Bearer`:**
   ```http
   Authorization: Bearer <API_KEY_ANDA>
   ```

> ⚠️ **Query parameter `?api_key=` TIDAK lagi didukung** — kunci di URL mengendap di access log proxy dan riwayat browser. Gunakan selalu header. Server juga menolak berjalan (fail-fast) bila `API_KEY` tidak diatur di `.env`.

---

## 2. Standar Format Respons & Error Codes

### 🟢 Format Respons Sukses (HTTP 200 OK)
```json
{
  "status": "success",
  "message": "Deskripsi tindakan berhasil",
  "data": { ... }
}
```

### 🔴 Format Respons Gagal (HTTP 4xx / 5xx)
```json
{
  "status": "error",
  "message": "Penyebab kegagalan",
  "code": "KODE_ERROR_STANDAR"
}
```

### Daftar Error Code Baku:
| HTTP Status | Error Code | Keterangan |
|---|---|---|
| **401** | `UNAUTHORIZED` | Header API Key tidak ada atau salah. |
| **422** | `VALIDATION_ERROR` | Parameter wajib (`phone`, `otp`, `message`, dll.) kosong atau tidak valid. |
| **429** | `RATE_LIMITED` | Batas permintaan per menite per IP terlampaui (endpoint kirim / pairing). Header `Retry-After` berisi detik tunggu. |
| **429** | `OTP_COOLDOWN` | OTP ke nomor yang sama baru saja dikirim — tunggu `OTP_COOLDOWN_SECONDS` (default 60 detik). |
| **429** | `OTP_HOURLY_LIMIT` | Nomor tersebut telah menerima maksimum OTP dalam satu jam (default 5). |
| **503** | `WA_GATEWAY_OFFLINE` | Server WhatsApp belum di-scan QR / sedang terputus koneksinya. |
| **500** | `SEND_FAILED` | Terjadi kesalahan internal saat mengirimkan pesan ke server Meta. |

### ⏱️ Rate Limiting Bawaan Gateway
Gateway memasang jaring pengaman tingkat kedua (kebijakan bisnis yang detail tetap sebaiknya berada di aplikasi konsumen):

| Lingkup | Default | Variabel Env |
|---|---|---|
| Semua endpoint kirim + `check-number` (per IP) | 60 permintaan/menit | `RATE_LIMIT_SEND_PER_MINUTE` |
| `POST /pair-code` (per IP) | 5 permintaan/menit | `RATE_LIMIT_PAIR_PER_MINUTE` |
| OTP ke nomor yang sama | 1 per 60 detik | `OTP_COOLDOWN_SECONDS` |
| OTP ke nomor yang sama (per jam) | 5 per jam | `OTP_MAX_PER_PHONE_PER_HOUR` |

> Respons 429 menyertakan header `Retry-After` (detik) dan field `retry_after_seconds`. Jika gateway berjalan di belakang nginx/reverse proxy, set `TRUST_PROXY=true` agar limit per-IP menghitung IP klien asli.

---

## 3. Katalog Endpoint Lengkap

### A. Sistem & Monitoring

---

#### 1. Service Discovery (`GET /`)
Menampilkan metadata informasi service, versi Baileys, status WhatsApp, dan daftar endpoint yang tersedia.
* **Autentikasi:** Publik (Tanpa API Key)
* **Contoh Respons (200 OK):**
```json
{
  "name": "DPRD WhatsApp Gateway Service",
  "version": "1.0.0",
  "engine": "Baileys v7",
  "status": "running",
  "whatsapp": {
    "status": "connected",
    "connected": true,
    "user": {
      "id": "6281234567890@s.whatsapp.net",
      "name": "Humas DPRD Sulteng",
      "phone": "6281234567890"
    },
    "qr_available": false
  },
  "endpoints": { ... }
}
```

---

#### 2. Cek Kesehatan & Memori RAM (`GET /health`)
Monitoring *real-time* penggunaan memori RAM Heap Node.js, RSS, dan *uptime* gateway.
* **Autentikasi:** Publik
* **Contoh Respons (200 OK):**
```json
{
  "status": "ok",
  "uptime_seconds": 3600,
  "timestamp": "2026-08-26T12:00:00.000Z",
  "memory": {
    "rss_mb": "48.2",
    "heap_used_mb": "26.1"
  },
  "whatsapp": {
    "status": "connected",
    "connected": true,
    "user": {
      "id": "6281234567890@s.whatsapp.net",
      "name": "Humas DPRD",
      "phone": "6281234567890"
    }
  }
}
```

---

#### 3. Cek Status Koneksi WhatsApp (`GET /status`)
Mengembalikan kondisi keterhubungan socket WhatsApp secara ringkas.
* **Autentikasi:** Publik
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "data": {
    "status": "connected",
    "connected": true,
    "user": {
      "id": "6281234567890@s.whatsapp.net",
      "phone": "6281234567890"
    },
    "qr_available": false
  }
}
```

---

#### 4. Laman Visual Scan QR & Pairing Code (`GET /qr`)
Antarmuka web interaktif siap pakai untuk scan QR Code atau request 8-digit Pairing Code langsung di browser.
* **Autentikasi:** Publik
* **Format Output:** HTML interaktif (`text/html`)

---

#### 5. Raw QR Code JSON (`GET /qr/raw`)
Menyediakan string QR mentah dan Data URL PNG jika ingin disematkan pada dashboard eksternal.
* **Autentikasi:** Publik
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "connected": false,
  "qr_available": true,
  "qr_raw": "2@4fT6j...",
  "qr_data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."
}
```

---

### B. Autentikasi & Penautan Perangkat

---

#### 6. Request Kode Pairing 8 Digit (`POST /pair-code`)
Menghasilkan 8 digit kode alfanumerik untuk menghubungkan nomor WhatsApp tanpa perlu kamera/scan QR.
* **Autentikasi:** Wajib API Key
* **Request Body:**
```json
{
  "phone": "081234567890"
}
```
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Pairing Code berhasil dibuat.",
  "data": {
    "success": true,
    "phone": "6281234567890",
    "pairing_code": "ABCD-1234",
    "instruction": "Buka WhatsApp di HP ➔ Perangkat Tertaut ➔ Tautkan dengan nomor telepon saja ➔ Masukkan kode 8 digit ini."
  }
}
```

---

#### 7. Putuskan Sesi & Logout (`POST /logout`)
Memutuskan sesi WhatsApp dari server dan membersihkan file kredensial di disk `sessions/`.
* **Autentikasi:** Wajib API Key
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "WhatsApp berhasil logout. Sesi lama telah dibersihkan. Silakan scan QR baru di /qr."
}
```

---

### C. Pengiriman Pesan & Dokumen

---

#### 8. Kirim Kode OTP (`POST /send-otp`)
Mengirim pesan OTP resmi dengan format teks terstandarisasi DPRD.
* **Autentikasi:** Wajib API Key
* **Request Body:**
| Parameter | Tipe | Wajib? | Keterangan |
|---|---|---|---|
| `phone` | `string` | **Ya** | Nomor WhatsApp tujuan (`08...` atau `628...`) |
| `otp` | `string` / `number` | **Ya** | Kode angka OTP (contoh: `"748192"`) |
| `app_name` | `string` | *Opsional* | Nama aplikasi pengirim (Default: `"DPRD Provinsi Sulawesi Tengah"`) |

* **Contoh Request:**
```json
{
  "phone": "081234567890",
  "otp": "748192",
  "app_name": "Aplikasi Mobile DPRD Sulteng"
}
```

* **Format Pesan yang Diterima Pengguna:**
```text
*KODE VERIFIKASI LOGIN*

Kode OTP Anda untuk portal *Aplikasi Mobile DPRD Sulteng* adalah:

👉 *748192*

_Kode ini berlaku selama 5 menit. Jangan berikan kode ini kepada siapapun termasuk petugas._
```

* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Kode OTP berhasil dikirim via WhatsApp.",
  "data": {
    "success": true,
    "messageId": "BAE5F618A192B001",
    "phone": "6281234567890",
    "timestamp": 1756180000,
    "otp_length": 6
  }
}
```

---

#### 9. Kirim Pesan Teks Bebas (`POST /send-message`)
Mengirimkan pesan teks biasa atau pengumuman berformat WhatsApp Markdown (`*tebal*`, `_miring_`, `~coret~`).
* **Autentikasi:** Wajib API Key
* **Request Body:**
```json
{
  "phone": "081234567890",
  "message": "*PEMBERITAHUAN RAPAT KOMISI I*\n\nYth. Anggota Dewan,\nRapat kerja akan diselenggarakan pada:\n📅 Hari: Kamis, 27 Agustus 2026\n⏰ Pukul: 10.00 WITA\n📍 Ruang Sidang Utama DPRD."
}
```
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Pesan berhasil dikirim via WhatsApp.",
  "data": {
    "success": true,
    "messageId": "BAE5F618A192B002",
    "phone": "6281234567890",
    "timestamp": 1756180050
  }
}
```

---

#### 10. Kirim Dokumen PDF / Undangan Rapat (`POST /send-document`)
Mengirim berkas dokumen PDF (Surat Undangan Rapat Banmus, SK DPRD, Notulensi) dengan nama berkas dan teks pengantar.
* **Autentikasi:** Wajib API Key
* **Request Body:**
| Parameter | Tipe | Wajib? | Keterangan |
|---|---|---|---|
| `phone` | `string` | **Ya** | Nomor WhatsApp penerima |
| `document_url` | `string` | **Ya** | URL publik berkas PDF atau path lokal di server |
| `file_name` | `string` | *Opsional* | Nama berkas saat didownload (Default: `Undangan_DPRD.pdf`) |
| `caption` | `string` | *Opsional* | Teks keterangan pengantar di bawah dokumen |

* **Contoh Request:**
```json
{
  "phone": "081234567890",
  "document_url": "https://dprd.sultengprov.go.id/uploads/surat_undangan_001.pdf",
  "file_name": "Undangan_Rapat_Paripurna.pdf",
  "caption": "Terlampir Surat Undangan Resmi Rapat Paripurna DPRD."
}
```
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Dokumen berhasil dikirim via WhatsApp.",
  "data": {
    "success": true,
    "messageId": "BAE5F618A192B003",
    "phone": "6281234567890",
    "fileName": "Undangan_Rapat_Paripurna.pdf",
    "timestamp": 1756180100
  }
}
```

---

#### 11. Kirim Gambar / Dokumentasi (`POST /send-image`)
Mengirimkan gambar/foto dokumentasi kegiatan DPRD beserta *caption*.
* **Autentikasi:** Wajib API Key
* **Request Body:**
```json
{
  "phone": "081234567890",
  "image_url": "https://dprd.sultengprov.go.id/uploads/foto_kunker.jpg",
  "caption": "Dokumentasi Kunjungan Kerja Komisi IV di Kabupaten Tolitoli."
}
```
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Gambar berhasil dikirim via WhatsApp.",
  "data": {
    "success": true,
    "messageId": "BAE5F618A192B004",
    "phone": "6281234567890",
    "timestamp": 1756180150
  }
}
```

---

#### 12. Kirim Pesan Massal / Broadcast (`POST /send-bulk`)
Mengirim pesan secara berurutan ke daftar penerima dengan proteksi **Randomized Jitter Delay (1.500ms – 2.300ms)** antar pesan untuk mencegah pemblokiran oleh Meta Anti-Spam.
* **Autentikasi:** Wajib API Key
* **Request Body:**
```json
{
  "delay_ms": 1500,
  "recipients": [
    { "phone": "081234567891", "message": "Pemberitahuan Rapat Fraksi pukul 09.00 WITA" },
    { "phone": "081234567892", "message": "Pemberitahuan Rapat Fraksi pukul 09.00 WITA" },
    { "phone": "081234567893", "message": "Pemberitahuan Rapat Fraksi pukul 09.00 WITA" }
  ]
}
```
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Proses pengiriman bulk selesai. Berhasil: 3, Gagal: 0",
  "data": {
    "total": 3,
    "success_count": 3,
    "failed_count": 0,
    "results": [
      { "phone": "6281234567891", "success": true, "messageId": "BAE5_01" },
      { "phone": "6281234567892", "success": true, "messageId": "BAE5_02" },
      { "phone": "6281234567893", "success": true, "messageId": "BAE5_03" }
    ]
  }
}
```

---

### D. Utilitas & Validasi

---

#### 13. Cek Nomor Terdaftar di WhatsApp (`POST /check-number`)
Memeriksa apakah nomor telepon tertentu aktif dan terdaftar di WhatsApp Meta sebelum pesan dikirim.
* **Autentikasi:** Wajib API Key
* **Request Body:**
```json
{
  "phone": "081234567890"
}
```
* **Contoh Respons (200 OK):**
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

---

## 4. Contoh Kode Integrasi

### 1. Integrasi PHP / CodeIgniter 4
```php
<?php

namespace App\Libraries;

class BaileysClient
{
    private string $baseUrl = 'http://127.0.0.1:3001';
    private string $apiKey  = getenv('WA_GATEWAY_API_KEY'); // simpan di environment, jangan hardcode

    public function sendOtp(string $phone, string $otp): array
    {
        $payload = json_encode([
            'phone'    => $phone,
            'otp'      => $otp,
            'app_name' => 'DPRD Provinsi Sulawesi Tengah',
        ]);

        $ch = curl_init("{$this->baseUrl}/send-otp");
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 5, // Fast-fail timeout 5 detik
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                "x-api-key: {$this->apiKey}",
            ],
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode === 200) {
            return ['success' => true, 'data' => json_decode($response, true)];
        }

        return ['success' => false, 'http_code' => $httpCode, 'response' => $response];
    }
}
```

---

### 2. Integrasi JavaScript / Node.js (Fetch)
```javascript
const BASE_URL = 'http://127.0.0.1:3001';
const API_KEY = process.env.WA_GATEWAY_API_KEY; // simpan di environment, jangan hardcode

async function sendWhatsAppOtp(phone, otp) {
  try {
    const res = await fetch(`${BASE_URL}/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify({
        phone: phone,
        otp: otp,
        app_name: 'DPRD Signage & Agenda',
      }),
    });

    const data = await res.json();
    if (res.ok) {
      console.log('✅ OTP Berhasil terkirim:', data.data.messageId);
    } else {
      console.error('❌ Gagal kirim OTP:', data.message);
    }
  } catch (err) {
    console.error('⚠️ Gateway offline:', err.message);
  }
}
```

---

### 3. Integrasi cURL (Terminal)
```bash
# Kirim OTP
curl -X POST http://127.0.0.1:3001/send-otp \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY_ANDA" \
  -d '{"phone": "081234567890", "otp": "992145"}'

# Cek Status Kesehatan
curl http://127.0.0.1:3001/health

# Cek Nomor Terdaftar
curl -X POST http://127.0.0.1:3001/check-number \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY_ANDA" \
  -d '{"phone": "081234567890"}'
```
