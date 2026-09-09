import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { SessionService } from '../src/services/sessionService.js';
import { BaileysService } from '../src/services/baileysService.js';
import { isTcTokenExpired, TC_TOKEN_BUCKET_DURATION, TC_TOKEN_NUM_BUCKETS } from '../src/utils/tcTokenHelper.js';
import { createDeliveryGuard } from '../src/utils/deliveryGuard.js';
import { createSenderRateLimiter } from '../src/utils/senderRateLimiter.js';
import { buildOtpMessage, parseSpintax } from '../src/utils/otpTemplateHelper.js';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const jsonPost = (path, body, headers = {}) =>
  fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const samplePhone = () => `08123${Math.floor(100000 + Math.random() * 900000)}`;

const gatewayConnected = async () => {
  const res = await fetch(`${BASE_URL}/status`, { headers: { 'x-api-key': API_KEY } });
  const data = await res.json();
  return data.data?.connected === true;
};

test('GET / — service discovery mengembalikan katalog endpoint', async () => {
  const res = await fetch(`${BASE_URL}/`);
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.engine, 'Baileys v7');
  assert.strictEqual(data.status, 'running');
  for (const key of ['send_otp', 'send_document', 'send_image', 'send_bulk', 'get_job']) {
    assert.ok(data.endpoints?.[key], `endpoint '${key}' hilang dari discovery`);
  }
});

test('GET /health — health check mengembalikan status ok + metrik memori', async () => {
  const res = await fetch(`${BASE_URL}/health`);
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, 'ok');
  assert.ok(data.uptime_seconds >= 0);
  assert.ok(Number(data.memory?.heap_used_mb) >= 0);
});

test('POST /send-otp tanpa API key — ditolak 401', async () => {
  const res = await jsonPost('/send-otp', { phone: '08123456789', otp: '123456' });
  assert.strictEqual(res.status, 401);
});

test('POST /send-document dengan API key salah — ditolak 401', async () => {
  const res = await jsonPost(
    '/send-document',
    { phone: '08123456789', url: 'https://example.com/doc.pdf' },
    { 'x-api-key': 'wrong_key' }
  );
  assert.strictEqual(res.status, 401);
});

test('GET /status dan /qr/raw tanpa API key — ditolak 401 (headless protected)', async () => {
  assert.strictEqual((await fetch(`${BASE_URL}/status`)).status, 401);
  assert.strictEqual((await fetch(`${BASE_URL}/qr/raw`)).status, 401);
});

test('GET /qr (halaman HTML) — sudah dihapus, 404', async () => {
  assert.strictEqual((await fetch(`${BASE_URL}/qr`)).status, 404);
});

test('POST /send-message dengan Content-Type text/plain — 422 JSON', async () => {
  const res = await fetch(`${BASE_URL}/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'x-api-key': API_KEY },
    body: 'hello',
  });
  const data = await res.json();
  assert.strictEqual(res.status, 422);
  assert.strictEqual(data.status, 'error');
});

test('POST /send-message dengan body JSON rusak — 400 JSON', async () => {
  const res = await fetch(`${BASE_URL}/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: '{"phone": broken',
  });
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const data = await res.json();
  assert.strictEqual(res.status, 400);
  assert.strictEqual(data.status, 'error');
});

test('GET /nonexistent — 404 JSON konsisten', async () => {
  const res = await fetch(`${BASE_URL}/nonexistent`);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const data = await res.json();
  assert.strictEqual(res.status, 404);
  assert.strictEqual(data.code, 'NOT_FOUND');
});

test('POST /send-otp tanpa parameter otp — 422', async () => {
  const res = await jsonPost('/send-otp', { phone: '08123456789' }, { 'x-api-key': API_KEY });
  assert.strictEqual(res.status, 422);
});

test('POST /send-document tanpa file dan tanpa document_url — 422', async () => {
  const res = await jsonPost('/send-document', { phone: '08123456789' }, { 'x-api-key': API_KEY });
  assert.strictEqual(res.status, 422);
});

