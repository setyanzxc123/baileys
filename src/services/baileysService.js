import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
  getBinaryNodeChild,
  getBinaryNodeChildren,
  isPnUser,
  isLidUser,
  generateMessageIDV2,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import QRCode from 'qrcode';
import { config } from '../config/app.js';
import { sessionService } from './sessionService.js';
import { logger } from '../utils/logger.js';
import { cleanPhoneNumber, normalizeJid } from '../utils/jidHelper.js';
import { isTcTokenExpired, TC_TOKEN_INDEX_KEY } from '../utils/tcTokenHelper.js';
import { createDeliveryGuard } from '../utils/deliveryGuard.js';
import { createSenderRateLimiter } from '../utils/senderRateLimiter.js';

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
    this.isInitializing = false;
    this.tcTokenState = null;
    this.deliveryGuard = createDeliveryGuard({ windowMs: config.circuitBreaker.hitWindowMs });
    this.senderLimit = createSenderRateLimiter({
      maxPerHour: config.senderLimits.maxPerHour,
      maxPerDay: config.senderLimits.maxPerDay,
    });
    this.pendingAcks = new Map();
  }

  handle463Signal(source) {
    if (!config.circuitBreaker.enabled) return;
    const state = this.deliveryGuard.registerHit();
    console.warn(
      `[WA-GATEWAY] Sinyal 463 dari ${source}. Hit dalam jendela: ${state.hits}. Kirim dijeda sampai ${new Date(state.openUntil).toLocaleTimeString()} (breaker anti-restriction).`
    );
  }

  assertSendAllowed() {
    if (this.deliveryGuard.isOpen()) {
      const retryAfterMs = this.deliveryGuard.retryAfterMs();
      const error = new Error(
        `Circuit breaker 463 aktif. Pengiriman dijeda ${Math.ceil(retryAfterMs / 1000)} detik untuk melindungi nomor dari restriction.`
      );
      error.code = 'WA_CIRCUIT_BREAKER_OPEN';
      error.statusCode = 429;
      error.retryAfterMs = retryAfterMs;
      throw error;
    }

    const limit = this.senderLimit.tryConsume();
    if (!limit.allowed) {
      const error = new Error(
        `Batas pengirim ${limit.tier === 'hour' ? 'per jam' : 'per hari'} tercapai. Coba lagi dalam ${Math.ceil(limit.retryAfterMs / 1000)} detik.`
      );
      error.code = 'WA_SENDER_LIMIT';
      error.statusCode = 429;
      error.retryAfterMs = limit.retryAfterMs;
      throw error;
    }
  }

  destroySocket(socket) {
    if (!socket) return;
    this.clearPendingAcks();
    try {
      socket.ev?.removeAllListeners?.();
      socket.end?.(undefined);
    } catch {
      // Ignore errors when closing an already closed socket
    }
  }

  waitForServerAck(messageId, timeoutMs = config.serverAck.timeoutMs) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const timer = setTimeout(() => {
        this.pendingAcks.delete(messageId);
        const error = new Error(
          `Batas waktu menunggu konfirmasi server WhatsApp (Server ACK) terlampaui (${timeoutMs}ms).`
        );
        error.code = 'WA_SERVER_ACK_TIMEOUT';
        error.statusCode = 504;
        error.messageId = messageId;
        reject(error);
      }, timeoutMs);

      this.pendingAcks.set(messageId, {
        resolve,
        reject,
        timer,
        startTime,
      });
    });
  }

  cancelPendingAck(messageId) {
    if (messageId && this.pendingAcks.has(messageId)) {
      const pending = this.pendingAcks.get(messageId);
      clearTimeout(pending.timer);
      this.pendingAcks.delete(messageId);
    }
  }

  clearPendingAcks(reason = 'Koneksi WhatsApp terputus sebelum konfirmasi server diterima.') {
    for (const [id, pending] of this.pendingAcks.entries()) {
      clearTimeout(pending.timer);
      const error = new Error(reason);
      error.code = 'WA_SOCKET_CLOSED';
      error.statusCode = 503;
      error.messageId = id;
      pending.reject(error);
    }
    this.pendingAcks.clear();
  }

  handleMessageAck(node) {
    const ackId = node?.attrs?.id;
    const errCode = node?.attrs?.error;

    if (errCode === '463') {
      this.handle463Signal(`ack ${node.attrs?.from || ''}`.trim());
    }

    if (ackId && this.pendingAcks.has(ackId)) {
      const pending = this.pendingAcks.get(ackId);
      this.pendingAcks.delete(ackId);
      clearTimeout(pending.timer);

      if (errCode) {
        const error = new Error(
          `Pesan ditolak oleh server WhatsApp dengan kode error ${errCode}.`
        );
        error.code = 'WA_SERVER_REJECTED';
        error.statusCode = 502;
        error.serverErrorCode = errCode;
        error.messageId = ackId;
        pending.reject(error);
      } else {
        pending.resolve({
          messageId: ackId,
          serverAck: true,
          ackElapsedMs: Date.now() - pending.startTime,
        });
      }
    }
  }

  cancelReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async init() {
    if (this.isInitializing) return;
    this.isInitializing = true;
    this.cancelReconnectTimer();

    sessionService.ensureDirectory();

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);

      console.log('[WA-GATEWAY] Menginisialisasi Baileys v7 Engine...');
      this.status = 'connecting';

      const socket = makeWASocket({
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

      this.sock = socket;
      this.sock.ev.on('creds.update', saveCreds);

      socket.ws?.on?.('CB:ack,class:message', (node) => {
        this.handleMessageAck(node);
      });

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
          const isReplaced = statusCode === DisconnectReason.connectionReplaced || statusCode === 440;
          const reasonText = (lastDisconnect?.error?.message || '').toLowerCase();
          const isTcTokenStreamError = statusCode === 463 || reasonText.includes('tct');

          this.status = 'disconnected';
          this.user = null;

          this.lastDisconnect = {
            at: new Date().toISOString(),
            code: statusCode ?? null,
            reason: lastDisconnect?.error?.message || 'Unknown',
          };

          console.warn(`[WA-GATEWAY] Koneksi terputus. Kode status: ${statusCode} (${lastDisconnect?.error?.message || 'Unknown'})`);

          this.destroySocket(socket);
          this.sock = null;

          if (isLoggedOut) {
            console.log('[WA-GATEWAY] Sesi logout dari WhatsApp (401). Menghapus data sesi lama...');
            sessionService.clearSession();
            this.cancelReconnectTimer();
            this.reconnectTimer = setTimeout(() => this.init(), 1000);
          } else if (isRestartRequired) {
            console.log('[WA-GATEWAY] Restart required oleh server WhatsApp (515). Reconnecting...');
            this.cancelReconnectTimer();
            this.reconnectTimer = setTimeout(() => this.init(), 500);
          } else if (isReplaced) {
            console.warn('[WA-GATEWAY] Koneksi digantikan oleh proses atau perangkat lain (conflict: replaced). Auto-reconnect dihentikan.');
            this.cancelReconnectTimer();
          } else if (isTcTokenStreamError) {
            console.warn('[WA-GATEWAY] Stream error 463/tct dari server WhatsApp. Reconnect terkontrol tanpa restart sesi...');
            this.handle463Signal('stream error');
            this.cancelReconnectTimer();
            this.reconnectTimer = setTimeout(() => this.init(), 2000);
          } else {
            this.cancelReconnectTimer();
            const delay = Math.min(3000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
            this.reconnectAttempts++;
            console.log(`[WA-GATEWAY] Mencoba menghubungkan kembali dalam ${(delay / 1000).toFixed(1)} detik (Percobaan #${this.reconnectAttempts})...`);
            this.reconnectTimer = setTimeout(() => this.init(), delay);
          }
        }
      });
    } catch (err) {
      console.error('[WA-GATEWAY] Gagal inisialisasi socket:', err.message);
      this.status = 'disconnected';
      this.cancelReconnectTimer();
      this.reconnectTimer = setTimeout(() => this.init(), 5000);
    } finally {
      this.isInitializing = false;
    }
  }

  async waitForConnection(maxWaitMs = 5000) {
    if (this.status === 'connected' && this.sock) {
      return true;
    }

    if (this.status !== 'connecting') {
      return false;
    }

    const start = Date.now();
    const interval = 200;

    while (Date.now() - start < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      if (this.status === 'connected' && this.sock) {
        return true;
      }
      if (this.status !== 'connecting') {
        return false;
      }
    }

    return false;
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

  async resolveTcStorageJid(sock, jid) {
    if (isLidUser(jid)) return jid;
    const getLIDForPN = sock.signalRepository?.lidMapping?.getLIDForPN?.bind(sock.signalRepository.lidMapping);
    if (!getLIDForPN) return jid;
    const lid = await getLIDForPN(jid);
    return lid || jid;
  }

  async resolveTcIssueJid(sock, jid) {
    const issueToLid = sock.serverProps?.lidTrustedTokenIssueToLid === true;
    const lidMapping = sock.signalRepository?.lidMapping;
    const getLIDForPN = lidMapping?.getLIDForPN?.bind(lidMapping);
    const getPNForLID = lidMapping?.getPNForLID?.bind(lidMapping);

    if (issueToLid) {
      if (isLidUser(jid)) return jid;
      if (!getLIDForPN) return jid;
      return (await getLIDForPN(jid)) || jid;
    }
    if (!isLidUser(jid)) return jid;
    if (!getPNForLID) return jid;
    return (await getPNForLID(jid)) || jid;
  }

  async appendTcTokenIndex(keys, storageJid) {
    try {
      const indexData = await keys.get('tctoken', [TC_TOKEN_INDEX_KEY]);
      const rawEntry = indexData?.[TC_TOKEN_INDEX_KEY];
      let jids = [];
      if (rawEntry?.token?.length) {
        try {
          jids = JSON.parse(Buffer.from(rawEntry.token).toString());
        } catch {
          jids = [];
        }
        if (!Array.isArray(jids)) jids = [];
      }
      if (!jids.includes(storageJid)) jids.push(storageJid);
      await keys.set({
        tctoken: {
          [TC_TOKEN_INDEX_KEY]: { token: Buffer.from(JSON.stringify(jids)) },
        },
      });
    } catch {
      // Index maintenance is best effort; token entry already stored
    }
  }

  async ensurePrivacyToken(jid) {
    const sock = this.sock;
    if (!sock?.authState?.keys || !sock?.issuePrivacyTokens) return 'unavailable';
    if (!isPnUser(jid) && !isLidUser(jid)) return 'skipped';

    try {
      const keys = sock.authState.keys;
      const storageJid = await this.resolveTcStorageJid(sock, jid);

      const tokenData = await keys.get('tctoken', [storageJid]);
      const entry = tokenData?.[storageJid];
      if (entry?.token?.length && !isTcTokenExpired(entry.timestamp)) {
        return 'fresh';
      }

      const issueJid = await this.resolveTcIssueJid(sock, jid);
      const issuedAt = Math.floor(Date.now() / 1000);
      const result = await sock.issuePrivacyTokens([issueJid], issuedAt);

      const tokensNode = getBinaryNodeChild(result, 'tokens');
      const tokenNodes = tokensNode ? getBinaryNodeChildren(tokensNode, 'token') : [];
      const issued = tokenNodes.find(
        (n) => n.attrs?.type === 'trusted_contact' && n.content instanceof Uint8Array
      );

      if (!issued) {
        return 'declined';
      }

      await keys.set({
        tctoken: {
          [storageJid]: {
            ...entry,
            token: Buffer.from(issued.content),
            timestamp: String(issued.attrs?.t || issuedAt),
            senderTimestamp: issuedAt,
          },
        },
      });
      await this.appendTcTokenIndex(keys, storageJid);

      console.log(`[WA-GATEWAY] Privacy token (tctoken) diterbitkan untuk ${storageJid}`);
      return 'issued';
    } catch (error) {
      console.warn(`[WA-GATEWAY] Pre-issue privacy token gagal untuk ${jid}: ${error.message}`);
      return 'failed';
    }
  }

  async prepareRecipient(target) {
    let targetJid = normalizeJid(target);
    if (!targetJid) {
      const error = new Error(`Nomor tujuan '${target}' tidak valid. Gunakan nomor pribadi WhatsApp (mis. 0812xxx atau 62812xxx).`);
      error.code = 'WA_INVALID_TARGET';
      error.statusCode = 422;
      throw error;
    }

    try {
      const clean = cleanPhoneNumber(target);
      if (clean && this.sock?.onWhatsApp) {
        const results = await this.sock.onWhatsApp(clean);
        const match = Array.isArray(results) && results.length > 0 ? results[0] : null;
        if (match?.exists && match?.jid) {
          targetJid = match.jid;
        } else {
          const error = new Error(`Nomor '${clean}' tidak terdaftar di WhatsApp. Pengiriman dihentikan untuk melindungi reputasi akun pengirim.`);
          error.code = 'WA_NUMBER_NOT_REGISTERED';
          error.statusCode = 422;
          throw error;
        }
      }
    } catch (error) {
      if (error?.code === 'WA_NUMBER_NOT_REGISTERED') throw error;
      // Fallback ke targetJid awal jika query onWhatsApp gagal
    }

    try {
      if (this.sock?.sendPresenceUpdate) {
        await this.sock.sendPresenceUpdate('composing', targetJid);
        await new Promise((resolve) => setTimeout(resolve, 800));
        await this.sock.sendPresenceUpdate('paused', targetJid);
      }
    } catch {
      // Abaikan kegagalan presence update
    }

    this.tcTokenState = await this.ensurePrivacyToken(targetJid);

    return targetJid;
  }

  async sendMessage(phone, message, options = {}) {
    this.assertSendAllowed();
    const isConnected = await this.waitForConnection(5000);
    if (!isConnected || !this.sock) {
      throw new Error('WhatsApp Gateway belum terhubung. Silakan scan QR Code terlebih dahulu.');
    }

    if (!message || typeof message !== 'string' || message.trim() === '') {
      throw new Error('Pesan teks tidak boleh kosong.');
    }

    const jid = await this.prepareRecipient(phone);
    const waitForAck = options.waitForAck !== undefined ? Boolean(options.waitForAck) : config.serverAck.enabled;
    const timeoutMs = options.ackTimeoutMs ? Number(options.ackTimeoutMs) : config.serverAck.timeoutMs;
    const messageId = options.messageId || generateMessageIDV2(this.sock.user?.id);

    let ackPromise = null;
    if (waitForAck) {
      ackPromise = this.waitForServerAck(messageId, timeoutMs);
    }

    try {
      const response = await this.sock.sendMessage(
        jid,
        { text: message.trim() },
        { ...options, messageId }
      );

      let ackResult = null;
      if (ackPromise) {
        ackResult = await ackPromise;
      }

      return {
        success: true,
        messageId: response?.key?.id || messageId,
        phone: jid.split('@')[0],
        timestamp: response?.messageTimestamp || Math.floor(Date.now() / 1000),
        server_ack: ackResult ? true : undefined,
        ack_elapsed_ms: ackResult?.ackElapsedMs,
      };
    } catch (error) {
      this.cancelPendingAck(messageId);
      console.error(`[WA-GATEWAY] Gagal kirim pesan ke ${phone}:`, error.message);
      throw error;
    }
  }

  async restart() {
    this.cancelReconnectTimer();
    const socket = this.sock;
    this.sock = null;
    this.destroySocket(socket);

    this.status = 'disconnected';
    this.qrRaw = null;
    this.qrDataUrl = null;
    this.reconnectAttempts = 0;

    await this.init();
    return this.getStatus();
  }

  async logout() {
    this.cancelReconnectTimer();
    const socket = this.sock;
    this.sock = null;

    try {
      if (socket) {
        await socket.logout();
      }
    } catch {
      // Connection already closed
    }

    this.destroySocket(socket);
    sessionService.clearSession();

    this.status = 'disconnected';
    this.user = null;
    this.qrRaw = null;
    this.qrDataUrl = null;

    this.reconnectTimer = setTimeout(() => this.init(), 1000);
  }

  shutdown() {
    this.cancelReconnectTimer();
    const socket = this.sock;
    this.sock = null;
    this.status = 'disconnected';
    this.destroySocket(socket);

    console.log('[WA-GATEWAY] Koneksi WhatsApp ditutup tanpa logout.');
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      user: this.user,
      qr_available: !!this.qrDataUrl,
      last_disconnect: this.lastDisconnect || null,
      circuit_breaker: this.deliveryGuard.snapshot(),
      sender_limit: this.senderLimit.snapshot(),
      server_ack: {
        enabled: config.serverAck.enabled,
        timeout_ms: config.serverAck.timeoutMs,
        pending_acks: this.pendingAcks.size,
      },
    };
  }
}

export const waClient = new BaileysService();
