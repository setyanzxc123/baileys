/**
 * Monitor /health untuk DPRD WhatsApp Gateway — dijalankan PM2 sebagai
 * 'dprd-wa-monitor'. Mendeteksi dua kegagalan paling umum:
 *   1. GET /health tidak menjawab (proses mati atau nyangkut),
 *   2. whatsapp.connected === false lebih lama dari ambang waktu.
 * Notifikasi keluar sebagai log PM2 + webhook opsional (POST JSON).
 *
 * Variabel lingkungan (opsional, via .env):
 *   MONITOR_BASE_URL             target                 (default http://localhost:3001)
 *   MONITOR_INTERVAL_MS          jeda antar poll        (default 30000)
 *   MONITOR_OFFLINE_THRESHOLD_MS ambang alarm offline   (default 300000 = 5 menit)
 *   MONITOR_WEBHOOK_URL          endpoint POST notifikasi (kosong = log saja)
 *
 * Catatan: monitor berjalan di server yang sama dengan gateway — mampu
 * mendeteksi disconnect WhatsApp, tetapi server mati total tetap memerlukan
 * uptime monitor eksternal yang mengarah ke /health melalui nginx.
 */
import 'dotenv/config';

const BASE_URL = process.env.MONITOR_BASE_URL || 'http://localhost:3001';
const INTERVAL_MS = Number(process.env.MONITOR_INTERVAL_MS) > 0 ? Number(process.env.MONITOR_INTERVAL_MS) : 30_000;
const OFFLINE_THRESHOLD_MS =
  Number(process.env.MONITOR_OFFLINE_THRESHOLD_MS) > 0 ? Number(process.env.MONITOR_OFFLINE_THRESHOLD_MS) : 300_000;
const WEBHOOK_URL = process.env.MONITOR_WEBHOOK_URL || '';

const ts = () => new Date().toISOString();

const notify = async (payload) => {
  console.log(`[monitor] ${payload.event} — ${JSON.stringify(payload)}`);
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error(`[monitor] webhook gagal terkirim: ${e.message}`);
  }
};

// Kondisi: 'ok' | 'wa_offline' | 'health_down' — alarm dikirim satu kali
// per episode (masuk kondisi buruk + pemulihan), bukan setiap poll.
let condition = 'ok';
let waOfflineSince = null;

const poll = async () => {
  let connected;
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`/health menjawab ${res.status}`);
    const data = await res.json();
    connected = data?.whatsapp?.connected === true;
  } catch (e) {
    if (condition !== 'health_down') {
      condition = 'health_down';
      await notify({ event: 'HEALTH_DOWN', at: ts(), detail: `GET /health gagal: ${e.message}` });
    }
    return;
  }

  if (connected === false) {
    if (!waOfflineSince) waOfflineSince = Date.now();
    const elapsed = Date.now() - waOfflineSince;

    if (condition === 'wa_offline') return; // sudah dialarm pada episode ini

    if (elapsed >= OFFLINE_THRESHOLD_MS) {
      condition = 'wa_offline';
      await notify({
        event: 'WA_OFFLINE',
        at: ts(),
        offline_since_ms: elapsed,
        threshold_ms: OFFLINE_THRESHOLD_MS,
      });
    } else {
      console.log(`[monitor] WhatsApp offline ${Math.round(elapsed / 1000)}s (ambang ${Math.round(OFFLINE_THRESHOLD_MS / 1000)}s)...`);
    }
    return;
  }

  // Terhubung (atau baru bangun dari health_down) — umumkan pemulihan.
  if (condition === 'wa_offline' && waOfflineSince) {
    await notify({
      event: 'WA_RECOVERED',
      at: ts(),
      offline_duration_ms: Date.now() - waOfflineSince,
    });
  } else if (condition === 'health_down') {
    await notify({ event: 'HEALTH_RECOVERED', at: ts() });
  }
  condition = 'ok';
  waOfflineSince = null;
};

console.log(
  `[monitor] memantau ${BASE_URL}/health tiap ${INTERVAL_MS / 1000}s, ` +
    `ambang offline ${Math.round(OFFLINE_THRESHOLD_MS / 60000)} menit` +
    `${WEBHOOK_URL ? ', webhook aktif' : ''}`
);

poll();
setInterval(() => {
  poll().catch((e) => console.error(`[monitor] poll error: ${e.message}`));
}, INTERVAL_MS);
