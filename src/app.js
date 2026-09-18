import express from 'express';
import { config } from './config/app.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler.js';
import routes from './routes/index.js';

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '64kb' }));
app.use(requestLogger);

app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
