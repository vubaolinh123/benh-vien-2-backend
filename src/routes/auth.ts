import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { Session, User, Audit } from '../db/models.js';
import type { Config } from '../config.js';
import { authenticate, cookieName } from '../middleware/auth.js';
import { HttpError, validate } from '../lib/http.js';

export const passwordSchema = z.string().min(12, 'Mật khẩu tối thiểu 12 ký tự').max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Mật khẩu quá dài');
const loginSchema = z.object({ email: z.email().max(254).transform(value => value.trim().toLowerCase()), password: z.string().min(1).max(100) }).strict();
const dummyHash = bcrypt.hashSync('not-a-real-user-password', 12);

export function authRoutes(config: Config) {
  const router = Router();
  const cookieOptions = { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api', maxAge: 8 * 3600000 };
  router.use((_request, response, next) => { response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('CDN-Cache-Control', 'no-store'); next(); });
  router.post('/login', rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút.' } }), async (request, response) => {
    const data = validate(loginSchema, request.body);
    const user = await User.findOne({ email: data.email }).select('+passwordHash');
    const valid = await bcrypt.compare(data.password, user?.passwordHash ?? dummyHash);
    if (!user?.active || !valid || (user.lockedUntil && user.lockedUntil > new Date())) {
      if (user && !valid) {
        const failures = (user.lockedUntil && user.lockedUntil <= new Date() ? 0 : user.loginFailures) + 1;
        await User.updateOne({ _id: user._id }, { loginFailures: failures, ...(failures >= 5 ? { lockedUntil: new Date(Date.now() + 15 * 60000) } : {}) });
      }
      throw new HttpError(401, 'Email hoặc mật khẩu không đúng, hoặc tài khoản tạm thời bị khóa.');
    }
    await User.updateOne({ _id: user._id }, { loginFailures: 0, $unset: { lockedUntil: 1 } });
    const jti = randomBytes(24).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    await Session.create({ jti, userId: user._id, expiresAt: new Date(Date.now() + 8 * 3600000) });
    const token = jwt.sign({ version: user.tokenVersion, csrf }, config.JWT_SECRET, { algorithm: 'HS256', subject: String(user._id), jwtid: jti, expiresIn: '8h', audience: 'dai-an-admin', issuer: 'dai-an-api' });
    response.cookie(cookieName, token, cookieOptions);
    await Audit.create({ userId: user._id, action: 'login' });
    response.json({ user: { id: String(user._id), name: user.name, email: user.email, role: user.role }, csrf });
  });
  router.use(authenticate(config));
  router.get('/session', (request, response) => { const identity = request.identity!; response.json({ user: { id: identity.id, name: identity.name, email: identity.email, role: identity.role }, csrf: identity.csrf }); });
  router.post('/logout', async (request, response) => { await Session.deleteOne({ jti: request.identity!.jti }); response.clearCookie(cookieName, cookieOptions); response.json({ success: true }); });
  router.post('/password', async (request, response) => {
    const data = validate(z.object({ currentPassword: z.string().min(1).max(100), newPassword: passwordSchema }).strict(), request.body);
    const user = await User.findById(request.identity!.id).select('+passwordHash');
    if (!user || !await bcrypt.compare(data.currentPassword, user.passwordHash)) throw new HttpError(400, 'Mật khẩu hiện tại không đúng.');
    if (data.currentPassword === data.newPassword) throw new HttpError(400, 'Mật khẩu mới phải khác mật khẩu hiện tại.');
    user.passwordHash = await bcrypt.hash(data.newPassword, 12); user.tokenVersion += 1; await user.save();
    await Session.deleteMany({ userId: user._id });
    response.clearCookie(cookieName, cookieOptions);
    await Audit.create({ userId: user._id, action: 'change-password' });
    response.json({ success: true });
  });
  return router;
}
