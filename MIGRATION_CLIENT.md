# Migrasi Client: Template OTP Pindah ke Sisi Client (gw-024)

Tanggal: 2026-09-20
Status: **BREAKING CHANGE** — `POST /send-otp` dan `GET /otp-templates` telah dihapus dari gateway.

## Ringkasan

Gateway kini murni *transport pipe* dengan safety rails. Semua logika konten (template, wording, rotasi, spintax, ref ID) menjadi tanggung jawab client. Perubahan ini mengikuti prinsip: **konten milik client, proteksi nomor milik gateway.**

## Perubahan API (Breaking)

| Lama (dihapus) | Baru |
|---|---|
| `POST /send-otp` dengan `{phone, otp, app_name?, template?, template_index?, expiry_minutes?, include_ref?}` | `POST /send-message` dengan `{phone, message, wait_for_ack?, ack_timeout_ms?}` |
| `GET /otp-templates` | Tidak ada; template dikelola penuh di client |
| Respons berisi `otp_length`, `template_index`, `ref_id` | Respons hanya `messageId`, `phone`, `timestamp`, `server_ack`, `ack_elapsed_ms` |
| Error `OTP_INVALID_FORMAT`, `TEMPLATE_MISSING_OTP_PLACEHOLDER` | Tidak ada lagi; validasi isi pesan ada di client |

## Yang WAJIB Diubah di Client

1. **Rakit pesan OTP di client.** Substitusi kode, nama aplikasi, dan masa berlaku dilakukan sebelum memanggil gateway. Contoh minimal:
   ```javascript
   const message = `*KODE VERIFIKASI*\n\nKode OTP Anda untuk ${APP_NAME}: *${otp}*\n\nBerlaku ${EXPIRY_MINUTES} menit. Jangan berikan kode ini kepada siapapun.`;
   await sendWhatsApp({ phone, message });
   ```

2. **Kirim via `POST /send-message`** dengan field `phone` (atau `to`) dan `message` (atau `text`). Tidak ada lagi field `otp`, `template`, `app_name`, `expiry_minutes`, `include_ref`.

3. **Selalu sertakan header `Idempotency-Key`** (misal UUID per upaya kirim). Tanpa gateway-side template, satu-satunya pelindung dari OTP dobel saat retry adalah idempotency key + cooldown per nomor.

4. **Pindahkan fitur anti pattern-detection ke client bila ingin dipertahankan** (fingerprint wire identik dari mana pun teks dirakit):
   - **Rotasi template**: simpan 3-4 variasi wording dan pilih acak per kirim.
   - **Spintax sederhana**: `{Halo|Hai|Yth}` — pilih satu opsi acak.
   - **Ref ID unik**: tambahkan baris `Ref: #XXXXX` (5 karakter acak dari set `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`) di akhir pesan bila ingin hash pesan selalu berbeda.

5. **Jangan bergantung pada `ref_id` di audit log.** Entry audit baru tidak lagi memuat `ref_id`; kunci rekonsiliasi adalah `messageId` dari respons. Bila client butuh penelusuran berbasis ref sendiri, sertakan ref di dalam teks pesan dan simpan pemetaannya di database client.

## Yang Menetap di Gateway (Tidak Perlu Diubah Client)

- Cooldown per nomor: 1 pesan / 60 detik (429 `OTP_COOLDOWN`)
- Limit per nomor: maks 5 pesan / jam (429 `OTP_HOURLY_LIMIT`)
- Kuota pengirim global: 60/jam, 400/hari (429 `WA_SENDER_LIMIT`)
- Circuit breaker 463 (429 `WA_CIRCUIT_BREAKER_OPEN`)
- Pre-check nomor terdaftar (422 `WA_NUMBER_NOT_REGISTERED`) + cache
- Server ACK await (504 `WA_SERVER_ACK_TIMEOUT` bila timeout)
- Audit log + rekonsiliasi `GET /audit/:messageId`
- Refund cooldown/hourly saat kirim gagal (kecuali 504, untuk cegah kirim dobel)

## Perilaku yang Perlu Diantisipasi Client

- **Retry setelah 504 (ACK timeout):** jangan retry buta — stanza mungkin sudah terkirim. Cek `GET /audit/:messageId` dulu, atau retry dengan `Idempotency-Key` yang sama.
- **Cooldown berlaku untuk SEMUA pesan ke nomor yang sama**, bukan hanya OTP. Bila client mengirim notifikasi lain ke nomor yang sama dalam 60 detik, akan kena 429. Rencanakan penjadwalan pesan di client.
- **Kode error cooldown tetap bernama `OTP_COOLDOWN` / `OTP_HOURLY_LIMIT`** meski endpoint-nya kini generik — biarkan mapping error client apa adanya.
