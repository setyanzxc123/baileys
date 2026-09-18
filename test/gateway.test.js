import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.API_KEY = process.env.API_KEY || 'mock-test-key';
process.env.COMPOSING_DELAY_MS = '0';

const { app } = await import('../src/app.js');
const { waClient } = await import('../src/services/baileysService.js');

const API_KEY = process.env.API_KEY;
const authHeaders = { 'Content-Type': 'application/json', 'x-api-key': API_KEY };

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  waClient.shutdown();
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  waClient.sock = null;
  waClient.status = 'disconnected';
  waClient.user = null;
  waClient.deliveryGuard.reset();
});

const uniquePhone = () => `08123${String(Date.now()).slice(-6)}`;

const injectConnectedSock = (overrides = {}) => {
  waClient.status = 'connected';
  waClient.user = { id: '628999000111@s.whatsapp.net', name: 'Mock Sender', phone: '628999000111' };
  waClient.sock = {
    user: { id: '628999000111@s.whatsapp.net' },
    onWhatsApp: async () => [{ exists: true, jid: '628123456789@s.whatsapp.net' }],
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload, opts) => {
      return { key: { id: opts.messageId }, messageTimestamp: 1789000000 };
    },
    ...overrides,
  };
};

const jsonPost = (path, body, headers = authHeaders) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

test('POST /send-otp sukses tanpa menunggu server ack', async () => {
  injectConnectedSock();
  const res = await jsonPost('/send-otp', { phone: uniquePhone(), otp: '123456', wait_for_ack: false });
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, 'success');
  assert.strictEqual(data.data.server_ack, undefined);
  assert.ok(data.data.messageId);
  assert.ok(typeof data.data.template_index === 'number');
  assert.match(data.data.ref_id, /^[2-9A-Z]{5}$/);
  assert.ok(data.data.ref_id);
});

test('POST /send-otp menunggu dan menerima server ack dari socket', async () => {
  injectConnectedSock({
    sendMessage: async (jid, payload, opts) => {
      setTimeout(() => {
        waClient.handleMessageAck({ attrs: { class: 'message', id: opts.messageId, from: jid } });
      }, 30);
      return { key: { id: opts.messageId }, messageTimestamp: 1789000000 };
    },
  });

  const res = await jsonPost('/send-otp', { phone: uniquePhone(), otp: '654321', ack_timeout_ms: 1000 });
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.data.server_ack, true);
  assert.ok(data.data.ack_elapsed_ms >= 0);
});

test('POST /send-otp server ack timeout menghasilkan 504 WA_SERVER_ACK_TIMEOUT', async () => {
  injectConnectedSock();
  const res = await jsonPost('/send-otp', { phone: uniquePhone(), otp: '111111', ack_timeout_ms: 100 });
  const data = await res.json();

  assert.strictEqual(res.status, 504);
  assert.strictEqual(data.code, 'WA_SERVER_ACK_TIMEOUT');
});

test('POST /send-otp ke nomor tidak terdaftar dihentikan 422 WA_NUMBER_NOT_REGISTERED', async () => {
  injectConnectedSock({
    onWhatsApp: async () => [{ exists: false, jid: null }],
  });

  const res = await jsonPost('/send-otp', { phone: uniquePhone(), otp: '222222', wait_for_ack: false });
  const data = await res.json();

  assert.strictEqual(res.status, 422);
  assert.strictEqual(data.code, 'WA_NUMBER_NOT_REGISTERED');
});

test('POST /send-message ke target grup ditolak 422 WA_INVALID_TARGET', async () => {
  injectConnectedSock();

  const res = await jsonPost('/send-message', { to: '120363023456789012@g.us', message: 'tes' });
  const data = await res.json();

  assert.strictEqual(res.status, 422);
  assert.strictEqual(data.code, 'WA_INVALID_TARGET');
});

test('POST /send-message saat gateway offline fast-fail 503 tanpa menyentuh socket', async () => {
  waClient.status = 'disconnected';
  waClient.sock = null;

  const res = await jsonPost('/send-message', { phone: uniquePhone(), message: 'tes' });
  const data = await res.json();

  assert.strictEqual(res.status, 503);
  assert.strictEqual(data.code, 'WA_GATEWAY_OFFLINE');
});

test('POST /send-otp cooldown OTP kedua ke nomor sama ditolak 429 OTP_COOLDOWN', async () => {
  injectConnectedSock();
  const phone = uniquePhone();
  const body = { phone, otp: '555111', wait_for_ack: false };

  const first = await jsonPost('/send-otp', body);
  assert.strictEqual(first.status, 200);

  const second = await jsonPost('/send-otp', body);
  const secondData = await second.json();

  assert.strictEqual(second.status, 429);
  assert.strictEqual(secondData.code, 'OTP_COOLDOWN');
});

test('POST /send-otp payload format otp invalid tidak membakar cooldown nomor', async () => {
  injectConnectedSock();
  const phone = uniquePhone();

  const invalid = await jsonPost('/send-otp', { phone, otp: 'abcd', wait_for_ack: false });
  assert.strictEqual(invalid.status, 422);

  const next = await jsonPost('/send-otp', { phone, otp: '654321', wait_for_ack: false });
  assert.strictEqual(next.status, 200);
});