test('POST /send-image tanpa file dan tanpa image_url — 422', async () => {
  const res = await jsonPost('/send-image', { phone: '08123456789' }, { 'x-api-key': API_KEY });
  assert.strictEqual(res.status, 422);
});

test('POST /send-bulk dengan array kosong — 422', async () => {
  const res = await jsonPost('/send-bulk', { recipients: [] }, { 'x-api-key': API_KEY });
  assert.strictEqual(res.status, 422);
});

test('POST /send-bulk melebihi batas penerima — 422 BULK_TOO_MANY_RECIPIENTS', async () => {
  const configured = Number(process.env.BULK_MAX_RECIPIENTS);
  const cap = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 100;
  const recipients = Array.from({ length: cap + 1 }, () => ({ phone: '08123456789', message: 'tes' }));
  const res = await jsonPost('/send-bulk', { recipients }, { 'x-api-key': API_KEY });
  const data = await res.json();
  assert.strictEqual(res.status, 422);
  assert.strictEqual(data.code, 'BULK_TOO_MANY_RECIPIENTS');
});

test('POST /send-bulk delay_ms di bawah floor anti-spam — 422 BULK_DELAY_TOO_SHORT', async () => {
  const res = await jsonPost(
    '/send-bulk',
    { recipients: [{ phone: '08123456789', message: 'tes' }], delay_ms: 50 },
    { 'x-api-key': API_KEY }
  );
  const data = await res.json();
  assert.strictEqual(res.status, 422);
  assert.strictEqual(data.code, 'BULK_DELAY_TOO_SHORT');
});

test('GET /jobs/:job_id tanpa API key — ditolak 401', async () => {
  const res = await fetch(`${BASE_URL}/jobs/job_test_123`);
  assert.strictEqual(res.status, 401);
});

test('GET /jobs/:job_id id tidak ditemukan — 404 JOB_NOT_FOUND', async () => {
  const res = await fetch(`${BASE_URL}/jobs/job_not_exist`, { headers: { 'x-api-key': API_KEY } });
  const data = await res.json();
  assert.strictEqual(res.status, 404);
  assert.strictEqual(data.code, 'JOB_NOT_FOUND');
});

test('POST /send-otp saat gateway offline — fast-fail 503 WA_GATEWAY_OFFLINE', async () => {
  const statusRes = await fetch(`${BASE_URL}/status`, { headers: { 'x-api-key': API_KEY } });
  const status = await statusRes.json();

  if (status.data?.connected) {
    return {
      skipped: true,
      reason: 'gateway sedang online — fast-fail offline dilewati',
    };
  }

  const res = await jsonPost('/send-otp', { phone: samplePhone(), otp: '123456' }, { 'x-api-key': API_KEY });
  const data = await res.json();
  assert.strictEqual(res.status, 503);
  assert.strictEqual(data.code, 'WA_GATEWAY_OFFLINE');
});

test('POST /send-bulk saat gateway offline — fast-fail 503 WA_GATEWAY_OFFLINE', async () => {
  const statusRes = await fetch(`${BASE_URL}/status`, { headers: { 'x-api-key': API_KEY } });
  const status = await statusRes.json();

  if (status.data?.connected) {
    return {
      skipped: true,
      reason: 'gateway sedang online — fast-fail offline dilewati',
    };
  }

  const res = await jsonPost(
    '/send-bulk',
    { recipients: [{ phone: samplePhone(), message: 'tes' }] },
    { 'x-api-key': API_KEY }
  );
  const data = await res.json();
  assert.strictEqual(res.status, 503);
  assert.strictEqual(data.code, 'WA_GATEWAY_OFFLINE');
});

