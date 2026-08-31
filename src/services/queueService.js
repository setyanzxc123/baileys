import crypto from 'node:crypto';
import { waClient } from './baileysService.js';
import { config } from '../config/app.js';
import { logger } from '../utils/logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class QueueService {
  constructor() {
    this.jobs = new Map();
    this.queue = [];
    this.isProcessing = false;
  }

  generateJobId() {
    return `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  createBulkJob(recipients, options = {}) {
    const jobId = this.generateJobId();
    const delayMs = options.delayMs || config.bulk.defaultDelayMs;

    const job = {
      id: jobId,
      type: 'bulk_send',
      status: 'pending',
      total: recipients.length,
      processed: 0,
      success_count: 0,
      failed_count: 0,
      delay_ms: delayMs,
      recipients,
      results: [],
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    };

    this.jobs.set(jobId, job);
    this.queue.push(jobId);

    this.processQueue().catch((err) => {
      logger.error({ err }, '[WA-GATEWAY] Error saat memproses antrean job');
    });

    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const jobId = this.queue.shift();
      const job = this.jobs.get(jobId);
      if (!job) continue;

      job.status = 'in_progress';
      job.updated_at = new Date().toISOString();

      try {
        await this.executeBulkJob(job);
        job.status = 'completed';
      } catch (err) {
        job.status = 'failed';
        job.error = err.message || 'Gagal memproses job';
      } finally {
        job.updated_at = new Date().toISOString();
        job.completed_at = new Date().toISOString();
      }
    }

    this.isProcessing = false;
  }

  async executeBulkJob(job) {
    const recipients = job.recipients;

    for (let i = 0; i < recipients.length; i++) {
      const item = recipients[i];
      const phone = item.phone || item.no_wa;
      const message = item.message || item.text;

      try {
        if (!phone || !message) {
          job.results.push({ phone: phone || null, success: false, error: 'Nomor atau pesan kosong' });
          job.failed_count++;
        } else {
          const res = await waClient.sendMessage(phone, message);
          job.results.push({ phone: res.phone, success: true, messageId: res.messageId });
          job.success_count++;
        }
      } catch (err) {
        job.results.push({ phone: phone || null, success: false, error: err.message });
        job.failed_count++;
      }

      job.processed = i + 1;
      job.updated_at = new Date().toISOString();

      if (i < recipients.length - 1) {
        const jitter = job.delay_ms + Math.floor(Math.random() * 800);
        await sleep(jitter);
      }
    }
  }
}

export const queueService = new QueueService();
