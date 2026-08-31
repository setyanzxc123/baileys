import pino from 'pino';
import { config } from '../config/app.js';

export const logger = pino({
  level: config.logLevel,
});