test('POST /send-message ke grup WhatsApp (@g.us) saat gateway offline — fast-fail 503 WA_GATEWAY_OFFLINE', async () => {
  const statusRes = await fetch(`${BASE_URL}/status`, { headers: { 'x-api-key': API_KEY } });
  const status = await statusRes.json();

  if (status.data?.connected) {
    return {
      skipped: true,
      reason: 'gateway sedang online — fast-fail offline dilewati',
    };
  }

  const res = await jsonPost(
    '/send-message',
    { to: '120363023456789012@g.us', message: 'tes grup' },
    { 'x-api-key': API_KEY }
  );
  const data = await res.json();
  assert.strictEqual(res.status, 503);
  assert.strictEqual(data.code, 'WA_GATEWAY_OFFLINE');
});

test('POST /send-otp cooldown — OTP kedua ke nomor sama ditolak 429 OTP_COOLDOWN', async () => {
  if (await gatewayConnected()) {
    return {
      skipped: true,
      reason: 'gateway online — request pertama test ini menembus jalur kirim real, dilewati untuk melindungi nomor',
    };
  }

  const body = { phone: samplePhone(), otp: '555111' };
  const headers = { 'x-api-key': API_KEY };

  const resFirst = await jsonPost('/send-otp', body, headers);
  assert.ok(
    [200, 500, 503].includes(resFirst.status),
    `permintaan pertama diharapkan 200/500/503, didapat ${resFirst.status}`
  );

  const resSecond = await jsonPost('/send-otp', body, headers);
  const dataSecond = await resSecond.json();
  assert.strictEqual(resSecond.status, 429);
  assert.strictEqual(dataSecond.code, 'OTP_COOLDOWN');
});

test('POST /send-otp format OTP tidak valid — 422 OTP_INVALID_FORMAT', async () => {
  const res = await jsonPost('/send-otp', { phone: samplePhone(), otp: '12ab56' }, { 'x-api-key': API_KEY });
  const data = await res.json();
  assert.strictEqual(res.status, 422);
  assert.strictEqual(data.code, 'OTP_INVALID_FORMAT');
});

test('POST /send-otp payload invalid tidak membakar cooldown nomor', async () => {
  if (await gatewayConnected()) {
    return {
      skipped: true,
      reason: 'gateway online — request valid test ini menembus jalur kirim real, dilewati untuk melindungi nomor',
    };
  }

  const phone = samplePhone();
  const headers = { 'x-api-key': API_KEY };

  const resInvalid = await jsonPost('/send-otp', { phone, otp: 'abcd' }, headers);
  assert.strictEqual(resInvalid.status, 422);

  const resNext = await jsonPost('/send-otp', { phone, otp: '654321' }, headers);
  assert.ok(
    [200, 500, 503].includes(resNext.status),
    `OTP valid setelah payload invalid tidak boleh kena 429, didapat ${resNext.status}`
  );
});

test('POST /send-message ke nomor tidak terdaftar — 422 WA_NUMBER_NOT_REGISTERED', async () => {
  if (!(await gatewayConnected())) {
    return {
      skipped: true,
      reason: 'gateway offline — verifikasi nomor tidak terdaftar memerlukan koneksi aktif',
    };
  }

  const res = await jsonPost('/send-message', { phone: '620000000000', message: 'tes' }, { 'x-api-key': API_KEY });
  const data = await res.json();
  assert.strictEqual(res.status, 422);
  assert.strictEqual(data.code, 'WA_NUMBER_NOT_REGISTERED');
});

test('POST /restart — koneksi dimulai ulang tanpa hapus sesi', async () => {
  const res = await fetch(`${BASE_URL}/restart`, { method: 'POST', headers: { 'x-api-key': API_KEY } });
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, 'success');
  assert.ok(
    ['connecting', 'qr_ready', 'connected'].includes(data.data?.current_status),
    `current_status tak terduga: ${data.data?.current_status}`
  );
});

