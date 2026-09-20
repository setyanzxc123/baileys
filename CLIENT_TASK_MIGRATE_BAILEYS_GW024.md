# Task Brief: Migrasi Integrasi Baileys ke Kontrak Gateway gw-024

> **Untuk sesi agent berikutnya di repo `dprd_signage` (CodeIgniter 4 / PHP).**
> File ini self-contained: tidak perlu konteks percakapan sebelumnya. Baca seluruhnya sebelum mengedit.
> Sumber kebenaran kontrak API: `DOKUMENTASI_API.md` dan `MIGRATION_CLIENT.md` di repo gateway `C:\Users\Novantho\Desktop\baileys`.

## 1. Konteks

Gateway WhatsApp (`baileys`, `http://127.0.0.1:3001`) telah diubah total oleh fitur **gw-024** (breaking change):

- `POST /send-otp` **dihapus** (membalas 404).
- `GET /otp-templates` **dihapus**.
- Semua pengiriman kini lewat **`POST /send-message`** dengan body `{phone, message, wait_for_ack?, ack_timeout_ms?}`. Teks pesan (termasuk template OTP) dirakit sepenuhnya oleh client.
- Gateway tidak lagi mengenal field `otp`, `template`, `app_name`, `expiry_minutes`, `include_ref`.
- Respons sukses hanya: `{messageId, phone, timestamp, server_ack, ack_elapsed_ms}` (tidak ada lagi `otp_length`, `template_index`, `ref_id`).
- Endpoint lain tidak berubah: `GET /status`, `GET /health`, `GET /qr/raw`, `POST /pair-code`, `POST /logout`, `POST /restart`, `GET /audit/:messageId`.

Safety rails yang **tetap aktif di gateway** untuk `/send-message` (client tidak boleh mengasumsikan sebaliknya):

- Cooldown per nomor: **1 pesan / 60 detik** per nomor tujuan → 429 `OTP_COOLDOWN`. Berlaku untuk SEMUA pesan, bukan hanya OTP.
- Limit per nomor: maks **5 pesan / jam** → 429 `OTP_HOURLY_LIMIT`.
- Kuota pengirim global: 60/jam, 400/hari → 429 `WA_SENDER_LIMIT`.
- Circuit breaker 463 → 429 `WA_CIRCUIT_BREAKER_OPEN`; nomor tak terdaftar → 422 `WA_NUMBER_NOT_REGISTERED`.
- Cooldown/hourly di-refund gateway saat kirim gagal, **kecuali HTTP 504** (ACK timeout = status ambigu, sengaja tidak di-refund untuk mencegah kirim dobel).
- Header `Idempotency-Key` didukung: retry dengan key yang sama membalas respons tersimpan (header `Idempotent-Replay: true`) tanpa mengirim ulang.

## 2. Titik Integrasi di Repo Ini (sudah dipetakan)

Hanya SATU jalur kirim ke gateway; sisanya tidak terdampak:

| File | Peran | Terdampak? |
|---|---|---|
| `app/Libraries/Otp/Providers/BaileysProvider.php` | `sendOtp()` memanggil `/send-otp` (baris ~26-58) | **YA — utama** |
| `app/Libraries/Otp/OtpService.php` | `dispatchOtp()` memanggil `baileysProvider->sendOtp($phone, $code)` (baris ~247) dengan fallback Fazpass | Kecil (lihat 3.3) |
| `app/Config/Otp.php` | Konfig `baileysOtpTemplate`, `appName`, `ttlSeconds`, dsb. | **YA — kecil** |
| `tests/unit/BaileysProviderTest.php` | Mengasert URL `/send-otp` & payload `otp` | **YA** |
| `tests/unit/HybridOtpServiceTest.php` | Memakai `BaileysProvider` via transport mock | Mungkin penyesuaian minor |
| `BaileysProvider::getStatus/getRawQr/requestPairCode/logoutDevice` | `/status`, `/qr/raw`, `/pair-code`, `/logout` | **Tidak** |
| `app/Libraries/Notification/NotificationService.php` | Hanya `getStatus()` untuk feed admin | **Tidak** |
| `app/Libraries/Otp/ValueObjects/BaileysSendResult.php` | Hanya baca `messageId`/`server_ack`/`ack_elapsed_ms` | **Tidak** |

Aturan repo ini (AGENTS.md): jangan commit tanpa konfirmasi dev; satu konteks per commit; komentar profesional dan seperlunya.


## 3. Perubahan yang Harus Dikerjakan

### 3.1 `app/Libraries/Otp/Providers/BaileysProvider.php`

a. Ganti isi `sendOtp()` — rakit pesan di client, kirim ke `/send-message`:

```php
    public function sendOtp(string $phone, string $code, ?string $idempotencyKey = null): BaileysSendResult
    {
        if (! $this->isConfigured()) {
            return new BaileysSendResult(
                false,
                error: 'Baileys gateway belum dikonfigurasi.',
                errorCode: 'NOT_CONFIGURED',
                statusCode: 0,
            );
        }

        $body = [
            'phone'          => $phone,
            'message'        => $this->buildOtpMessage($code),
            'wait_for_ack'   => $this->config->baileysWaitForAck,
            'ack_timeout_ms' => $this->config->baileysAckTimeoutMs,
        ];

        $timeoutSeconds = max(5, $this->config->baileysTimeoutSeconds);

        $response = $this->transport->postJson(
            $this->endpoint('/send-message'),
            $this->headers($idempotencyKey),
            $body,
            $timeoutSeconds,
        );

        return $this->parseSendResponse($response);
    }
```

