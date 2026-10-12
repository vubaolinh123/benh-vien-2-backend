import type { RequestHandler } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { Session, User } from '../db/models.js';
import type { Config } from '../config.js';
import { HttpError } from '../lib/http.js';

export type Role = 'administrator' | 'communications' | 'customer_service';
export interface Identity { id: string; name: string; email: string; role: Role; csrf: string; jti: string }
declare module 'express-serve-static-core' { interface Request { identity?: Identity } }
export const cookieName = 'dai_an_session';
export function authenticate(config: Config): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('CDN-Cache-Control', 'no-store');
    try {
      const token = request.cookies?.[cookieName];
      if (!token) throw new HttpError(401, 'Vui lòng đăng nhập.');
      const claims = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'], audience: 'dai-an-admin', issuer: 'dai-an-api' }) as JwtPayload;
      const [user, session] = await Promise.all([User.findById(claims.sub).lean(), Session.findOne({ jti: claims.jti }).lean()]);
      if (!user?.active || user.tokenVersion !== claims.version || !session || session.expiresAt < new Date() || String(session.userId) !== String(user._id)) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn.');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.get('X-CSRF-Token') !== claims.csrf) throw new HttpError(403, 'Phiên xác thực không hợp lệ. Hãy đăng nhập lại.');
      request.identity = { id: String(user._id), name: user.name, email: user.email, role: user.role as Role, csrf: String(claims.csrf), jti: String(claims.jti) };
      next();
    } catch (error) { next(error instanceof HttpError ? error : new HttpError(401, 'Phiên đăng nhập không hợp lệ.')); }
  };
}
export function authorize(...roles: Role[]): RequestHandler {
  return (request, _response, next) => { if (!request.identity || !roles.includes(request.identity.role)) { next(new HttpError(403, 'Bạn không có quyền thực hiện chức năng này.')); return; } next(); };
}
export function originGuard(config: Config): RequestHandler {
  return (request, _response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { next(); return; }
    const origin = request.get('Origin');
    const allowed = new Set([new URL(config.SITE_ORIGIN).origin]);
    if (config.NODE_ENV !== 'production') { allowed.add('http://localhost:3000'); allowed.add('http://127.0.0.1:3000'); }
    if (!origin || !allowed.has(origin)) { next(new HttpError(403, 'Nguồn gửi yêu cầu không hợp lệ.')); return; }
    next();
  };
}