test('SessionService — acquireLock, duplicate guard, dan stale lock recovery', async () => {
  const testDir = path.join(process.cwd(), 'sessions_test_lock');
  const customSessionService = new SessionService(testDir);

  try {
    customSessionService.acquireLock();
    const lockFile = customSessionService.getLockFilePath();
    assert.ok(fs.existsSync(lockFile), 'lockfile harus dibuat');
    assert.strictEqual(fs.readFileSync(lockFile, 'utf8').trim(), String(process.pid));

    assert.strictEqual(customSessionService.isProcessAlive(process.pid), true);
    assert.strictEqual(customSessionService.isProcessAlive(9999999), false);

    fs.writeFileSync(lockFile, '9999999', 'utf8');
    customSessionService.acquireLock();
    assert.strictEqual(fs.readFileSync(lockFile, 'utf8').trim(), String(process.pid), 'stale lock harus ditimpa oleh PID aktif');

    customSessionService.releaseLock();
    assert.strictEqual(fs.existsSync(lockFile), false, 'lockfile harus terhapus setelah releaseLock');
  } finally {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
});

test('isTcTokenExpired — token valid dalam jendela bucket tidak dianggap expired', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const currentBucketStart = Math.floor(nowSec / TC_TOKEN_BUCKET_DURATION) * TC_TOKEN_BUCKET_DURATION;
  const cutoff = (Math.floor(nowSec / TC_TOKEN_BUCKET_DURATION) - (TC_TOKEN_NUM_BUCKETS - 1)) * TC_TOKEN_BUCKET_DURATION;

  assert.strictEqual(isTcTokenExpired(nowSec), false, 'timestamp sekarang harus valid');
  assert.strictEqual(isTcTokenExpired(String(currentBucketStart)), false, 'timestamp string awal bucket harus valid');
  assert.strictEqual(isTcTokenExpired(cutoff), false, 'tepat di cutoff masih valid (>= cutoff)');
  assert.strictEqual(isTcTokenExpired(cutoff - 1), true, 'di bawah cutoff harus expired');
  assert.strictEqual(isTcTokenExpired(nowSec - TC_TOKEN_BUCKET_DURATION * TC_TOKEN_NUM_BUCKETS), true, 'lebih lama dari jendela harus expired');
});

test('isTcTokenExpired — nilai kosong atau tidak valid dianggap expired', () => {
  assert.strictEqual(isTcTokenExpired(undefined), true);
  assert.strictEqual(isTcTokenExpired(null), true);
  assert.strictEqual(isTcTokenExpired('abc'), true);
  assert.strictEqual(isTcTokenExpired(NaN), true);
});

test('deliveryGuard — breaker terbuka bertingkat sesuai jumlah hit dan pulih setelah window', () => {
  const guard = createDeliveryGuard({ escalations: [60000, 300000] });
  const t0 = 1000000;

  assert.strictEqual(guard.isOpen(t0), false);

  const first = guard.registerHit(t0);
  assert.strictEqual(first.hits, 1);
  assert.strictEqual(guard.isOpen(t0 + 59999), true);
  assert.strictEqual(guard.isOpen(t0 + 60001), false, 'hit pertama harus buka 60 detik saja');

  guard.registerHit(t0 + 61000);
  assert.strictEqual(guard.isOpen(t0 + 61000 + 299999), true);
  assert.strictEqual(guard.isOpen(t0 + 61000 + 300001), false, 'hit kedua harus eskalasi ke 5 menit');

  const snap = guard.snapshot(t0 + 70000);
  assert.strictEqual(snap.hits_in_window, 2);
  assert.strictEqual(snap.open, true);
  assert.ok(snap.retry_after_ms > 0);
});

