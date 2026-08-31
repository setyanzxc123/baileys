# REST API Documentation: WhatsApp Outbound Gateway (Baileys v7)

> **Spesifikasi Teknis & Panduan Integrasi Mandiri**  
> Versi API: `1.0.0`  
> Engine: `Baileys v7.0.0-rc14 (Pure ESM)`  
> Format Pertukaran Data: `JSON (application/json)` dan `Multipart (multipart/form-data)`  

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
   * [C. Pengiriman Pesan & Media](#c-pengiriman-pesan--media)
     * `POST /send-otp` - Kirim Pesan OTP (Format Standar / Custom Template)
     * `POST /send-message` - Kirim Pesan Teks (Personal & Grup)
     * `POST /send-document` - Kirim Berkas Dokumen (URL atau Direct Upload)
     * `POST /send-image` - Kirim Berkas Gambar (URL atau Direct Upload)
     * `POST /send-bulk` - Pengiriman Massal Asynchronous (Background Job)
     * `GET /jobs/:job_id` - Cek Progres & Hasil Pengiriman Bulk Job
   * [D. Validasi & Utilitas](#d-validasi--utilitas)
     * `POST /check-number` - Cek Registrasi Nomor di WhatsApp
4. [Contoh Kode Integrasi](#4-contoh-kode-integrasi)
   * [PHP (cURL & Laravel / Guzzle)](#1-integrasi-php)
   * [JavaScript / Node.js (Fetch)](#2-integrasi-javascript--nodejs)
   * [Python (Requests)](#3-integrasi-python)
   * [cURL (Terminal CLI)](#4-integrasi-curl-terminal)

---

## 1. Informasi Umum & Autentikasi

### Base URL
```text
http://127.0.0.1:3001
# atau URL reverse proxy / domain:
https://wa-gateway.domainanda.com
```

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

### Format Respons Diterima ke Antrean (HTTP 202 Accepted)
```json
{
  "status": "queued",
  "message": "Permintaan pengiriman massal diterima dan sedang diproses di antrean.",
  "job_id": "job_1788191325138_59775b4e",
  "total": 50,
  "check_status_url": "/jobs/job_1788191325138_59775b4e"
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
| **404** | `JOB_NOT_FOUND` | Job ID pada antrean bulk tidak ditemukan. |
| **422** | `VALIDATION_ERROR` | Parameter wajib (`phone`/`to`, `message`, `otp`, dll.) kosong atau tidak valid. |
| **422** | `OTP_INVALID_FORMAT` | Parameter `otp` harus berupa 4-8 digit angka. |
| **422** | `FILE_TOO_LARGE` | Berkas direct upload melebihi batas (25MB dokumen, 10MB gambar). |
| **422** | `BULK_TOO_MANY_RECIPIENTS` | Jumlah penerima melebihi batas `BULK_MAX_RECIPIENTS` (default 100). |
| **422** | `BULK_DELAY_TOO_SHORT` | Jeda `delay_ms` di bawah batas keamanan anti-spam (min. 1000 ms). |
| **429** | `RATE_LIMITED` | Batas request per menit terlampaui. Header `Retry-After` berisi detik tunggu. |
| **429** | `OTP_COOLDOWN` | OTP ke nomor tujuan baru saja dikirim. Silakan tunggu jeda cooldown (default 60 detik). |
| **429** | `OTP_HOURLY_LIMIT` | Batas maksimum pengiriman OTP per nomor per jam telah tercapai (default 5). |
| **503** | `WA_GATEWAY_OFFLINE` | Socket WhatsApp belum terhubung / sesi logout. |
| **500** | `SEND_FAILED` | Kesalahan internal saat mengirimkan pesan ke jaringan WhatsApp. |

---

## 3. Katalog Endpoint Lengkap

### A. Sistem & Monitoring

#### 1. Service Discovery (`GET /`)
Mengembalikan katalog informasi gateway, versi engine, status socket, dan daftar endpoint.
* **Autentikasi:** Public
* **Contoh Respons (200 OK):**
```json
{
  "name": "WhatsApp Gateway",
  "version": "1.0.0",
  "engine": "Baileys v7",
  "status": "running",
  "whatsapp": {
    "status": "connected",
    "connected": true,
    "user": {
      "id": "628123456789@s.whatsapp.net",
      "name": "Sender Name",
      "phone": "628123456789"
    },
    "qr_available": false,
    "last_disconnect": null
  },
  "endpoints": { ... }
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
    "status": "connected",
    "connected": true,
    "user": { "phone": "628123456789" },
    "qr_available": false
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
    "last_disconnect": null
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

---

### C. Pengiriman Pesan & Media

#### 8. Kirim Pesan OTP (`POST /send-otp`)
* **Autentikasi:** Protected (`x-api-key`)
* **Request Body:**
```json
{
  "phone": "08123456789",
  "otp": "748192",
  "app_name": "Portal Pelayanan",
  "template": "Kode verifikasi Anda untuk {{app_name}} adalah *{{otp}}*. Berlaku 5 menit."
}
```
*Catatan:* Parameter `app_name` dan `template` bersifat opsional. Jika `template` tidak diisi, gateway menggunakan format baku instansi.
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Kode OTP berhasil dikirim via WhatsApp.",
  "data": {
    "messageId": "BAE5F61829...",
    "phone": "628123456789",
    "timestamp": 1788190000,
    "otp_length": 6
  }
}
```

#### 9. Kirim Pesan Teks (`POST /send-message`)
Mendukung pengiriman ke nomor personal (`08xxx` / `628xxx`) maupun Grup WhatsApp (`xxx@g.us`).
* **Autentikasi:** Protected (`x-api-key`)
* **Request Body:**
```json
{
  "to": "08123456789",
  "message": "Halo, ini adalah pesan notifikasi otomatis dari sistem."
}
```
*Catatan:* Field target dapat menggunakan `phone`, `to`, `jid`, atau `recipient`. Field pesan dapat menggunakan `message` atau `text`.
* **Contoh Target Grup WhatsApp:**
```json
{
  "to": "120363023456789012@g.us",
  "message": "Pemberitahuan: Rapat koordinasi dimulai pukul 10.00 WITA."
}
```
* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Pesan berhasil dikirim via WhatsApp.",
  "data": {
    "messageId": "BAE5F61...",
    "phone": "628123456789",
    "timestamp": 1788190000
  }
}
```

#### 10. Kirim Dokumen PDF / Berkas (`POST /send-document`)
Mendukung 2 metode pengiriman:
1. **Via URL Publik (JSON Payload)**: `document_url` atau `url`
2. **Via Upload Berkas Langsung (Multipart/Form-Data)**: field `file` (maksimal 25MB)

* **Opsi A: Request Body JSON (URL Publik):**
```json
{
  "to": "08123456789",
  "document_url": "https://domainanda.com/files/undangan.pdf",
  "file_name": "Undangan_Rapat.pdf",
  "caption": "Lampiran surat undangan resmi.",
  "mimetype": "application/pdf"
}
```

* **Opsi B: Request Multipart/Form-Data (Direct File):**
```http
POST /send-document HTTP/1.1
x-api-key: <API_KEY>
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="to"

08123456789
------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="Undangan.pdf"
Content-Type: application/pdf

<binary data buffer>
------WebKitFormBoundary
Content-Disposition: form-data; name="caption"

Lampiran berkas resmi
------WebKitFormBoundary--
```

* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Dokumen berhasil dikirim via WhatsApp.",
  "data": {
    "messageId": "BAE5F...",
    "phone": "628123456789",
    "fileName": "Undangan.pdf",
    "timestamp": 1788190000
  }
}
```

#### 11. Kirim Gambar / Foto (`POST /send-image`)
Mendukung 2 metode pengiriman:
1. **Via URL Publik (JSON Payload)**: `image_url` atau `url`
2. **Via Upload Berkas Langsung (Multipart/Form-Data)**: field `file` (maksimal 10MB)

* **Request Body JSON (URL Publik):**
```json
{
  "to": "08123456789",
  "image_url": "https://domainanda.com/images/banner.jpg",
  "caption": "Foto dokumentasi kegiatan."
}
```

* **Contoh Respons (200 OK):**
```json
{
  "status": "success",
  "message": "Gambar berhasil dikirim via WhatsApp.",
  "data": {
    "messageId": "BAE5F...",
    "phone": "628123456789",
    "timestamp": 1788190000
  }
}
```

#### 12. Kirim Pesan Massal Asynchronous (`POST /send-bulk`)
Memasukkan daftar pesan ke antrean background queue secara non-blocking untuk mencegah HTTP 504 Timeout.
* **Autentikasi:** Protected (`x-api-key`)
* **Request Body:**
```json
{
  "delay_ms": 1500,
  "recipients": [
    { "phone": "081234567890", "message": "Pesan personal untuk peserta A" },
    { "phone": "081298765432", "message": "Pesan personal untuk peserta B" },
    { "to": "120363023456789012@g.us", "message": "Broadcast ke grup koordinasi" }
  ]
}
```
* **Contoh Respons (202 Accepted):**
```json
{
  "status": "queued",
  "message": "Permintaan pengiriman massal diterima dan sedang diproses di antrean.",
  "job_id": "job_1788191325138_59775b4e",
  "total": 3,
  "check_status_url": "/jobs/job_1788191325138_59775b4e"
}
```

#### 13. Cek Status Background Job (`GET /jobs/:job_id`)
Melacak progres pengiriman massal dari background queue worker.
* **Autentikasi:** Protected (`x-api-key`)
* **Contoh Respons (200 OK - Selesai):**
```json
{
  "status": "success",
  "data": {
    "id": "job_1788191325138_59775b4e",
    "type": "bulk_send",
    "status": "completed",
    "total": 3,
    "processed": 3,
    "success_count": 3,
    "failed_count": 0,
    "delay_ms": 1500,
    "results": [
      { "phone": "6281234567890", "success": true, "messageId": "BAE5F1..." },
      { "phone": "6281298765432", "success": true, "messageId": "BAE5F2..." },
      { "phone": "120363023456789012@g.us", "success": true, "messageId": "BAE5F3..." }
    ],
    "error": null,
    "created_at": "2026-09-01T00:10:00.000Z",
    "updated_at": "2026-09-01T00:10:06.000Z",
    "completed_at": "2026-09-01T00:10:06.000Z"
  }
}
```

---

### D. Validasi & Utilitas

#### 14. Cek Registrasi Nomor di WhatsApp (`POST /check-number`)
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
  "data": {
    "exists": true,
    "phone": "628123456789",
    "jid": "628123456789@s.whatsapp.net"
  }
}
```

---

## 4. Contoh Kode Integrasi

### 1. Integrasi PHP

#### A. Menggunakan cURL Native
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

#### B. Menggunakan Laravel / Guzzle (Upload File Direct)
```php
use Illuminate\Support\Facades\Http;

$response = Http::withHeaders([
    'x-api-key' => config('services.whatsapp.api_key')
])->attach(
    'file', file_get_contents(storage_path('app/undangan.pdf')), 'Undangan.pdf'
)->post('http://127.0.0.1:3001/send-document', [
    'to' => '08123456789',
    'caption' => 'Berikut surat undangan resmi.'
]);

if ($response->successful()) {
    $result = $response->json();
}
```

---

### 2. Integrasi JavaScript / Node.js

```javascript
import fetch from 'node-fetch';

async function sendOtp(phone, otp) {
  const response = await fetch('http://127.0.0.1:3001/send-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.WA_GATEWAY_KEY,
    },
    body: JSON.stringify({
      phone,
      otp,
      app_name: 'Portal Layanan',
    }),
  });

  const data = await response.json();
  return { status: response.status, data };
}
```

---

### 3. Integrasi Python

```python
import requests

def send_bulk_notifications(recipients):
    url = "http://127.0.0.1:3001/send-bulk"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": "gw_rahasia_anda"
    }
    payload = {
        "delay_ms": 1500,
        "recipients": recipients
    }
    
    response = requests.post(url, json=payload, headers=headers)
    return response.json()
```

---

### 4. Integrasi cURL Terminal

#### Kirim Pesan Teks:
```bash
curl -X POST http://localhost:3001/send-message \
  -H "Content-Type: application/json" \
  -H "x-api-key: gw_e73130f4cf925f837db258b868e3bff5688c810c3b79d08a94f8c0edcbc7fd95" \
  -d '{"to": "08123456789", "message": "Tes notifikasi gateway"}'
```

#### Upload Dokumen PDF Langsung:
```bash
curl -X POST http://localhost:3001/send-document \
  -H "x-api-key: gw_e73130f4cf925f837db258b868e3bff5688c810c3b79d08a94f8c0edcbc7fd95" \
  -F "to=08123456789" \
  -F "file=@/path/to/dokumen.pdf" \
  -F "caption=Lampiran surat resmi"
```

#### Polling Status Job:
```bash
curl -X GET http://localhost:3001/jobs/job_1788191325138_59775b4e \
  -H "x-api-key: gw_e73130f4cf925f837db258b868e3bff5688c810c3b79d08a94f8c0edcbc7fd95"
```
