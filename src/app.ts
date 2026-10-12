import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { rateLimit } from 'express-rate-limit';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';
import { originGuard } from './middleware/auth.js';
import { errors } from './lib/http.js';
import type { Config } from './config.js';

export function createApp(config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use('/api', (_request, response, next) => { response.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.get('/api/health', (_request, response) => response.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ status: mongoose.connection.readyState === 1 ? 'ok' : 'unavailable' }));
  app.use('/api/media', express.static(config.UPLOAD_DIR, { maxAge: '1y', immutable: true, dotfiles: 'deny', fallthrough: false, index: false }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 1000, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' } }));
  app.use('/api', (request, response, next) => { if (!['GET', 'HEAD'].includes(request.method)) response.setHeader('Cache-Control', 'no-store'); next(); });
  // Rich-text bodies from the CMS are far larger than public form payloads.
  app.use('/api/admin', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '128kb' }));
  app.use(cookieParser());
  app.use(originGuard(config));
  app.use('/api/auth', authRoutes(config));
  app.use('/api/public', publicRoutes(config));
  app.use('/api/admin', adminRoutes(config));
  app.use((_request, response) => response.status(404).json({ message: 'Không tìm thấy đường dẫn API.' }));
  app.use(errors);
  return app;
}