test('senderRateLimiter — blokir saat limit jam penuh dan lepas saat window bergeser', () => {
  const limiter = createSenderRateLimiter({ maxPerHour: 3, maxPerDay: 100 });
  const t0 = 2000000;

  assert.strictEqual(limiter.tryConsume(t0).allowed, true);
  assert.strictEqual(limiter.tryConsume(t0 + 1).allowed, true);
  assert.strictEqual(limiter.tryConsume(t0 + 2).allowed, true);

  const blocked = limiter.tryConsume(t0 + 3);
  assert.strictEqual(blocked.allowed, false, 'kirim ke-4 dalam jam yang sama harus diblokir');
  assert.strictEqual(blocked.tier, 'hour');
  assert.ok(blocked.retryAfterMs > 0);

  assert.strictEqual(limiter.tryConsume(t0 + 3600002).allowed, true, 'setelah 1 jam harus boleh lagi');

  const snap = limiter.snapshot(t0 + 3600002);
  assert.strictEqual(snap.used_hour, 1);
});

test('senderRateLimiter — batas harian menahan pengiriman meski kuota jam masih ada', () => {
  const limiter = createSenderRateLimiter({ maxPerHour: 100, maxPerDay: 3 });
  const t0 = 3000000;

  limiter.tryConsume(t0);
  limiter.tryConsume(t0 + 1000);
  limiter.tryConsume(t0 + 2000);

  const blocked = limiter.tryConsume(t0 + 3000);
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.tier, 'day');
  assert.ok(blocked.retryAfterMs > 86000000 - 4000, 'retry harus menunggu window harian terluar');
});

test('BaileysService — waitForServerAck menyelesaikan Promise saat node ack valid diterima', async () => {
  const service = new BaileysService();
  const msgId = 'TEST_ACK_SUCCESS_123';
  const ackPromise = service.waitForServerAck(msgId, 1000);

  service.handleMessageAck({
    tag: 'ack',
    attrs: {
      class: 'message',
      id: msgId,
      from: '628123456789@s.whatsapp.net',
    },
  });

  const result = await ackPromise;
  assert.strictEqual(result.messageId, msgId);
  assert.strictEqual(result.serverAck, true);
  assert.ok(typeof result.ackElapsedMs === 'number');
  assert.strictEqual(service.pendingAcks.size, 0);
});

test('BaileysService — waitForServerAck mendeteksi penolakan ack ber-error (WA_SERVER_REJECTED 502)', async () => {
  const service = new BaileysService();
  const msgId = 'TEST_ACK_ERROR_463';
  const ackPromise = service.waitForServerAck(msgId, 1000);

  service.handleMessageAck({
    tag: 'ack',
    attrs: {
      class: 'message',
      id: msgId,
      from: '628123456789@s.whatsapp.net',
      error: '463',
    },
  });

  await assert.rejects(
    async () => await ackPromise,
    (err) => {
      assert.strictEqual(err.code, 'WA_SERVER_REJECTED');
      assert.strictEqual(err.statusCode, 502);
      assert.strictEqual(err.serverErrorCode, '463');
      assert.strictEqual(err.messageId, msgId);
      return true;
    }
  );
  assert.strictEqual(service.pendingAcks.size, 0);
});

test('BaileysService — waitForServerAck mendeteksi timeout server ack (WA_SERVER_ACK_TIMEOUT 504)', async () => {
  const service = new BaileysService();
  const msgId = 'TEST_ACK_TIMEOUT';
  const ackPromise = service.waitForServerAck(msgId, 50);

  await assert.rejects(
    async () => await ackPromise,
    (err) => {
      assert.strictEqual(err.code, 'WA_SERVER_ACK_TIMEOUT');
      assert.strictEqual(err.statusCode, 504);
      assert.strictEqual(err.messageId, msgId);
      return true;
    }
  );
  assert.strictEqual(service.pendingAcks.size, 0);
});

test('BaileysService — clearPendingAcks membatalkan semua pending acks saat socket terputus', async () => {
  const service = new BaileysService();
  const msgId1 = 'TEST_ACK_DROP_1';
  const msgId2 = 'TEST_ACK_DROP_2';
  const p1 = service.waitForServerAck(msgId1, 5000);
  const p2 = service.waitForServerAck(msgId2, 5000);

  service.clearPendingAcks('Socket terminated');

  await assert.rejects(
    async () => await p1,
    (err) => {
      assert.strictEqual(err.code, 'WA_SOCKET_CLOSED');
      assert.strictEqual(err.statusCode, 503);
      return true;
    }
  );
  await assert.rejects(
    async () => await p2,
    (err) => {
      assert.strictEqual(err.code, 'WA_SOCKET_CLOSED');
      assert.strictEqual(err.statusCode, 503);
      return true;
    }
  );
  assert.strictEqual(service.pendingAcks.size, 0);
});

