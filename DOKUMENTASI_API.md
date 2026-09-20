# REST API Documentation: WhatsApp Outbound Gateway (Baileys v7)

> **Spesifikasi Teknis & Panduan Integrasi Mandiri**  
> Versi API: `1.1.0` (Send-Only OTP Scope)  
> Engine: `Baileys v7.0.0-rc14 (Pure ESM)`  
> Format Pertukaran Data: `JSON (application/json)`

---

## DAFTAR ISI

1. [Informasi Umum & Autentikasi](#1-informasi-umum--autentikasi)
2. [Standar Format Respons & Error Codes](#2-standar-format-respons--error-codes)
3. [Katalog Endpoint Lengkap](#3-katalog-endpoint-lengkap)
   * [A. Sistem & Monitoring](#a-sistem--monitoring)
     * `GET /` - Service Discovery
     * `GET /health` - Health Check & Metrik Memori
     * `GET /status` - Status Koneksi WhatsApp
     * `GET /qr/raw` - Raw QR Code Data URL
   * [B. Autentikasi & Penautan Perangkat](#b-autentikasi--penautan-perangkat)
     * `POST /pair-code` - Request 8-Digit Pairing Code
     * `POST /logout` - Putuskan Sesi & Bersihkan Auth
     * `POST /restart` - Restart Socket Tanpa Hapus Sesi
   * [C. Pengiriman Pesan](#c-pengiriman-pesan)
     * `POST /send-message` - Kirim Pesan Teks Personal
4. [Contoh Kode Integrasi](#4-contoh-kode-integrasi)

---

## 1. Informasi Umum & Autentikasi

### Base URL
```text
http://127.0.0.1:3001
```
Gateway hanya melayani konsumen di mesin yang sama (bind `127.0.0.1`). Endpoint pengiriman media, bulk, dan probing nomor telah dihapus karena gateway dikhususkan untuk pengiriman OTP/notifikasi teks outbound.

### Skema Keamanan API Key
Semua endpoint pengiriman pesan dan operasi perangkat dilindungi menggunakan **API Key** (dikonfigurasi pada file `.env` server gateway). Klien wajib menyertakan API Key melalui salah satu header berikut:

1. **Header `x-api-key` (Direkomendasikan):**
   ```http
   x-api-key: <API_KEY_ANDA>
   ```
2. **Header `Authorization: Bearer`:**
   ```http
   Authorization: Bearer <API_KEY_ANDA>
   ```

*Catatan Keamanan*: Query string parameter `?api_key=` tidak didukung untuk mencegah kunci bocor di access log proxy dan history browser.

### Pencegahan Kirim Ganda (Idempotency-Key)
Endpoint `POST /send-message` mendukung header opsional **`Idempotency-Key`**. Sertakan kunci unik untuk setiap upaya kirim (misal UUID dari sisi konsumen); bila permintaan di-retry karena timeout jaringan atau respons hilang, kirim kembali permintaan identik dengan **key yang sama** dan gateway akan membalas respons tersimpan tanpa mengirim ulang pesan.

* Masa berlaku respons tersimpan: 10 menit (dapat diatur via `IDEMPOTENCY_TTL_MS`).
* Respons yang di-replay ditandai header `Idempotent-Replay: true`.
* Permintaan berulang dengan key sama yang masih dalam proses dibalas `409 IDEMPOTENCY_IN_PROGRESS`.
* Gunakan key baru untuk upaya kirim baru; jangan pernah memakai ulang key dari percobaan berbeda. Respons error (misal `503`) juga tersimpan dan akan di-replay untuk key yang sama.

---

## 2. Standar Format Respons & Error Codes

### Format Respons Sukses (HTTP 200 OK)
```json
{
  "status": "success",
  "message": "Deskripsi tindakan berhasil",
  "data": { ... }
}
```

### Format Respons Gagal (HTTP 4xx / 5xx)
```json
{
  "status": "error",
  "code": "KODE_ERROR_STANDAR",
  "message": "Penyebab kegagalan yang dapat dipahami pemanggil"
}
```

### Daftar Error Code Baku:
| HTTP Status | Error Code | Keterangan |
|---|---|---|
| **401** | `UNAUTHORIZED` | Header API Key tidak valid atau belum disertakan. |
| **404** | `NOT_FOUND` | Endpoint tidak ditemukan. |
| **422** | `VALIDATION_ERROR` | Parameter wajib (`phone`/`to`, `message`, dll.) kosong atau tidak valid. |
| **422** | `WA_INVALID_TARGET` | Nomor tujuan tidak valid. Hanya nomor pribadi WhatsApp yang didukung. |
| **422** | `WA_NUMBER_NOT_REGISTERED` | Nomor tujuan tidak terdaftar di WhatsApp. Pengiriman dihentikan demi reputasi akun pengirim. |
| **429** | `RATE_LIMITED` | Batas request per menit terlampaui. Header `Retry-After` berisi detik tunggu. |
| **429** | `OTP_COOLDOWN` | Pesan ke nomor tujuan baru saja dikirim. Silakan tunggu jeda cooldown (default 60 detik). |
| **429** | `OTP_HOURLY_LIMIT` | Batas maksimum pengiriman OTP per nomor per jam telah tercapai (default 5). |
| **429** | `WA_CIRCUIT_BREAKER_OPEN` / `WA_SENDER_LIMIT` | Circuit breaker 463 aktif atau kuota pengirim harian/jam tercapai. Header `Retry-After` berisi detik tunggu. |
| **409** | `IDEMPOTENCY_IN_PROGRESS` | Permintaan dengan `Idempotency-Key` yang sama sedang diproses. |
| **502** | `WA_SERVER_REJECTED` | Server WhatsApp menolak pengiriman pesan (misal penolakan server 463/479). Respons menyertakan `message_id`. Pemicu fallback provider seketika. |
| **504** | `WA_SERVER_ACK_TIMEOUT` | Batas waktu menunggu konfirmasi penerimaan server WhatsApp (Server ACK / centang 1) terlampaui. Pesan kemungkinan sudah ditulis ke socket; status akhir tidak pasti. Respons menyertakan `message_id` untuk dedup. Konsumen disarankan menunggu atau retry dengan `Idempotency-Key` yang sama, bukan mengirim OTP baru. |
| **503** | `WA_GATEWAY_OFFLINE` | Socket WhatsApp belum terhubung / sesi logout. Respons menyertakan `message_id` bila pesan sempat masuk antrean ack sebelum socket putus. |
| **500** | `SEND_FAILED` | Kesalahan internal saat mengirimkan pesan ke jaringan WhatsApp. |

---

## 3. Katalog Endpoint Lengkap

### A. Sistem & Monitoring

#### 1. Service Discovery (`GET /`)
Mengembalikan nama gateway, versi engine, dan daftar endpoint.
* **Autentikasi:** Public
* **Contoh Respons (200 OK):**
```json
{
  "name": "WhatsApp Gateway",
  "version": "1.0.0",
  "engine": "Baileys v7",
  "status": "running",
  "endpoints": { "...": "..." }
}
```

#### 2. Cek Kesehatan & Memori RAM (`GET /health`)
Digunakan oleh container health check, uptime monitor, atau PM2 monitor.
* **Autentikasi:** Public
* **Contoh Respons (200 OK):**
```json
{
  "status": "ok",
  "uptime_seconds": 3600,
  "timestamp": "2026-09-01T00:00:00.000Z",
  "memory": {
    "rss_mb": "45.2",
    "heap_used_mb": "24.6"
  },
  "whatsapp": {
    "connected": true
  }
}
```

#### 3. Cek Status Koneksi WhatsApp (`GET /status`)
* **Autentikasi:** Protected (`x-api-key`)
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "data": {
    "status": "connected",
    "connected": true,
    "user": {
      "id": "628123456789@s.whatsapp.net",
      "name": "Official Sender",
      "phone": "628123456789"
    },
    "qr_available": false,
    "last_disconnect": null,
    "circuit_breaker": { "open": false },
    "sender_limit": { "used_hour": 3, "used_day": 12 }
  }
}
```

#### 4. Raw QR Code Data URL (`GET /qr/raw`)
Menyediakan string base64 Data URL QR Code untuk dirender pada dashboard admin aplikasi Anda.
* **Autentikasi:** Protected (`x-api-key`)
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "connected": false,
  "qr_available": true,
  "qr_raw": "2@qX7...",
  "qr_data_url": "data:image/png;base64,iVBORw0KGgo..."
}
```

---

### B. Autentikasi & Penautan Perangkat

#### 5. Request Kode Pairing 8 Digit (`POST /pair-code`)
Menghubungkan nomor pengirim tanpa scan kamera (menggunakan kode 8 digit WhatsApp).
* **Autentikasi:** Protected (`x-api-key`)
* **Request Body:**
```json
{
  "phone": "08123456789"
}
```
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Pairing Code berhasil dibuat.",
  "data": {
    "phone": "628123456789",
    "pairing_code": "ABCD-1234",
    "instruction": "Buka WhatsApp di HP > Perangkat Tertaut > Tautkan dengan nomor telepon saja > Masukkan kode 8 digit ini."
  }
}
```

#### 6. Putuskan Sesi & Logout (`POST /logout`)
Menghapus sesi kredensial di disk dan memulai socket baru untuk memicu QR code baru.
* **Autentikasi:** Protected (`x-api-key`)
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "WhatsApp berhasil logout. Sesi lama telah dibersihkan. Lakukan pairing ulang via POST /pair-code atau GET /qr/raw."
}
```

#### 7. Restart Koneksi Tanpa Hapus Sesi (`POST /restart`)
Menutup socket lama dan menyambungkan kembali tanpa menghapus sesi login di disk.
* **Autentikasi:** Protected (`x-api-key`)
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Koneksi WhatsApp dimulai ulang tanpa menghapus sesi. Pantau GET /status hingga connected.",
  "data": {
    "previous_status": "connected",
    "current_status": "connecting",
    "connected": false
  }
}
```

#### 8. Rekonsiliasi Status Pengiriman (`GET /audit/:messageId`)
Membaca catatan pengiriman dari audit log append-only (`logs/audit.jsonl`) untuk menentukan nasib sebuah pengiriman, khususnya saat respons awal berupa `504 WA_SERVER_ACK_TIMEOUT` yang ambigu. Nomor telepon tersimpan ter-mask dan konten pesan tidak pernah dicatat.
* **Autentikasi:** Protected (`x-api-key`)
* **Path Parameter:** `messageId` = nilai `messageId` atau `message_id` dari respons `/send-message`.
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "data": {
    "ts": "2026-09-20T07:12:34.000Z",
    "message_id": "BAE5F61829...",
    "phone": "6281xxxxxx90",
    "endpoint": "send-message",
    "result": "success",
    "http_status": 200,
    "code": null,
    "latency_ms": 812
  }
}
```
* **Error 404:** `AUDIT_NOT_FOUND` bila `message_id` tidak ditemukan (index memori kosong setelah restart dan entry tidak ada di file audit).

---

### C. Pengiriman Pesan

#### 9. Kirim Pesan Teks (`POST /send-message`)
Hanya mendukung nomor personal (`08xxx` / `628xxx`). Nomor grup atau format lain ditolak dengan `WA_INVALID_TARGET`. **Isi pesan dirakit sepenuhnya oleh konsumen** — termasuk template OTP, teks notifikasi, dan kode referensi unik bila diperlukan. Gateway tidak lagi menyediakan template bawaan; gunakan jeda cooldown per nomor (60 detik, maks 5 pesan/jam per nomor) sebagai acuan perilaku pengiriman.
* **Autentikasi:** Protected (`x-api-key`)
* **Request Body:**
```json
{
  "to": "08123456789",
  "message": "Halo, ini adalah pesan notifikasi otomatis dari sistem.",
  "wait_for_ack": true,
  "ack_timeout_ms": 3000
}
```
*Catatan:* Field target dapat menggunakan `phone`, `to`, `jid`, atau `recipient`. Field pesan dapat menggunakan `message` atau `text`. Parameter `wait_for_ack` (boolean) dan `ack_timeout_ms` (number) bersifat opsional.
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Pesan berhasil dikirim via WhatsApp.",
  "data": {
    "messageId": "BAE5F61...",
    "phone": "628123456789",
    "timestamp": 1788190000,
    "server_ack": true,
    "ack_elapsed_ms": 198
  }
}
```

---

### 1. Integrasi PHP (cURL)
```php
<?php
function sendWhatsAppMessage($to, $message) {
    $url = 'http://127.0.0.1:3001/send-message';
    $apiKey = 'gw_rahasia_anda';

    $payload = json_encode([
        'to' => $to,
        'message' => $message
    ]);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'x-api-key: ' . $apiKey
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return [
        'code' => $httpCode,
        'body' => json_decode($response, true)
    ];
}
```

### 2. Integrasi JavaScript / Node.js
```javascript
async function sendOtp(phone, otpCode) {
  // Template OTP dirakit di sisi client; gateway hanya meneruskan teks.
  const message = `*KODE VERIFIKASI*\n\nKode OTP Anda: *${otpCode}*\n\nBerlaku 5 menit. Jangan berikan kode ini kepada siapapun.`;

  const response = await fetch('http://127.0.0.1:3001/send-message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.WA_GATEWAY_KEY,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ phone, message }),
  });

  const data = await response.json();
  return { status: response.status, data };
}
```

### 3. Integrasi Python
```python
import requests
import uuid

def send_otp(phone, otp_code):
    # Template OTP dirakit di sisi client; gateway hanya meneruskan teks.
    message = (
        "*KODE VERIFIKASI*\n\n"
        f"Kode OTP Anda: *{otp_code}*\n\n"
        "Berlaku 5 menit. Jangan berikan kode ini kepada siapapun."
    )
    url = "http://127.0.0.1:3001/send-message"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": "gw_rahasia_anda",
        "Idempotency-Key": str(uuid.uuid4()),
    }
    payload = {"phone": phone, "message": message}

    response = requests.post(url, json=payload, headers=headers)
    return response.json()
```

### 4. Integrasi cURL Terminal
```bash
curl -X POST http://localhost:3001/send-message \
  -H "Content-Type: application/json" \
  -H "x-api-key: <API_KEY_ANDA>" \
  -d '{"phone": "08123456789", "message": "*KODE VERIFIKASI*\n\nKode OTP Anda: *748192*\n\nBerlaku 5 menit."}'
```
