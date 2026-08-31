import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import QRCode from 'qrcode';
import { config } from '../config/app.js';
import { DEFAULT_APP_NAME, DEFAULT_DOC_NAME, DEFAULT_DOC_MIMETYPE } from '../config/constants.js';
import { sessionService } from './sessionService.js';
import { logger } from '../utils/logger.js';
import { cleanPhoneNumber, normalizeJid } from '../utils/jidHelper.js';

export class BaileysService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected';
    this.qrRaw = null;
    this.qrDataUrl = null;
    this.user = null;
    this.sessionDir = config.sessionDir;
    this.logger = logger;
    this.msgRetryCounterCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 15000;
    this.lastDisconnect = null;
    this.reconnectTimer = null;
  }

  async init() {
    sessionService.ensureDirectory();

    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

    console.log('[WA-GATEWAY] Menginisialisasi Baileys v7 Engine...');
    this.status = 'connecting';

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      msgRetryCounterCache: this.msgRetryCounterCache,
      logger: this.logger,
      defaultQueryTimeoutMs: 30000,
    });

    this.sock.ev.on('creds.update', saveCreds);

    const socket = this.sock;

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrRaw = qr;
        try {
          this.qrDataUrl = await QRCode.toDataURL(qr);
        } catch (e) {
          console.error('[WA-GATEWAY] Gagal membuat QR Data URL:', e.message);
        }
        this.status = 'qr_ready';
        console.log('[WA-GATEWAY] QR Code siap dipindai via GET /qr/raw.');
      }

      if (connection === 'open') {
        this.status = 'connected';
        this.qrRaw = null;
        this.qrDataUrl = null;
        this.reconnectAttempts = 0;

        const rawJid = this.sock.user?.id || '';
        const normalizedJid = jidNormalizedUser(rawJid);
        const phone = normalizedJid.split('@')[0];

        this.user = {
          id: normalizedJid,
          name: this.sock.user?.name || config.serviceName,
          phone,
        };

        console.log(`[WA-GATEWAY] WhatsApp TERHUBUNG. Nomor pengirim: +${phone}`);
      }

      if (connection === 'close') {
        if (this.sock !== socket) {
          console.log('[WA-GATEWAY] Event close dari socket lama diabaikan.');
          return;
        }

        const boomError = lastDisconnect?.error instanceof Boom ? lastDisconnect.error : null;
        const statusCode = boomError?.output?.statusCode || lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isRestartRequired = statusCode === DisconnectReason.restartRequired;

        this.status = 'disconnected';
        this.user = null;

        this.lastDisconnect = {
          at: new Date().toISOString(),
          code: statusCode ?? null,
          reason: lastDisconnect?.error?.message || 'Unknown',
        };

        console.warn(`[WA-GATEWAY] Koneksi terputus. Kode status: ${statusCode} (${lastDisconnect?.error?.message || 'Unknown'})`);

        if (isLoggedOut) {
          console.log('[WA-GATEWAY] Sesi logout dari WhatsApp (401). Menghapus data sesi lama...');
          sessionService.clearSession();
          this.init();
        } else if (isRestartRequired) {
          console.log('[WA-GATEWAY] Restart required oleh server WhatsApp (515). Reconnecting instan...');
          this.init();
        } else {
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          const delay = Math.min(3000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
          this.reconnectAttempts++;
          console.log(`[WA-GATEWAY] Mencoba menghubungkan kembali dalam ${(delay / 1000).toFixed(1)} detik (Percobaan #${this.reconnectAttempts})...`);
          this.reconnectTimer = setTimeout(() => this.init(), delay);
        }
      }
    });
  }

  async checkNumber(phone) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp Gateway belum terhubung.');
    }

    const clean = cleanPhoneNumber(phone);
    if (!clean) {
      throw new Error(`Nomor telepon '${phone}' tidak valid.`);
    }

    try {
      const results = await this.sock.onWhatsApp(clean);
      const match = Array.isArray(results) && results.length > 0 ? results[0] : null;

      return {
        exists: !!match?.exists,
        phone: clean,
        jid: match?.jid ? jidNormalizedUser(match.jid) : null,
      };
    } catch (error) {
      console.error(`[WA-GATEWAY] Gagal cek nomor ${phone}:`, error.message);
      throw error;
    }
  }

  async requestPairingCode(phone) {
    if (!this.sock) {
      throw new Error('Klien WhatsApp belum diinisialisasi.');
    }

    if (this.status === 'connected') {
      throw new Error('WhatsApp sudah dalam status terhubung.');
    }

    const clean = cleanPhoneNumber(phone);
    if (!clean) {
      throw new Error(`Nomor telepon '${phone}' tidak valid untuk format WhatsApp Indonesia.`);
    }

    try {
      const code = await this.sock.requestPairingCode(clean);
      return {
        success: true,
        phone: clean,
        pairing_code: code,
        instruction: 'Buka WhatsApp di HP > Perangkat Tertaut > Tautkan dengan nomor telepon saja > Masukkan kode 8 digit ini.',
      };
    } catch (error) {
      console.error('[WA-GATEWAY] Gagal meminta Pairing Code:', error.message);
      throw error;
    }
  }

  async sendMessage(phone, message) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp Gateway belum terhubung. Silakan scan QR Code terlebih dahulu.');
    }

    const jid = normalizeJid(phone);
    if (!jid) {
      throw new Error(`Nomor telepon '${phone}' tidak valid untuk format WhatsApp Indonesia.`);
    }

    if (!message || typeof message !== 'string' || message.trim() === '') {
      throw new Error('Pesan teks tidak boleh kosong.');
    }

    try {
      const response = await this.sock.sendMessage(jid, {
        text: message.trim(),
      });

      return {
        success: true,
        messageId: response?.key?.id || null,
        phone: jid.split('@')[0],
        timestamp: response?.messageTimestamp || Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      console.error(`[WA-GATEWAY] Gagal kirim pesan ke ${phone}:`, error.message);
      throw error;
    }
  }

  async sendDocument(phone, documentUrl, options = {}) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp Gateway belum terhubung. Silakan scan QR Code terlebih dahulu.');
    }

    const jid = normalizeJid(phone);
    if (!jid) {
      throw new Error(`Nomor telepon '${phone}' tidak valid.`);
    }

    if (!documentUrl || typeof documentUrl !== 'string') {
      throw new Error('Parameter document URL/path wajib disertakan.');
    }

    const fileName = options.fileName || options.filename || DEFAULT_DOC_NAME;
    const mimetype = options.mimetype || DEFAULT_DOC_MIMETYPE;
    const caption = options.caption || '';

    try {
      const payload = {
        document: { url: documentUrl },
        mimetype,
        fileName,
      };

      if (caption.trim() !== '') {
        payload.caption = caption.trim();
      }

      const response = await this.sock.sendMessage(jid, payload);

      return {
        success: true,
        messageId: response?.key?.id || null,
        phone: jid.split('@')[0],
        fileName,
        timestamp: response?.messageTimestamp || Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      console.error(`[WA-GATEWAY] Gagal kirim dokumen ke ${phone}:`, error.message);
      throw error;
    }
  }

  async sendImage(phone, imageUrl, caption = '') {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp Gateway belum terhubung. Silakan scan QR Code terlebih dahulu.');
    }

    const jid = normalizeJid(phone);
    if (!jid) {
      throw new Error(`Nomor telepon '${phone}' tidak valid.`);
    }

    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('Parameter image URL/path wajib disertakan.');
    }

    try {
      const payload = {
        image: { url: imageUrl },
      };

      if (caption && typeof caption === 'string' && caption.trim() !== '') {
        payload.caption = caption.trim();
      }

      const response = await this.sock.sendMessage(jid, payload);

      return {
        success: true,
        messageId: response?.key?.id || null,
        phone: jid.split('@')[0],
        timestamp: response?.messageTimestamp || Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      console.error(`[WA-GATEWAY] Gagal kirim gambar ke ${phone}:`, error.message);
      throw error;
    }
  }

  async sendBulk(recipients, defaultDelayMs = config.bulk.defaultDelayMs) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp Gateway belum terhubung.');
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new Error("Parameter 'recipients' harus berupa array yang tidak kosong.");
    }

    const results = [];
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < recipients.length; i++) {
      const item = recipients[i];
      const phone = item.phone || item.no_wa;
      const message = item.message || item.text;

      try {
        if (!phone || !message) {
          results.push({ phone: phone || null, success: false, error: 'Nomor atau pesan kosong' });
          continue;
        }

        const res = await this.sendMessage(phone, message);
        results.push({ phone: res.phone, success: true, messageId: res.messageId });
      } catch (err) {
        results.push({ phone, success: false, error: err.message });
      }

      if (i < recipients.length - 1) {
        const jitter = defaultDelayMs + Math.floor(Math.random() * 800);
        await sleep(jitter);
      }
    }

    const successfulCount = results.filter((r) => r.success).length;

    return {
      total: recipients.length,
      success_count: successfulCount,
      failed_count: recipients.length - successfulCount,
      results,
    };
  }

  async restart() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const socket = this.sock;

    if (socket) {
      this.sock = null;
      try {
        socket.end(undefined);
      } catch {
        // Socket already closed
      }
    }

    this.status = 'disconnected';
    this.qrRaw = null;
    this.qrDataUrl = null;
    this.reconnectAttempts = 0;

    await this.init();
    return this.getStatus();
  }

  async logout() {
    const socket = this.sock;
    this.sock = null;

    try {
      if (socket) {
        await socket.logout();
      }
    } catch {
      // Connection already closed
    }

    sessionService.clearSession();
    this.status = 'disconnected';
    this.user = null;
    this.qrRaw = null;
    this.qrDataUrl = null;

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.init(), 1000);
  }

  shutdown() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const socket = this.sock;
    this.sock = null;
    this.status = 'disconnected';

    if (socket) {
      try {
        socket.end(undefined);
      } catch {
        // Socket already closed
      }
    }

    console.log('[WA-GATEWAY] Koneksi WhatsApp ditutup tanpa logout.');
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      user: this.user,
      qr_available: !!this.qrDataUrl,
      last_disconnect: this.lastDisconnect || null,
    };
  }
}

export const waClient = new BaileysService();