test('GET /status menampilkan konfigurasi server_ack dan pending_acks', async () => {
  const res = await fetch(`${BASE_URL}/status`, { headers: { 'x-api-key': API_KEY } });
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.ok(data.data?.server_ack);
  assert.strictEqual(typeof data.data.server_ack.enabled, 'boolean');
  assert.strictEqual(typeof data.data.server_ack.timeout_ms, 'number');
  assert.strictEqual(typeof data.data.server_ack.pending_acks, 'number');
});

test('OTP Template Helper — rotasi template acak dan default ref ID', async () => {
  const seenTemplates = new Set();
  for (let i = 0; i < 20; i++) {
    const res = buildOtpMessage({ otp: '123456', appName: 'PortalTest' });
    assert.ok(res.text.includes('123456'));
    assert.ok(res.text.includes('PortalTest'));
    assert.ok(res.text.includes('Ref: #'));
    assert.strictEqual(typeof res.refId, 'string');
    seenTemplates.add(res.templateIndex);
  }
  assert.ok(seenTemplates.size > 1);
});

test('OTP Template Helper — pemilihan template_index eksplisit dan include_ref=false', async () => {
  const res = buildOtpMessage({
    otp: '654321',
    appName: 'PortalTest',
    templateIndex: 1,
    includeRef: false,
  });
  assert.strictEqual(res.templateIndex, 1);
  assert.strictEqual(res.refId, null);
  assert.ok(!res.text.includes('Ref: #'));
  assert.ok(res.text.includes('654321'));
});

test('OTP Template Helper — parseSpintax dan replacement placeholder custom template', async () => {
  const res = buildOtpMessage({
    otp: '998877',
    appName: 'CustomApp',
    expiryMinutes: 10,
    template: '{Halo|Hai}, kode {{app_name}} Anda: *{{otp}}*. Berlaku {{expiry_minutes}} menit.',
    includeRef: true,
  });
  assert.match(res.text, /^(Halo|Hai), kode CustomApp Anda: \*998877\*\. Berlaku 10 menit\.\n\nRef: #[2-9A-Z]{5}$/);
  assert.strictEqual(res.templateIndex, null);
  assert.strictEqual(typeof res.refId, 'string');
});


const run = async () => {
  console.log(`Smoke Test Integrasi — WhatsApp Gateway (Baileys v7) -> ${BASE_URL}\n`);

  if (!API_KEY || API_KEY.trim() === '') {
    console.error('API_KEY tidak ditemukan di .env.');
    process.exit(1);
  }

  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`GET /health menjawab ${res.status}`);
  } catch (e) {
    console.error(`Server tidak dapat dihubungi di ${BASE_URL} (${e.message}).`);
    process.exit(1);
  }

  let failed = 0;
  let skipped = 0;

  for (const { name, fn } of tests) {
    try {
      const outcome = await fn();
      if (outcome?.skipped) {
        skipped++;
        console.log(`SKIP: ${name} — ${outcome.reason}`);
      } else {
        console.log(`PASS: ${name}`);
      }
    } catch (e) {
      failed++;
      console.error(`FAIL: ${name}\n   -> ${e.message}`);
    }
  }

  console.log(`\nHasil: ${tests.length - skipped - failed} lulus, ${failed} gagal, ${skipped} dilewati.`);

  if (failed > 0) {
    console.error('SMOKE TEST GAGAL.');
    process.exit(1);
  }

  console.log('Semua smoke test lulus.');
};

run();
