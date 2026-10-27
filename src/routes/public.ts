import { resolveHomepage } from '../lib/homepage.js';
import { Router } from 'express';
import { randomBytes, createHmac } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { Appointment, Content, Feedback, Post, Settings, Visit, VisitDedup, Homepage } from '../db/models.js';
import { HttpError, pagination, slug, today, validate } from '../lib/http.js';
import { cachedHome } from '../lib/cache.js';
import { verifyCaptcha } from '../lib/captcha.js';
import type { Config } from '../config.js';

const appointmentSchema = z.object({
  name: z.string().trim().min(2).max(80), phone: z.string().regex(/^0\d{9}$/), service: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value && value >= today() && parsed.valueOf() <= Date.now() + 180 * 86400000;
  }, 'Ngày khám phải từ hôm nay đến 180 ngày tới'),
  session: z.enum(['morning', 'afternoon']), message: z.string().trim().max(1000).default(''),
  consent: z.literal(true), website: z.string().max(0).default(''), captcha: z.string().max(4096).optional(),
}).strict();
export function publicRoutes(config: Config) {
  const router = Router();
  router.get('/home', async (_request, response) => {
    const data = await cachedHome(async () => {
      const [content, posts, settings, homepage] = await Promise.all([Content.find({ active: true }).select('-body').sort({ order: 1, _id: 1 }).limit(1000).lean(), Post.find({ status: 'published' }).select('-body -authorId').sort({ publishedAt: -1 }).limit(30).lean(), Settings.findOne({ key: 'site' }).lean(), Homepage.findOne({ key: 'home' }).lean()]);
      return { content, posts, settings, homepage: resolveHomepage(homepage?.configuration) };
    });
    response.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
    response.json(data);
  });
  router.get('/posts', async (request, response) => {
    const data = validate(pagination.extend({ category: z.enum(['news', 'health', 'qa', '']).default(''), topic: z.union([slug, z.literal('')]).default('') }), request.query);
    const filter = { status: 'published' as const, ...(data.category ? { category: data.category } : {}), ...(data.topic ? { topic: data.topic } : {}) };
    const [items, total] = await Promise.all([Post.find(filter).select('-body -authorId').sort({ publishedAt: -1 }).skip((data.page - 1) * data.limit).limit(data.limit).lean(), Post.countDocuments(filter)]);
    response.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
    response.json({ items, total, page: data.page, limit: data.limit });
  });
  router.get('/posts/:slug', async (request, response) => {
    const item = await Post.findOne({ slug: validate(slug, request.params.slug), status: 'published' }).lean();
    if (!item) throw new HttpError(404, 'Không tìm thấy bài viết.');
    response.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'); response.json(item);
  });
  router.get('/content/:kind/:slug', async (request, response) => {
    const kind = validate(z.enum(['service', 'specialty', 'doctor', 'page', 'banner', 'gallery', 'video','promotion','care_activity','support_link','editorial_link']), request.params.kind);
    const item = await Content.findOne({ kind, slug: validate(slug, request.params.slug), active: true }).lean();
    if (!item) throw new HttpError(404, 'Không tìm thấy nội dung.');
    response.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'); response.json(item);
  });
  router.get('/sitemap', async (_request, response) => {
    const [content, posts] = await Promise.all([Content.find({ active: true }).select('kind slug updatedAt').limit(40000).lean(), Post.find({ status: 'published' }).select('category slug updatedAt').limit(40000).lean()]);
    response.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300'); response.json({ content, posts });
  });
  // Sized for many patients sharing one hospital or office network address.
  const formLimit = rateLimit({ windowMs: 15 * 60000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Bạn đã gửi nhiều yêu cầu. Vui lòng thử lại sau hoặc gọi hotline.' } });
  router.post('/appointments', formLimit, async (request, response) => {
    const data = validate(appointmentSchema, request.body);
    const requestId = validate(z.uuid(), request.get('X-Idempotency-Key'));
    const previous = await Appointment.findOne({ requestId }).select('reference phone name service date session').lean();
    if (previous) {
      if (previous.phone !== data.phone || previous.name !== data.name || previous.service !== data.service || previous.date !== data.date || previous.session !== data.session) throw new HttpError(409, 'Mã yêu cầu đã được sử dụng. Vui lòng gửi lại với mã mới.');
      response.json({ reference: previous.reference }); return;
    }
    await verifyCaptcha(config, data.captcha, request.ip);
    const service = await Content.findOne({ kind: 'service', slug: data.service, active: true }).select('_id').lean();
    if (!service) throw new HttpError(400, 'Vui lòng chọn dịch vụ đang tiếp nhận đăng ký.');
    const reference = `DA-${randomBytes(6).toString('hex').toUpperCase()}`;
    try {
      await Appointment.create({ reference, requestId, name: data.name, phone: data.phone, service: data.service, date: data.date, session: data.session, message: data.message, consentAt: new Date() });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await Appointment.findOne({ requestId }).lean();
      if (!existing || existing.phone !== data.phone || existing.name !== data.name || existing.service !== data.service || existing.date !== data.date || existing.session !== data.session) throw new HttpError(409, 'Yêu cầu đã tồn tại.');
      response.json({ reference: existing.reference }); return;
    }
    response.status(201).json({ reference });
  });
  router.post('/feedback', formLimit, async (request, response) => {
    const data = validate(z.object({ name: z.string().trim().max(80).default(''), phone: z.string().regex(/^0\d{9}$/).optional().or(z.literal('')), message: z.string().trim().min(10).max(2000), consent: z.literal(true), website: z.string().max(0).default(''), captcha: z.string().max(4096).optional() }).strict(), request.body);
    await verifyCaptcha(config, data.captcha, request.ip);
    await Feedback.create({ name: data.name, phone: data.phone, message: data.message });
    response.status(201).json({ success: true });
  });
  router.post('/visits', rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }), async (request, response) => {
    const data = validate(z.object({ path: z.string().max(160).regex(/^\/(?:[a-z0-9-]+\/)*$/) }).strict(), request.body);
    if (data.path.startsWith('/admin')) { response.sendStatus(204); return; }
    const day = today();
    const key = createHmac('sha256', config.JWT_SECRET).update(`${request.ip}|${request.get('User-Agent')?.slice(0, 200)}|${day}|${data.path}`).digest('hex');
    try { await VisitDedup.create({ key, expiresAt: new Date(Date.now() + 86400000) }); }
    catch (error) { if ((error as { code?: number }).code === 11000) { response.sendStatus(204); return; } throw error; }
    await Visit.updateOne({ day, path: data.path }, { $inc: { count: 1 }, $set: { expiresAt: new Date(Date.now() + 400 * 86400000) } }, { upsert: true });
    response.sendStatus(204);
  });
  return router;
}
