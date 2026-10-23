import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import multer from 'multer';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { Appointment, Audit, Content, Feedback, Post, Session, Settings, User, Visit, Homepage, Media } from '../db/models.js';
import { homepageSchema, resolveHomepage } from '../lib/homepage.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { cleanHtml, escapeRegex, HttpError, imageUrl, objectId, pagination, slug, validate } from '../lib/http.js';
import { invalidatePublicCache } from '../lib/cache.js';
import { passwordSchema, loginIdentifierSchema } from './auth.js';
import { withMedia, scheduleMedia, mediaUsage, MEDIA_GRACE_MS, MEDIA_ORPHAN_MS } from '../lib/media.js';
import type { Config } from '../config.js';

const role = z.enum(['administrator', 'communications', 'customer_service']);
const postSchema = z.object({ slug, title: z.string().trim().min(5).max(200), category: z.enum(['news', 'health', 'qa']), excerpt: z.string().trim().min(10).max(500), body: z.string().min(10).max(300000).transform(cleanHtml), image: imageUrl, status: z.enum(['draft', 'published']) }).strict();
const contentSchema = z.object({
  kind: z.enum(['service', 'specialty', 'doctor', 'page', 'banner', 'gallery', 'video', 'promotion', 'care_activity', 'support_link', 'editorial_link']), slug,
  name: z.string().trim().min(2).max(200), summary: z.string().trim().max(600).default(''),
  body: z.string().max(300000).default('').transform(cleanHtml), image: imageUrl,
  qualification: z.string().max(300).default(''), specialty: z.string().max(200).default(''), schedule: z.string().max(500).default(''),
  link: z.string().max(300).refine(value => !value || value === 'https://38749.byt.vn/kcb/dang-ky-kham' || /^\/(?:[a-z0-9-]+\/)*$/.test(value) || /^\/assets\/(?:community|facilities)-demo\.mp4$/.test(value) || /^https:\/\/(?:www\.)?(?:youtube\.com\/|youtu\.be\/|facebook\.com\/)/.test(value), 'Liên kết nội bộ, video có sẵn, YouTube hoặc Facebook hợp lệ').optional(),
  active: z.boolean().default(false), order: z.number().int().min(0).max(10000).default(0),
  placement: z.enum(['','intro','specialties','featured','health','hospital']).default(''), action: z.enum(['link','booking','feedback','gallery']).default('link'), icon: z.enum(['','calendar','file','money','book','shield','message','phone','heart','cross','users','search']).default(''), buttonLabel: z.string().max(100).default(''), eyebrow: z.string().max(150).default(''), targetSlug: z.string().max(100).default(''),
}).strict().refine(data => data.kind !== 'banner' || Boolean(data.image), { message: 'Banner phải có ảnh.', path: ['image'] });
const userSchema = z.object({ name: z.string().trim().min(2).max(80), email: loginIdentifierSchema, role, active: z.boolean().default(true), password: passwordSchema.optional().or(z.literal('')) }).strict();
const settingsSchema = z.object({ name: z.string().min(2).max(150), phone: z.string().min(8).max(30), email: z.email(), address: z.string().min(5).max(300), introduction: z.string().max(300000).transform(cleanHtml), workingHours: z.string().max(1000), privacy: z.string().max(300000).transform(cleanHtml), facebook: z.url().startsWith('https://www.facebook.com/').or(z.literal('')), tiktok: z.url().startsWith('https://www.tiktok.com/').or(z.literal('')) }).strict();
const appointmentFilters = pagination.extend({ q: z.string().max(80).default(''), dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')), service: z.string().max(100).default(''), status: z.enum(['new', 'contacted', 'confirmed', 'cancelled', '']).default('') });

function appointmentQuery(request: Request) {
  const data = validate(appointmentFilters, request.query);
  const filter: Record<string, unknown> = {};
  if (data.q) filter.$or = ['name', 'phone', 'reference'].map(field => ({ [field]: { $regex: escapeRegex(data.q), $options: 'i' } }));
  if (data.status) filter.status = data.status;
  if (data.service) filter.service = data.service;
  if (data.dateFrom || data.dateTo) filter.date = { ...(data.dateFrom ? { $gte: data.dateFrom } : {}), ...(data.dateTo ? { $lte: data.dateTo } : {}) };
  return { filter, page: data.page, limit: data.limit };
}
const feedbackFilters = pagination.extend({ q: z.string().max(80).default(''), dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')), status: z.enum(['new', 'resolved', '']).default('') });
function feedbackQuery(request: Request) {
  const data = validate(feedbackFilters, request.query);
  const filter: Record<string, unknown> = {};
  if (data.q) filter.$or = ['name', 'phone', 'message'].map(field => ({ [field]: { $regex: escapeRegex(data.q), $options: 'i' } }));
  if (data.status) filter.status = data.status;
  // Feedback has no visit date, so the range applies to the Vietnam-local day it was received.
  if (data.dateFrom || data.dateTo) filter.createdAt = { ...(data.dateFrom ? { $gte: new Date(`${data.dateFrom}T00:00:00+07:00`) } : {}), ...(data.dateTo ? { $lte: new Date(`${data.dateTo}T23:59:59.999+07:00`) } : {}) };
  return { filter, page: data.page, limit: data.limit };
}
// Communications staff manage the photo and video library; every other content kind stays administrator-only.
function contentAccess(request: Request, ...kinds: (string | undefined | null)[]) {
  if (request.identity!.role !== 'administrator' && kinds.some(kind => kind && !['gallery', 'video', 'page'].includes(kind))) throw new HttpError(403, 'Bạn không có quyền thực hiện chức năng này.');
}
async function audit(request: Request, action: string, resourceId?: string) { await Audit.create({ userId: request.identity!.id, action, resourceId }); }

export function adminRoutes(config: Config) {
  const router = Router();
  router.use(authenticate(config));
  const administrator = authorize('administrator');
  const editorial = authorize('administrator', 'communications');
  const customerService = authorize('administrator', 'customer_service');

  router.get('/users', administrator, async (request, response) => {
    const { page, limit } = validate(pagination, request.query);
    const [items, total] = await Promise.all([User.find().select('name email role active createdAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments()]);
    response.json({ items, total, page, limit });
  });
  router.post('/users', administrator, async (request, response) => {
    const data = validate(userSchema, request.body);
    if (!data.password) throw new HttpError(400, 'Vui lòng nhập mật khẩu.');
    const user = await User.create({ name: data.name, email: data.email, role: data.role, active: data.active, passwordHash: await bcrypt.hash(data.password, 12) });
    await audit(request, 'user-create', String(user._id));
    response.status(201).json({ id: user._id });
  });
  router.patch('/users/:id', administrator, async (request, response) => {
    const id = validate(objectId, request.params.id);
    const data = validate(userSchema, request.body);
    if (id === request.identity!.id && (!data.active || data.role !== 'administrator')) throw new HttpError(400, 'Không thể khóa hoặc thay đổi quyền tài khoản của chính bạn.');
    const existing = await User.findById(id);
    if (!existing) throw new HttpError(404, 'Không tìm thấy tài khoản.');
    existing.name = data.name; existing.email = data.email; existing.role = data.role; existing.active = data.active; existing.tokenVersion += 1;
    if (data.password) existing.passwordHash = await bcrypt.hash(data.password, 12);
    await existing.save(); await Session.deleteMany({ userId: id });
    await audit(request, 'user-update', id);
    response.json({ success: true });
  });
  router.delete('/users/:id', administrator, async (request, response) => {
    const id = validate(objectId, request.params.id);
    if (id === request.identity!.id) throw new HttpError(400, 'Không thể xóa tài khoản của chính bạn.');
    if (!await User.findByIdAndDelete(id)) throw new HttpError(404, 'Không tìm thấy tài khoản.');
    await Session.deleteMany({ userId: id }); await audit(request, 'user-delete', id); response.json({ success: true });
  });

  router.get('/posts', editorial, async (request, response) => {
    const data = validate(pagination.extend({ category: z.enum(['news', 'health', 'qa', '']).default(''), status: z.enum(['draft', 'published', '']).default(''), q: z.string().max(80).default('') }), request.query);
    const filter = { ...(data.category ? { category: data.category } : {}), ...(data.status ? { status: data.status } : {}), ...(data.q ? { title: { $regex: escapeRegex(data.q), $options: 'i' } } : {}) };
    const [items, total] = await Promise.all([Post.find(filter).sort({ updatedAt: -1 }).skip((data.page - 1) * data.limit).limit(data.limit).maxTimeMS(5000).lean(), Post.countDocuments(filter).maxTimeMS(5000)]);
    response.json({ items, total, page: data.page, limit: data.limit });
  });
  router.post('/posts', editorial, async (request, response) => {
    const data = validate(postSchema, request.body);
    const post = await withMedia(data, () => Post.create({ ...data, authorId: request.identity!.id, ...(data.status === 'published' ? { publishedAt: new Date() } : {}) }));
    invalidatePublicCache(); await audit(request, 'post-create', String(post._id)); response.status(201).json(post);
  });
  router.put('/posts/:id', editorial, async (request, response) => {
    const id = validate(objectId, request.params.id); const data = validate(postSchema, request.body);
    const existing = await Post.findById(id);
    if (!existing) throw new HttpError(404, 'Không tìm thấy bài viết.');
    const previous = existing.toObject();
    Object.assign(existing, data);
    if (data.status === 'published' && !existing.publishedAt) existing.publishedAt = new Date();
    await withMedia(data, () => existing.save()); await scheduleMedia(previous); invalidatePublicCache(); await audit(request, 'post-update', id); response.json(existing);
  });
  router.delete('/posts/:id', editorial, async (request, response) => {
    const id = validate(objectId, request.params.id);
    const removed = await Post.findByIdAndDelete(id); if (!removed) throw new HttpError(404, 'Không tìm thấy bài viết.'); await scheduleMedia(removed.toObject());
    invalidatePublicCache(); await audit(request, 'post-delete', id); response.json({ success: true });
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 }, fileFilter: (_request, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) });
  router.post('/uploads', editorial, upload.single('image'), async (request, response) => {
    if (!request.file) throw new HttpError(400, 'Chọn ảnh JPG, PNG hoặc WebP, tối đa 20 MB.');
    let output: Buffer;
    try { output = await sharp(request.file.buffer, { limitInputPixels: 50000000 }).rotate().resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); }
    catch { throw new HttpError(400, 'Ảnh không hợp lệ hoặc quá lớn.'); }
    const filename = `${randomUUID()}.webp`;
    await mkdir(config.UPLOAD_DIR, { recursive: true }); await writeFile(path.join(config.UPLOAD_DIR, filename), output, { flag: 'wx' });
    const metadata = await sharp(output).metadata();
    let asset; try { asset = await Media.create({filename, originalName:request.file.originalname.slice(0,250), bytes:output.length, width:metadata.width, height:metadata.height, uploadedBy:request.identity!.id, deleteAfter:new Date(Date.now()+MEDIA_ORPHAN_MS)}); } catch(error) {await unlink(path.join(config.UPLOAD_DIR,filename)).catch(()=>{});throw error;}
    await audit(request, 'image-upload', filename); response.status(201).json({ id:asset._id, url: `/api/media/${filename}` });
  });


  router.get('/media', editorial, async (request,response)=>{
    const data=validate(pagination.extend({q:z.string().max(150).default(''),usage:z.enum(['','used','unused']).default('')}),request.query);
    const usage=await mediaUsage(); const used=[...usage.keys()];
    const filter={state:'ready' as const,...(data.q?{originalName:{$regex:escapeRegex(data.q),$options:'i'}}:{}),...(data.usage?{filename:{[data.usage==='used'?'$in':'$nin']:used}}:{})};
    const [items,total]=await Promise.all([Media.find(filter).select('-leases').sort({createdAt:-1}).skip((data.page-1)*data.limit).limit(data.limit).lean(),Media.countDocuments(filter)]);
    response.json({items:items.map(item=>({...item,url:'/api/media/'+item.filename,usage:usage.get(item.filename)||[]})),total,page:data.page,limit:data.limit,canManage:request.identity!.role==='administrator'});
  });
  router.post('/media/:id/select', editorial, async(request,response)=>{
    const asset=await Media.findOneAndUpdate({_id:validate(objectId,request.params.id),state:'ready'},{$set:{deleteAfter:new Date(Date.now()+MEDIA_ORPHAN_MS)}},{returnDocument:'after'});
    if(!asset)throw new HttpError(409,'Ảnh không còn khả dụng. Vui lòng chọn ảnh khác.');
    response.json({url:'/api/media/'+asset.filename});
  });
  router.delete('/media/:id', administrator, async(request,response)=>{
    const id=validate(objectId,request.params.id); const asset=await Media.findById(id).lean();
    if(!asset)throw new HttpError(404,'Không tìm thấy ảnh.');
    if((await mediaUsage()).has(asset.filename))throw new HttpError(409,'Ảnh vẫn đang được sử dụng. Hãy gỡ khỏi các nội dung liên quan trước.');
    const deleteAfter=new Date(Date.now()+MEDIA_GRACE_MS);
    await Media.updateOne({_id:id},{$set:{deleteAfter}});await audit(request,'image-schedule-delete',id);
    response.json({success:true,deleteAfter,message:'Đã lên lịch dọn ảnh sau 24 giờ. Ảnh được dùng lại sẽ tự động được giữ.'});
  });

  router.get('/content', editorial, async (request, response) => {
    const data = validate(pagination.extend({ kind: contentSchema.shape.kind, slug: slug.optional() }), request.query);
    contentAccess(request, data.kind);
    const filter = {kind:data.kind, ...(data.slug ? {slug:data.slug} : {})};
    const [items, total] = await Promise.all([Content.find(filter).sort({ order: 1, _id: 1 }).skip((data.page - 1) * data.limit).limit(data.limit).lean(), Content.countDocuments(filter)]);
    response.json({ items, total, page: data.page, limit: data.limit });
  });
  router.post('/content', editorial, async (request, response) => {
    const data = validate(contentSchema, request.body);
    contentAccess(request, data.kind);
    const item = await withMedia(data, () => Content.create(data));
    invalidatePublicCache(); await audit(request, 'content-create', String(item._id)); response.status(201).json(item);
  });
  router.put('/content/:id', editorial, async (request, response) => {
    const id = validate(objectId, request.params.id); const data = validate(contentSchema, request.body);
    const previous = await Content.findById(id).lean();
    contentAccess(request, data.kind, previous?.kind);
    const item = await withMedia(data, async () => Content.findByIdAndUpdate(id, { $set: data }, { returnDocument: 'after', runValidators: true }));
    await scheduleMedia(previous);
    if (!item) throw new HttpError(404, 'Không tìm thấy nội dung.');
    invalidatePublicCache(); await audit(request, 'content-update', id); response.json(item);
  });
  router.delete('/content/:id', editorial, async (request, response) => {
    const id = validate(objectId, request.params.id);
    contentAccess(request, (await Content.findById(id).select('kind').lean())?.kind);
    const removed = await Content.findByIdAndDelete(id); if (!removed) throw new HttpError(404, 'Không tìm thấy nội dung.'); await scheduleMedia(removed.toObject());
    invalidatePublicCache(); await audit(request, 'content-delete', id); response.json({ success: true });
  });
  router.get('/settings', administrator, async (_request, response) => response.json(await Settings.findOne({ key: 'site' }).lean()));
  router.get('/homepage', administrator, async (_request, response) => response.json(resolveHomepage((await Homepage.findOne({ key: 'home' }).lean())?.configuration)));
  router.put('/homepage', administrator, async (request, response) => {
    const configuration = validate(homepageSchema, request.body);
    const previous = await Homepage.findOne({key:'home'}).lean();
    await withMedia(configuration, async () => Homepage.updateOne({ key: 'home' }, { $set: { configuration } }, { upsert: true })); await scheduleMedia(previous);
    invalidatePublicCache(); await audit(request, 'homepage-update'); response.json(configuration);
  });
  router.put('/settings', administrator, async (request, response) => {
    const data = validate(settingsSchema, request.body);
    const previous = await Settings.findOne({key:'site'}).lean();
    const item = await withMedia(data, async () => Settings.findOneAndUpdate({ key: 'site' }, { $set: data }, { returnDocument: 'after', upsert: true, runValidators: true })); await scheduleMedia(previous);
    invalidatePublicCache(); await audit(request, 'settings-update'); response.json(item);
  });

  router.get('/appointments/export', customerService, async (request, response) => {
    const { filter } = appointmentQuery(request);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="dang-ky-kham.xlsx"');
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: response, useStyles: true, useSharedStrings: false });
    const sheet = workbook.addWorksheet('Đăng ký khám');
    sheet.columns = [
      { header: 'Mã đăng ký', key: 'reference', width: 24 }, { header: 'Họ tên', key: 'name', width: 28 },
      { header: 'Điện thoại', key: 'phone', width: 18 }, { header: 'Dịch vụ', key: 'service', width: 25 },
      { header: 'Ngày khám', key: 'date', width: 16 }, { header: 'Buổi', key: 'session', width: 16 },
      { header: 'Trạng thái', key: 'status', width: 18 }, { header: 'Ghi chú CSKH', key: 'notes', width: 50 },
    ];
    sheet.getRow(1).font = { bold: true };
    const cursor = Appointment.find(filter).sort({ date: -1 }).lean().cursor({ batchSize: 200 });
    try { for await (const row of cursor) { if (response.destroyed) break; sheet.addRow({ ...row, session: row.session === 'morning' ? 'Buổi sáng' : 'Buổi chiều' }).commit(); } }
    finally { await cursor.close(); }
    if (!response.destroyed) { await audit(request, 'appointment-export'); await workbook.commit(); }
  });
  router.get('/appointments', customerService, async (request, response) => {
    const { filter, page, limit } = appointmentQuery(request);
    const [items, total] = await Promise.all([Appointment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(5000).lean(), Appointment.countDocuments(filter).maxTimeMS(5000)]);
    response.json({ items, total, page, limit });
  });
  router.patch('/appointments/:id', customerService, async (request, response) => {
    const id = validate(objectId, request.params.id);
    const data = validate(z.object({ status: z.enum(['new', 'contacted', 'confirmed', 'cancelled']), notes: z.string().max(3000).default('') }).strict(), request.body);
    const item = await Appointment.findByIdAndUpdate(id, { $set: { ...data, updatedBy: request.identity!.id } }, { returnDocument: 'after', runValidators: true });
    if (!item) throw new HttpError(404, 'Không tìm thấy đăng ký.');
    await audit(request, 'appointment-update', id); response.json(item);
  });
  router.get('/notifications', customerService, async (_request, response) => {
    const [appointments, feedback] = await Promise.all([Appointment.countDocuments({ status: 'new' }), Feedback.countDocuments({ status: 'new' })]);
    response.json({ appointments, feedback });
  });
  router.get('/feedback/export', customerService, async (request, response) => {
    const { filter } = feedbackQuery(request);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="gop-y.xlsx"');
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: response, useStyles: true, useSharedStrings: false });
    const sheet = workbook.addWorksheet('Góp ý');
    sheet.columns = [
      { header: 'Ngày gửi', key: 'createdAt', width: 20 }, { header: 'Họ tên', key: 'name', width: 28 },
      { header: 'Điện thoại', key: 'phone', width: 18 }, { header: 'Nội dung', key: 'message', width: 70 },
      { header: 'Trạng thái', key: 'status', width: 16 }, { header: 'Ghi chú CSKH', key: 'notes', width: 50 },
    ];
    sheet.getRow(1).font = { bold: true };
    const cursor = Feedback.find(filter).sort({ createdAt: -1 }).lean().cursor({ batchSize: 200 });
    try { for await (const row of cursor) { if (response.destroyed) break; sheet.addRow({ ...row, createdAt: new Date((row as { createdAt?: Date }).createdAt ?? Date.now()).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), status: row.status === 'new' ? 'Chưa xử lý' : 'Đã xử lý' }).commit(); } }
    finally { await cursor.close(); }
    if (!response.destroyed) { await audit(request, 'feedback-export'); await workbook.commit(); }
  });
  router.get('/feedback', customerService, async (request, response) => {
    const { filter, page, limit } = feedbackQuery(request);
    const [items, total] = await Promise.all([Feedback.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).maxTimeMS(5000).lean(), Feedback.countDocuments(filter).maxTimeMS(5000)]);
    response.json({ items, total, page, limit });
  });
  router.patch('/feedback/:id', customerService, async (request, response) => {
    const id = validate(objectId, request.params.id);
    const data = validate(z.object({ status: z.enum(['new', 'resolved']), notes: z.string().max(3000).default('') }).strict(), request.body);
    const item = await Feedback.findByIdAndUpdate(id, { $set: data }, { returnDocument: 'after', runValidators: true });
    if (!item) throw new HttpError(404, 'Không tìm thấy phản hồi.');
    await audit(request, 'feedback-update', id); response.json(item);
  });
  router.get('/dashboard', administrator, async (request, response) => {
    const { days } = validate(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), request.query);
    const dateFrom = new Date(Date.now() - (days - 1) * 86400000);
    const dayFrom = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(dateFrom);
    const [appointments, publishedPosts, dailyVisits, topPages, appointmentStatuses, registrations, feedback, pendingFeedback] = await Promise.all([
      Appointment.countDocuments({ createdAt: { $gte: dateFrom } }), Post.countDocuments({ status: 'published' }),
      Visit.aggregate([{ $match: { day: { $gte: dayFrom } } }, { $group: { _id: '$day', count: { $sum: '$count' } } }, { $sort: { _id: 1 } }]),
      Visit.aggregate([{ $match: { day: { $gte: dayFrom } } }, { $group: { _id: '$path', count: { $sum: '$count' } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
      Appointment.aggregate([{ $match: { createdAt: { $gte: dateFrom } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Appointment.aggregate([{ $match: { createdAt: { $gte: dateFrom } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Ho_Chi_Minh' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Feedback.countDocuments({ createdAt: { $gte: dateFrom } }), Feedback.countDocuments({ status: 'new' }),
    ]);
    response.json({ appointments, feedback, pendingFeedback, publishedPosts, dailyVisits, topPages, appointmentStatuses, registrations, days });
  });
  return router;
}
