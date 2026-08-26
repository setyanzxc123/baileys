import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

class WhatsAppClient {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrRaw = null;
    this.qrDataUrl = null;
    this.user = null;
    this.sessionDir = process.env.SESSION_DIR || './sessions/primary';
    this.logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
    this.msgRetryCounterCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 15000;
  }

  async init() {
    // Pastikan direktori sesi tersedia
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

    console.log('[WA-GATEWAY] Menginisialisasi Baileys v7 Engine...');
    this.status = 'connecting';

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false, // Hemat RAM & startup instan (tidak perlu load histori chat lama)
      markOnlineOnConnect: false, // Bot tidak terlihat online terus-menerus (Anti-Ban)
      generateHighQualityLinkPreview: false,
      msgRetryCounterCache: this.msgRetryCounterCache,
      logger: this.logger,
      defaultQueryTimeoutMs: 30000,
    });

    // Simpan kredensial saat ada pembaruan sesi
    this.sock.ev.on('creds.update', saveCreds);

    // Monitor pembaruan koneksi
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrRaw = qr;
        try {
          this.qrDataUrl = await QRCode.toDataURL(qr);
        } catch (e) {
          console.error('[WA-GATEWAY] Gagal membuat QR Data URL:', e.message);
        }
        this.status = 'qr_ready';
        console.log('[WA-GATEWAY] QR Code siap dipindai. Buka http://localhost:' + (process.env.PORT || 3001) + '/qr');
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
          name: this.sock.user?.name || 'DPRD WhatsApp Gateway',
          phone,
        };

        console.log(`[WA-GATEWAY] ✅ WhatsApp TERHUBUNG! Nomor pengirim: +${phone}`);
      }

      if (connection === 'close') {
        const boomError = lastDisconnect?.error instanceof Boom ? lastDisconnect.error : null;
        const statusCode = boomError?.output?.statusCode || lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isRestartRequired = statusCode === DisconnectReason.restartRequired;

        this.status = 'disconnected';
        this.user = null;

        console.warn(`[WA-GATEWAY] ⚠️ Koneksi terputus. Kode status: ${statusCode} (${lastDisconnect?.error?.message || 'Unknown'})`);

        if (isLoggedOut) {
          console.log('[WA-GATEWAY] Sesi logout dari WhatsApp (401). Menghapus data sesi lama...');
          this.clearSession();
          // Restart socket untuk memunculkan QR baru
          this.init();
        } else if (isRestartRequired) {
          console.log('[WA-GATEWAY] Restart required oleh server WhatsApp (515). Reconnecting instan...');
          this.init();
        } else {
          // Reconnect otomatis dengan exponential backoff
          const delay = Math.min(3000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
          this.reconnectAttempts++;
          console.log(`[WA-GATEWAY] Mencoba menghubungkan kembali dalam ${(delay / 1000).toFixed(1)} detik (Percobaan #${this.reconnectAttempts})...`);
          setTimeout(() => this.init(), delay);
        }
      }
    });
  }

  /**
   * Normalisasi nomor telepon format Indonesia ke format internasional
   * Contoh: '08123456789' -> '628123456789'
   */
  cleanPhoneNumber(phone) {
    if (!phone) return null;
    let clean = String(phone).replace(/\D/g, '');

    if (clean.startsWith('0')) {
      clean = '62' + clean.slice(1);
    } else if (clean.startsWith('8')) {
      clean = '62' + clean;
    }

    if (clean.length < 10 || clean.length > 15) {
      return null;
    }

    return clean;
  }

  /**
   * Normalisasi nomor telepon ke format WhatsApp JID
   * Contoh: '08123456789' -> '628123456789@s.whatsapp.net'
   */
  normalizeJid(phone) {
    const clean = this.cleanPhoneNumber(phone);
    if (!clean) return null;
    return jidNormalizedUser(`${clean}@s.whatsapp.net`);
  }

  /**
   * Pengecekan apakah suatu nomor terdaftar di WhatsApp
   * Sesuai panduan docs_baileys/coreconcepts_jid.md & migration_v7.md
   */
  async checkNumber(phone) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp Gateway belum terhubung.');
    }

    const clean = this.cleanPhoneNumber(phone);
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

  /**
   * Request 8-digit Pairing Code untuk menautkan tanpa scan kamera
   * Sesuai panduan docs_baileys/auth_pairingcode.md
   */
  async requestPairingCode(phone) {
    if (!this.sock) {
      throw new Error('Klien WhatsApp belum diinisialisasi.');
    }

    if (this.status === 'connected') {
      throw new Error('WhatsApp sudah dalam status terhubung.');
    }

    const clean = this.cleanPhoneNumber(phone);
    if (!clean) {
      throw new Error(`Nomor telepon '${phone}' tidak valid untuk format WhatsApp Indonesia.`);
    }

    try {
      const code = await this.sock.requestPairingCode(clean);
      return {
        success: true,
        phone: clean,
        pairing_code: code,
        instruction: 'Buka WhatsApp di HP ➔ Perangkat Tertaut ➔ Tautkan dengan nomor telepon saja ➔ Masukkan kode 8 digit ini.',
      };
    } catch (error) {
      console.error('[WA-GATEWAY] Gagal meminta Pairing Code:', error.message);
      throw error;
    }
  }

  /**
   * Kirim pesan teks WhatsApp
   */
  async sendMessage(phone, message) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp Gateway belum terhubung. Silakan scan QR Code terlebih dahulu.');
    }

    const jid = this.normalizeJid(phone);
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

  /**
   * Logout dan bersihkan sesi di folder disk
   */
  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (e) {
      // Abaikan jika koneksi sudah terputus
    }
    this.clearSession();
    this.status = 'disconnected';
    this.user = null;
    this.qrRaw = null;
    this.qrDataUrl = null;
    // Inisialisasi ulang untuk QR baru
    setTimeout(() => this.init(), 1000);
  }

  clearSession() {
    try {
      if (fs.existsSync(this.sessionDir)) {
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }
    } catch (e) {
      console.error('[WA-GATEWAY] Gagal menghapus sesi:', e.message);
    }
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      user: this.user,
      qr_available: !!this.qrDataUrl,
    };
  }
}

export const waClient = new WhatsAppClient();