b. Tambah perakitan pesan (template milik client, menggantikan template gateway). Placeholder `{{otp}}`, `{{app_name}}`, `{{expiry_minutes}}` disubstitusi di sini:

```php
    private const OTP_MESSAGE_TEMPLATE = "*KODE VERIFIKASI LOGIN*\n\nKode OTP Anda untuk portal *{{app_name}}* adalah:\n\n*{{otp}}*\n\n_Kode ini berlaku selama {{expiry_minutes}} menit. Jangan berikan kode ini kepada siapapun termasuk petugas._";

    private function buildOtpMessage(string $code): string
    {
        $template = $this->config->baileysOtpTemplate ?? self::OTP_MESSAGE_TEMPLATE;
        $expiryMinutes = (string) max(1, (int) floor($this->config->ttlSeconds / 60));

        return strtr($template, [
            '{{otp}}'            => $code,
            '{{app_name}}'       => $this->config->appName,
            '{{expiry_minutes}}' => $expiryMinutes,
        ]);
    }
```

c. Ubah `headers()` agar menerima key opsional:

```php
    private function headers(?string $idempotencyKey = null): array
    {
        $headers = [
            'x-api-key' => $this->config->baileysApiKey,
            'Accept'    => 'application/json',
        ];

        if ($idempotencyKey !== null && $this->config->baileysIdempotencyEnabled) {
            $headers['Idempotency-Key'] = $idempotencyKey;
        }

        return $headers;
    }
```

d. `parseSendResponse()`, `defaultErrorCodeForStatus()`, dan method lain tidak berubah.

### 3.2 `app/Config/Otp.php`

Tambah properti + env:

```php
    public bool $baileysIdempotencyEnabled = true;
```
di constructor: `$this->baileysIdempotencyEnabled = $this->envBool('BAILEYS_IDEMPOTENCY_ENABLED', $this->baileysIdempotencyEnabled);`

`baileysOtpTemplate` tetap dipertahankan: maknanya kini template client-side dan **wajib memuat `{{otp}}`** (tidak ada lagi validasi di gateway).

### 3.3 `app/Libraries/Otp/OtpService.php`

Di `dispatchOtp()` (baris ~247), teruskan key deterministik agar retry aman:

```php
$baileysResult = $this->baileysProvider->sendOtp($phone, $code, 'otp-' . $otpId);
```

Key berbasis `$otpId` (id row OTP), bukan timestamp, supaya retry atas OTP yang sama memakai key yang sama.

### 3.4 Tests

`tests/unit/BaileysProviderTest.php`:
- Asersi URL berubah: `$transport->url` harus `http://127.0.0.1:3001/send-message`.
- Asersi payload berubah: tidak ada `payload['otp']`; ganti dengan `payload['message']` dan assert `assertStringContainsString('748192', $transport->payload['message'])` serta memuat `appName`.
- Tambah 1 test: header `Idempotency-Key` terkirim bila key diberikan, dan absen bila null.

Jalankan `composer test` (atau `vendor/bin/phpunit --no-coverage tests/unit/BaileysProviderTest.php tests/unit/HybridOtpServiceTest.php` untuk loop cepat) dan `composer lint:phpstan`. Perbaiki `HybridOtpServiceTest` hanya bila ada asersi payload `otp` yang ikut rusak.

### 3.5 Dokumen lingkungan

- File `env` (template env): baris `# BAILEYS_OTP_TEMPLATE = ''` tetap valid (kini berarti template client-side; wajib memuat `{{otp}}`). Tambahkan `# BAILEYS_IDEMPOTENCY_ENABLED = true`.
- `DOKUMENTASI_API_gateway_bileys.md` di repo ini adalah salinan usang (masih memuat `/send-otp`, `/send-document`, `/send-bulk`, `/check-number`). Ganti seluruh isinya dengan `DOKUMENTASI_API.md` terbaru dari repo gateway (`C:\Users\Novantho\Desktop\baileys\DOKUMENTASI_API.md`).

## 4. Kriteria Selesai (Definition of Done)

1. Tidak ada lagi referensi `/send-otp` di `app/` dan `tests/` (grep: `send-otp`).
2. `composer test` hijau (khususnya `BaileysProviderTest`, `HybridOtpServiceTest`, `EmergencyOtpLoginFeatureTest`).
3. `composer lint:phpstan` tanpa error baru.
4. Pesan yang dirakit client mengandung kode OTP, nama aplikasi, dan masa berlaku.
5. Header `Idempotency-Key` terkirim pada jalur OTP.
6. **Jangan** menjalankan pengiriman nyata ke gateway/nomor WhatsApp selama pengujian; gunakan transport mock seperti test yang sudah ada.

## 5. Catatan Perilaku Baru yang Harus Dipahami

- Cooldown gateway kini memblokir **semua pesan** ke nomor yang sama dalam 60 detik (bukan hanya OTP). Untuk aplikasi ini aman karena `resendCooldownSeconds` client juga 60 detik dan hanya OTP yang dikirim.
- Setelah respons **504** (ACK timeout), jangan retry buta: stanza mungkin sudah terkirim. Jalur resend user aman bila memakai `Idempotency-Key` yang sama (`otp-{id}`); gateway akan me-replay respons tanpa kirim ulang.
- Setelah gateway di-restart (PM2), state cooldown/idempotency di gateway tereset. Kombinasi `Idempotency-Key` deterministik + cooldown client-side (`resendCooldownSeconds`) adalah pelindung utamanya.