test('POST /send-otp saat circuit breaker 463 terbuka ditolak 429 WA_CIRCUIT_BREAKER_OPEN', async () => {
  injectConnectedSock();
  waClient.deliveryGuard.registerHit();

  const res = await jsonPost('/send-otp', { phone: uniquePhone(), otp: '333333', wait_for_ack: false });
  const data = await res.json();

  assert.strictEqual(res.status, 429);
  assert.strictEqual(data.code, 'WA_CIRCUIT_BREAKER_OPEN');
  assert.ok(res.headers.get('retry-after'));
});

test('POST /send-otp nomor tak terdaftar tetap lolos saat query onWhatsApp gagal (fallback jaringan)', async () => {
  injectConnectedSock({
    onWhatsApp: async () => {
      throw new Error('network outage');
    },
  });

  const res = await jsonPost('/send-otp', { phone: uniquePhone(), otp: '444444', wait_for_ack: false });
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, 'success');
});

test('Kuota pengirim terkonsumsi tepat satu kali per kirim sukses', async () => {
  injectConnectedSock();
  const before = waClient.senderLimit.snapshot();

  await jsonPost('/send-message', { phone: uniquePhone(), message: 'tes', wait_for_ack: false });

  const afterSnap = waClient.senderLimit.snapshot();
  assert.strictEqual(afterSnap.used_hour, before.used_hour + 1);
});

test('Kuota pengirim tidak terbakar saat gateway offline', async () => {
  waClient.status = 'disconnected';
  waClient.sock = null;
  const before = waClient.senderLimit.snapshot();

  const res = await jsonPost('/send-message', { phone: uniquePhone(), message: 'tes' });
  assert.strictEqual(res.status, 503);

  const afterSnap = waClient.senderLimit.snapshot();
  assert.strictEqual(afterSnap.used_hour, before.used_hour);
  assert.strictEqual(afterSnap.used_day, before.used_day);
});

test('Kuota pengirim tidak terbakar saat nomor tidak terdaftar', async () => {
  injectConnectedSock({
    onWhatsApp: async () => [{ exists: false, jid: null }],
  });
  const before = waClient.senderLimit.snapshot();

  const res = await jsonPost('/send-message', { phone: uniquePhone(), message: 'tes', wait_for_ack: false });
  assert.strictEqual(res.status, 422);

  const afterSnap = waClient.senderLimit.snapshot();
  assert.strictEqual(afterSnap.used_hour, before.used_hour);
});

test('Kuota pengirim tidak terbakar saat circuit breaker terbuka', async () => {
  injectConnectedSock();
  waClient.deliveryGuard.registerHit();
  const before = waClient.senderLimit.snapshot();

  const res = await jsonPost('/send-message', { phone: uniquePhone(), message: 'tes', wait_for_ack: false });
  assert.strictEqual(res.status, 429);

  const afterSnap = waClient.senderLimit.snapshot();
  assert.strictEqual(afterSnap.used_hour, before.used_hour);
});

test('OTP cooldown di-refund saat kirim gagal sehingga percobaan berikutnya diloloskan', async () => {
  const phone = uniquePhone();
  const body = { phone, otp: '777777', wait_for_ack: false };

  waClient.status = 'disconnected';
  waClient.sock = null;
  const failed = await jsonPost('/send-otp', body);
  assert.strictEqual(failed.status, 503);

  injectConnectedSock();
  const retried = await jsonPost('/send-otp', body);
  assert.strictEqual(retried.status, 200);
});

test('OTP cooldown tidak di-refund saat server ack timeout (504) untuk cegah OTP dobel', async () => {
  injectConnectedSock();
  const phone = uniquePhone();
  const body = { phone, otp: '888888', ack_timeout_ms: 100 };

  const first = await jsonPost('/send-otp', body);
  assert.strictEqual(first.status, 504);

  const second = await jsonPost('/send-otp', { ...body, wait_for_ack: false });
  const secondData = await second.json();

  assert.strictEqual(second.status, 429);
  assert.strictEqual(secondData.code, 'OTP_COOLDOWN');
});

test('GET /status menampilkan konfigurasi server ack', async () => {
  const res = await fetch(`${baseUrl}/status`, { headers: { 'x-api-key': API_KEY } });
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.ok(data.data?.server_ack);
  assert.strictEqual(typeof data.data.server_ack.enabled, 'boolean');
  assert.strictEqual(typeof data.data.server_ack.timeout_ms, 'number');
  assert.strictEqual(typeof data.data.server_ack.pending_acks, 'number');
});

test('BaileysService.sendMessage gagal via penolakan server menghasilkan 502 WA_SERVER_REJECTED', async () => {
  injectConnectedSock({
    sendMessage: async (jid, payload, opts) => {
      setTimeout(() => {
        waClient.handleMessageAck({ attrs: { class: 'message', id: opts.messageId, from: jid, error: '463' } });
      }, 30);
      return { key: { id: opts.messageId }, messageTimestamp: 1789000000 };
    },
  });

  const res = await jsonPost('/send-message', { phone: uniquePhone(), message: 'tes', ack_timeout_ms: 1000 });
  const data = await res.json();

  assert.strictEqual(res.status, 502);
  assert.strictEqual(data.code, 'WA_SERVER_REJECTED');
  assert.strictEqual(data.server_error_code, '463');
});
