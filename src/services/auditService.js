import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/app.js';
import { logger } from '../utils/logger.js';

export const maskPhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return 'unknown';
  if (digits.length <= 6) return `${digits.slice(0, 2)}xxxx`;
  return `${digits.slice(0, 4)}${'x'.repeat(digits.length - 6)}${digits.slice(-2)}`;
};

export class AuditService {
  constructor({ file = config.audit.file, enabled = config.audit.enabled, maxIndex = config.audit.indexMax } = {}) {
    this.file = file;
    this.enabled = enabled;
    this.maxIndex = maxIndex;
    this.index = new Map();
  }

  record(entry) {
    if (!this.enabled || !entry) return;

    const safe = {
      ts: new Date().toISOString(),
      message_id: entry.message_id || null,
      ref_id: entry.ref_id || null,
      phone: maskPhone(entry.phone),
      endpoint: String(entry.endpoint || 'unknown'),
      result: String(entry.result || 'unknown'),
      http_status: Number(entry.http_status) || 0,
      code: entry.code || null,
      latency_ms: Number.isFinite(entry.latency_ms) ? entry.latency_ms : null,
    };

    if (safe.message_id) {
      if (this.index.size >= this.maxIndex && !this.index.has(safe.message_id)) {
        this.index.delete(this.index.keys().next().value);
      }
      this.index.set(safe.message_id, safe);
    }

    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(safe)}\n`);
    } catch (err) {
      logger.warn({ err: err.message }, '[AUDIT] Gagal menulis audit log, pengiriman tetap berjalan');
    }
  }

  find(messageId) {
    const cached = this.index.get(messageId);
    if (cached) return cached;

    // Fallback lintas restart: pindai file dari baris terakhir.
    try {
      if (!fs.existsSync(this.file)) return null;
      const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.message_id === messageId) return entry;
        } catch {
          // Abaikan baris rusak
        }
      }
    } catch {
      // File tidak terbaca
    }
    return null;
  }
}

export const auditService = new AuditService();
