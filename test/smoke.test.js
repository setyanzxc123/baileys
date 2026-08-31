import assert from 'node:assert';
import 'dotenv/config';

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

test('GET / — service discovery mengembalikan katalog endpoint', async () => {
  const res = await fetch(`${BASE_URL}/`);
  const data = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.engine, 'Baileys v7');
  assert.strictEqual(data.status, 'running');
  for (const key of ['send_otp', 'send_document', 'send_image', 'send_bulk']) {
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

test('POST /send-document tanpa document_url — 422', async () => {
  const res = await jsonPost('/send-document', { phone: '08123456789' }, { 'x-api-key': API_KEY });
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

test('POST /send-otp cooldown — OTP kedua ke nomor sama ditolak 429 OTP_COOLDOWN', async () => {
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
