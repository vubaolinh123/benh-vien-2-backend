import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app.js';
import { Appointment, Content, Post, User, Visit, Media, Homepage, Settings, connectDatabase } from '../src/db/models.js';
import { cleanupMedia, withMedia, importLegacyMedia, MEDIA_GRACE_MS } from '../src/lib/media.js';
import { invalidatePublicCache } from '../src/lib/cache.js';
import type { Config } from '../src/config.js';
import { restoreHomeContent } from '../src/restore-home.js';
import { setupHomeManagement } from '../src/setup-home.js';
import { defaultHomepage } from '../src/lib/homepage.js';

let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let uploads: string;
const origin = 'http://localhost:3000';
const password = 'Strong-test-password-2026!';
type Agent = ReturnType<typeof request.agent>;
const sessions = {} as Record<string, { agent: Agent; csrf: string; id: string }>;
before(async () => {
  mongo = await MongoMemoryServer.create(); uploads = await mkdtemp(path.join(os.tmpdir(), 'dai-an-api-test-'));
  await connectDatabase(mongo.getUri());
  const config: Config = { NODE_ENV: 'test', PORT: 4000, MONGODB_URI: mongo.getUri(), JWT_SECRET: 'test-secret-'.repeat(8), SITE_ORIGIN: origin, TRUST_PROXY: 0, UPLOAD_DIR: uploads };
  app = createApp(config);
  const passwordHash = await bcrypt.hash(password, 12);
  for (const role of ['administrator', 'communications', 'customer_service']) {
    const user = await User.create({ name: role, email: `${role}@example.test`, role, passwordHash });
    const agent = request.agent(app); const login = await agent.post('/api/auth/login').set('Origin', origin).send({ email: user.email, password }).expect(200);
    sessions[role] = { agent, csrf: login.body.csrf, id: String(user._id) };
  }
  await Content.create({ kind: 'service', slug: 'kham-tong-quat', name: 'Khám tổng quát', active: true });
}, { timeout: 180000 });
after(async () => { await mongoose.disconnect(); await mongo?.stop(); if (uploads) await rm(uploads, { recursive: true, force: true }); });
function staff(role: string) { const session = sessions[role]; return { session, post: (url: string) => session.agent.post(url).set('Origin', origin).set('X-CSRF-Token', session.csrf), put: (url: string) => session.agent.put(url).set('Origin', origin).set('X-CSRF-Token', session.csrf), patch: (url: string) => session.agent.patch(url).set('Origin', origin).set('X-CSRF-Token', session.csrf), del: (url: string) => session.agent.delete(url).set('Origin', origin).set('X-CSRF-Token', session.csrf) }; }
const appointment = () => ({ name: 'Khách hàng kiểm thử', phone: '0900000000', service: 'kham-tong-quat', date: new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }), session: 'morning', message: '', consent: true });

test('anonymous, wrong roles, CSRF and foreign origins cannot access protected operations', async () => {
  await request(app).get('/api/admin/users').expect(401);
  await sessions.communications.agent.get('/api/admin/appointments').expect(403);
  await sessions.customer_service.agent.get('/api/admin/posts').expect(403);
  await sessions.communications.agent.get('/api/admin/dashboard').expect(403);
  await sessions.administrator.agent.post('/api/admin/users').set('Origin', origin).send({}).expect(403);
  await staff('administrator').post('/api/admin/users').set('Origin', 'https://evil.example').send({}).expect(403);
  const result = await sessions.administrator.agent.get('/api/auth/session').expect(200);
  assert.match(result.headers['cache-control'], /no-store/); assert.equal(result.body.user.role, 'administrator');
});

test('article drafts stay private; published HTML is sanitized; CRUD permission is enforced', async () => {
  const editorial = staff('communications');
  const payload = { title: 'Bài viết kiểm thử chính thức', slug: 'kiem-thu-bai-viet', category: 'news', excerpt: 'Nội dung kiểm thử cho website bệnh viện.', body: '<p>Nội dung bài viết an toàn</p><script>alert(1)</script><img src="https://evil.example/tracker" onerror="alert(1)">', status: 'draft', image: '' };
  const created = await editorial.post('/api/admin/posts').send(payload).expect(201);
  assert.ok(!created.body.body.includes('<script')); assert.ok(!created.body.body.includes('evil.example'));
  await request(app).get(`/api/public/posts/${payload.slug}`).expect(404);
  await editorial.put(`/api/admin/posts/${created.body._id}`).send({ ...payload, status: 'published' }).expect(200);
  const published = await request(app).get(`/api/public/posts/${payload.slug}`).expect(200);
  assert.equal(published.body.title, payload.title);
  const home = await request(app).get('/api/public/home').expect(200); assert.ok(home.body.posts.some((item: { slug: string }) => item.slug === payload.slug));
  await editorial.del(`/api/admin/posts/${created.body._id}`).expect(200);
  await request(app).get(`/api/public/posts/${payload.slug}`).expect(404);
});

test('appointments persist once; statuses, filters and Excel export work', async () => {
  const key = randomUUID(); const data = appointment();
  const first = await request(app).post('/api/public/appointments').set('Origin', origin).set('X-Idempotency-Key', key).send(data).expect(201);
  const retry = await request(app).post('/api/public/appointments').set('Origin', origin).set('X-Idempotency-Key', key).send(data).expect(200);
  assert.equal(first.body.reference, retry.body.reference); assert.equal(await Appointment.countDocuments(), 1);
  const customer = staff('customer_service');
  const list = await customer.session.agent.get('/api/admin/appointments?q=0900000000&status=new').expect(200);
  assert.equal(list.body.total, 1);
  await customer.patch(`/api/admin/appointments/${list.body.items[0]._id}`).send({ status: 'confirmed', notes: 'Đã gọi xác nhận.' }).expect(200);
  const filtered = await customer.session.agent.get('/api/admin/appointments?status=confirmed&service=kham-tong-quat').expect(200); assert.equal(filtered.body.total, 1);
  const excel = await customer.session.agent.get('/api/admin/appointments/export?status=confirmed').buffer(true).parse((response, callback) => { const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => callback(null, Buffer.concat(chunks))); }).expect(200);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(excel.body); assert.equal(workbook.worksheets[0].getRow(2).getCell(3).value, '0900000000');
});

test('invalid and injected appointment payloads are rejected before persistence', async () => {
  const invalid = { ...appointment(), phone: { $ne: null } };
  await request(app).post('/api/public/appointments').set('Origin', origin).set('X-Idempotency-Key', randomUUID()).send(invalid).expect(400);
  await request(app).post('/api/public/appointments').set('Origin', origin).set('X-Idempotency-Key', randomUUID()).send({ ...appointment(), date: '2026-02-31', consent: false }).expect(400);
  const otherApp = createApp({ NODE_ENV: 'test', PORT: 4000, MONGODB_URI: mongo.getUri(), JWT_SECRET: 'test-secret-'.repeat(8), SITE_ORIGIN: origin, TRUST_PROXY: 0, UPLOAD_DIR: uploads });
  await request(otherApp).post('/api/public/appointments').set('Origin', origin).set('X-Idempotency-Key', randomUUID()).send({ ...appointment(), service: 'khong-ton-tai' }).expect(400);
});

test('accounts can be assigned roles and locked; locking revokes existing sessions', async () => {
  const admin = staff('administrator');
  const payload = { name: 'Nhân sự mới', email: 'new-staff@example.test', role: 'communications', active: true, password };
  const created = await admin.post('/api/admin/users').send(payload).expect(201);
  const agent = request.agent(app); await agent.post('/api/auth/login').set('Origin', origin).send({ email: payload.email, password }).expect(200);
  await admin.patch(`/api/admin/users/${created.body.id}`).send({ ...payload, active: false, password: '' }).expect(200);
  await agent.get('/api/admin/posts').expect(401);
  await admin.del(`/api/admin/users/${created.body.id}`).expect(200);
  await admin.del(`/api/admin/users/${sessions.administrator.id}`).expect(400);
});

test('password change revokes the JWT and logout ends the session', async () => {
  const hash = await bcrypt.hash(password, 12); await User.create({ name: 'Mật khẩu', email: 'password@example.test', passwordHash: hash, role: 'communications' });
  const agent = request.agent(app); const session = await agent.post('/api/auth/login').set('Origin', origin).send({ email: 'password@example.test', password }).expect(200);
  await agent.post('/api/auth/password').set('Origin', origin).set('X-CSRF-Token', session.body.csrf).send({ currentPassword: password, newPassword: 'Another-safe-password-2026!' }).expect(200);
  await agent.get('/api/auth/session').expect(401);
  const login = await agent.post('/api/auth/login').set('Origin', origin).send({ email: 'password@example.test', password: 'Another-safe-password-2026!' }).expect(200);
  await agent.post('/api/auth/logout').set('Origin', origin).set('X-CSRF-Token', login.body.csrf).send({}).expect(200);
  await agent.get('/api/auth/session').expect(401);
});

test('upload checks file bytes and serves converted WebP', async () => {
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#24b183' } }).png().toBuffer();
  const upload = await staff('communications').post('/api/admin/uploads').attach('image', image, { filename: 'image.png', contentType: 'image/png' }).expect(201);
  const media = await request(app).get(upload.body.url).expect(200); assert.match(media.headers['content-type'], /image\/webp/);
  await staff('communications').post('/api/admin/uploads').attach('image', Buffer.from('<script>alert(1)</script>'), { filename: 'fake.png', contentType: 'image/png' }).expect(400);
  await staff('customer_service').post('/api/admin/uploads').attach('image', image, { filename: 'image.png', contentType: 'image/png' }).expect(403);
});

test('feedback and visit deduplication feed the administrator dashboard', async () => {
  await request(app).post('/api/public/feedback').set('Origin', origin).send({ name: 'Khách hàng', phone: '0900000000', message: 'Nội dung góp ý để kiểm thử chức năng.', consent: true }).expect(201);
  const list = await sessions.customer_service.agent.get('/api/admin/feedback').expect(200); assert.equal(list.body.total, 1);
  await staff('customer_service').patch(`/api/admin/feedback/${list.body.items[0]._id}`).send({ status: 'resolved', notes: 'Đã tiếp nhận.' }).expect(200);
  for (let index = 0; index < 2; index++) await request(app).post('/api/public/visits').set('Origin', origin).set('User-Agent', 'Integration-test-browser').send({ path: '/' }).expect(204);
  assert.equal((await Visit.findOne({ path: '/' }).lean())?.count, 1);
  await request(app).post('/api/public/feedback').set('Origin', origin).send({ name: 'Người thứ hai', phone: '', message: 'Bãi giữ xe cần thêm biển chỉ dẫn rõ hơn.', consent: true }).expect(201);
  const customer = sessions.customer_service.agent;
  assert.equal((await customer.get('/api/admin/feedback?status=new').expect(200)).body.total, 1);
  assert.equal((await customer.get(`/api/admin/feedback?q=${encodeURIComponent('giữ xe')}`).expect(200)).body.items[0].name, 'Người thứ hai');
  assert.equal((await customer.get('/api/admin/feedback?q=0900000000&status=resolved').expect(200)).body.total, 1);
  assert.equal((await customer.get('/api/admin/feedback?dateTo=2000-01-01').expect(200)).body.total, 0);
  assert.equal((await customer.get('/api/admin/notifications').expect(200)).body.feedback, 1);
  await sessions.communications.agent.get('/api/admin/notifications').expect(403); await sessions.communications.agent.get('/api/admin/feedback/export').expect(403);
  const excel = await customer.get('/api/admin/feedback/export?status=new').buffer(true).parse((response, callback) => { const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => callback(null, Buffer.concat(chunks))); }).expect(200);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(excel.body); assert.equal(workbook.worksheets[0].rowCount, 2); assert.equal(workbook.worksheets[0].getRow(2).getCell(2).value, 'Người thứ hai');
  const stats = await sessions.administrator.agent.get('/api/admin/dashboard?days=7').expect(200); assert.equal(stats.body.appointments, 1); assert.equal(stats.body.feedback, 2); assert.equal(stats.body.pendingFeedback, 1); assert.equal(stats.body.dailyVisits[0].count, 1);
  invalidatePublicCache(); assert.equal(await Post.countDocuments(), 0);
});

test('homepage restoration publishes old CMS content once and preserves later admin changes', async () => {
  await Post.create({ slug: 'cong-dong', title: 'Nội dung do admin chỉnh sửa', excerpt: 'Nội dung được chỉnh sửa riêng trong admin.', body: '<p>Nội dung riêng</p>', category: 'news', status: 'draft' });
  assert.equal((await restoreHomeContent()).restored, true);
  assert.equal(await Content.countDocuments({ kind: 'banner', active: true }), 6);
  assert.equal(await Content.countDocuments({ kind: 'video', active: true }), 3);
  assert.equal((await Post.findOne({ slug: 'cong-dong' }).lean())?.status, 'draft');
  assert.equal((await Post.findOne({ slug: 'ho-hap' }).lean())?.status, 'published');
  await Content.updateOne({ kind: 'service', slug: 'san-phu-khoa' }, { $set: { name: 'Dịch vụ admin chỉnh sửa', active: false } });
  await Content.deleteOne({ kind: 'banner', slug: 'tre-em' });
  assert.equal((await restoreHomeContent()).restored, false);
  assert.equal((await Content.findOne({ kind: 'service', slug: 'san-phu-khoa' }).lean())?.name, 'Dịch vụ admin chỉnh sửa');
  assert.equal((await Content.findOne({ kind: 'service', slug: 'san-phu-khoa' }).lean())?.active, false);
  assert.equal(await Content.countDocuments({ kind: 'banner', slug: 'tre-em' }), 0);
  const result = await request(app).get('/api/public/home').expect(200);
  assert.ok(!result.body.content.some((item: { kind: string; slug: string }) => (item.kind === 'service' && item.slug === 'san-phu-khoa') || (item.kind === 'banner' && item.slug === 'tre-em')));
});

test('homepage configuration enforces permissions, validates links and reaches public data', async () => {
  await request(app).get('/api/admin/homepage').expect(401);
  await sessions.communications.agent.get('/api/admin/homepage').expect(403);
  await staff('customer_service').put('/api/admin/homepage').send(defaultHomepage).expect(403);
  const config = structuredClone(defaultHomepage);
  config.copy.servicesTitle = 'Dịch vụ do quản trị chỉnh'; config.sections.reverse(); config.sections[0].visible = false;
  config.navigation[0].label = 'Chuyên khoa Đại An'; config.teamMode = 'activities';
  await staff('administrator').put('/api/admin/homepage').send(config).expect(200);
  const home = await request(app).get('/api/public/home').expect(200);
  assert.equal(home.body.homepage.copy.servicesTitle, config.copy.servicesTitle);
  assert.deepEqual(home.body.homepage.sections, config.sections); assert.equal(home.body.homepage.teamMode, 'activities');
  await staff('administrator').put('/api/admin/homepage').send({...config,navigation:[{label:'Unsafe',href:'javascript:alert(1)'}]}).expect(400);
  await staff('administrator').put('/api/admin/homepage').send({...config,copy:{...config.copy,priceLink:'javascript:alert(1)'}}).expect(400);
  await staff('administrator').put('/api/admin/homepage').send({...config,sections:config.sections.map(()=>config.sections[0])}).expect(400);
});

test('homepage cards are editable and migration preserves edits and deletions', async () => {
  await setupHomeManagement();
  assert.equal((await Content.findOne({kind:'specialty',slug:'san-phu-khoa'}).lean())?.icon,'heart');
  assert.equal((await Content.findOne({kind:'specialty',slug:'nhi-khoa'}).lean())?.icon,'users');
  const item = await Content.findOne({kind:'promotion',slug:'ca-gia-dinh'}).lean(); assert.ok(item);
  const payload = {kind:'promotion',slug:item.slug,name:'Chăm sóc do quản trị chỉnh',summary:'Nội dung thẻ đã chỉnh sửa',image:item.image,body:'',active:true,order:9,placement:'specialties',action:'feedback',icon:'heart',buttonLabel:'Liên hệ ngay',eyebrow:'Đại An',targetSlug:'',link:''};
  await staff('administrator').put(`/api/admin/content/${item._id}`).send(payload).expect(200);
  let home = await request(app).get('/api/public/home').expect(200);
  const card = home.body.content.find((record:{_id:string})=>record._id===String(item._id));
  assert.equal(card.name,payload.name); assert.equal(card.placement,'specialties'); assert.equal(card.action,'feedback'); assert.equal(card.buttonLabel,payload.buttonLabel);
  await staff('administrator').put(`/api/admin/content/${item._id}`).send({...payload,active:false}).expect(200);
  home = await request(app).get('/api/public/home').expect(200); assert.ok(!home.body.content.some((record:{_id:string})=>record._id===String(item._id)));
  await Content.deleteOne({kind:'care_activity',slug:'tre-em'}); await setupHomeManagement();
  await Content.updateOne({kind:'specialty',slug:'nhi-khoa'},{$set:{icon:'calendar'}}); await setupHomeManagement();
  assert.equal((await Content.findOne({kind:'specialty',slug:'nhi-khoa'}).lean())?.icon,'calendar');
  assert.equal((await Content.findById(item._id).lean())?.name,payload.name);
  assert.equal((await Content.findById(item._id).lean())?.active,false);
  assert.equal(await Content.countDocuments({kind:'care_activity',slug:'tre-em'}),0);
});

async function mediaUpload() {
  const bytes=await sharp({create:{width:40,height:30,channels:3,background:'#158674'}}).png().toBuffer();
  return (await staff('communications').post('/api/admin/uploads').attach('image',bytes,{filename:'shared-photo.png',contentType:'image/png'}).expect(201)).body as {id:string;url:string};
}

test('blog formatting persists with URL-only images and rejects embedded binary content',async()=>{
  const asset=await mediaUpload();
  const payload={...mediaPost('formatted-blog',asset.url),body:`<h2 style="text-align:center;color:red">Tiêu đề bài blog</h2><p style="text-align:justify">Nội dung <a href="https://benhviendaian.vn/" target="_blank">Đại An</a></p><img src="${asset.url}" alt="Bệnh viện" data-align="right" data-size="50"><script>alert(1)</script>`};
  const result=await staff('communications').post('/api/admin/posts').send(payload).expect(201);
  assert.match(result.body.body,/text-align:center/);assert.match(result.body.body,/text-align:justify/);
  assert.match(result.body.body,/data-align="right"/);assert.match(result.body.body,/data-size="50"/);
  assert.match(result.body.body,/rel="noopener noreferrer"/);assert.ok(!/color:|<script/.test(result.body.body));
  for(const body of ['<p><img src="data:image/png;base64,aGVsbG8="></p>','<p><img src="blob:http://localhost/example"></p>','<p><a href="data:text/html;base64,aGVsbG8=">Link</a></p>','<p><a href="blob:http://localhost/example">Link</a></p>']) {
    await staff('communications').put(`/api/admin/posts/${result.body._id}`).send({...payload,body}).expect(400);
  }
  assert.equal((await Post.findById(result.body._id).lean())?.body,result.body.body);
});
test('blog text styles, highlights and tables persist while unsafe styles are stripped',async()=>{
  const body='<p><span style="color: #c0392b; font-family: Times New Roman, Times, serif; font-size: 18px">Chữ có màu</span> <mark style="background-color: #fff3a3; color: inherit">nổi bật</mark> H<sub>2</sub>O m<sup>2</sup></p><table><tbody><tr><th colspan="2" rowspan="1"><p>Tiêu đề</p></th></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table><p><span style="color: red; font-size: 200px; position: fixed; background-image: url(https://evil.example/x)">Xấu</span></p>';
  const result=await staff('communications').post('/api/admin/posts').send({title:'Bài viết định dạng nâng cao',slug:'dinh-dang-nang-cao',category:'news',excerpt:'Bài kiểm tra định dạng chữ và bảng.',body,image:'',status:'draft'}).expect(201);
  const saved:string=result.body.body;
  assert.match(saved,/color:\s*#c0392b/);assert.match(saved,/font-family:\s*Times New Roman, Times, serif/);assert.match(saved,/font-size:\s*18px/);
  assert.match(saved,/<mark style="background-color:\s*#fff3a3;\s*color:\s*inherit;?">/);assert.match(saved,/<sub>2<\/sub>/);assert.match(saved,/<sup>2<\/sup>/);
  assert.match(saved,/<th colspan="2" rowspan="1">/);assert.match(saved,/<td><p>B<\/p><\/td>/);
  assert.ok(!/color:\s*red|200px|position|background-image|evil\.example/.test(saved));
});
test('long Vietnamese articles above the public JSON limit can be saved from the CMS',async()=>{
  const body=`<p>${'Bệnh viện Đại An chăm sóc sức khỏe. '.repeat(6000)}</p>`;
  assert.ok(Buffer.byteLength(body)>128*1024&&body.length<300000);
  const result=await staff('communications').post('/api/admin/posts').send({title:'Bài viết dài kiểm thử',slug:'bai-viet-dai',category:'news',excerpt:'Bài kiểm tra giới hạn dung lượng nội dung.',body,image:'',status:'draft'}).expect(201);
  assert.equal(result.body.body.length,body.length);
  await staff('communications').post('/api/admin/posts').send({title:'Bài viết quá dài',slug:'bai-viet-qua-dai',category:'news',excerpt:'Bài kiểm tra giới hạn dung lượng nội dung.',body:`<p>${'a'.repeat(300000)}</p>`,image:'',status:'draft'}).expect(400);
});
const mediaPost=(slug:string,url:string)=>({title:'Bài viết có ảnh dùng chung',slug,category:'news',excerpt:'Bài kiểm tra quản lý vòng đời ảnh.',body:`<p>Nội dung bài viết <img src="${url}" alt="Ảnh trong bài"></p>`,image:url,status:'draft'});
test('media library protects shared draft/inline images and deletes files after last reference and grace period', async()=>{
  const asset=await mediaUpload();
  await sessions.customer_service.agent.get('/api/admin/media').expect(403);
  await staff('communications').del(`/api/admin/media/${asset.id}`).expect(403);
  const first=await staff('communications').post('/api/admin/posts').send(mediaPost('media-first',asset.url)).expect(201);
  const second=await staff('communications').post('/api/admin/posts').send({...mediaPost('media-second',asset.url),image:''}).expect(201);
  const list=await sessions.administrator.agent.get('/api/admin/media?usage=used&q=shared-photo').expect(200);
  assert.equal(list.body.items.find((item:{_id:string})=>item._id===asset.id).usage.length,2);
  await staff('administrator').del(`/api/admin/media/${asset.id}`).expect(409);
  await staff('communications').del(`/api/admin/posts/${first.body._id}`).expect(200);
  await Media.updateOne({_id:asset.id},{$set:{deleteAfter:new Date(0)}});
  await cleanupMedia(uploads); await request(app).get(asset.url).expect(200);
  await staff('communications').del(`/api/admin/posts/${second.body._id}`).expect(200);
  assert.ok((await Media.findById(asset.id).lean())!.deleteAfter!.getTime()>Date.now()+MEDIA_GRACE_MS-5000);
  await cleanupMedia(uploads);await request(app).get(asset.url).expect(200);
  await Media.updateOne({_id:asset.id},{$set:{deleteAfter:new Date(0)}});
  await cleanupMedia(uploads);assert.equal(await Media.findById(asset.id),null);await request(app).get(asset.url).expect(404);
  await staff('communications').post('/api/admin/posts').send(mediaPost('media-deleted-ref',asset.url)).expect(409);
});
test('CMS replacements schedule old media while homepage/settings/content references protect the file',async()=>{
  const asset=await mediaUpload();
  const content=await staff('administrator').post('/api/admin/content').send({kind:'gallery',slug:'media-gallery',name:'Ảnh thư viện kiểm thử',image:asset.url,active:false,order:0}).expect(201);
  await staff('administrator').put('/api/admin/homepage').send({...defaultHomepage,logo:asset.url}).expect(200);
  const settings={name:'Bệnh viện Đại An',phone:'0947907636',email:'test@example.test',address:'Địa chỉ kiểm thử',introduction:`<p>Giới thiệu <img src="${asset.url}"></p>`,workingHours:'Hằng ngày',privacy:'',facebook:'',tiktok:''};
  await staff('administrator').put('/api/admin/settings').send(settings).expect(200);
  await Media.updateOne({_id:asset.id},{$set:{deleteAfter:new Date(0)}});await cleanupMedia(uploads);await request(app).get(asset.url).expect(200);
  await staff('administrator').del(`/api/admin/content/${content.body._id}`).expect(200);
  await staff('administrator').put('/api/admin/homepage').send(defaultHomepage).expect(200);
  await staff('administrator').del(`/api/admin/media/${asset.id}`).expect(409);
  await staff('administrator').put('/api/admin/settings').send({...settings,introduction:'<p>Đã bỏ ảnh.</p>'}).expect(200);
  await Media.updateOne({_id:asset.id},{$set:{deleteAfter:new Date(0)}});await cleanupMedia(uploads);assert.equal(await Media.findById(asset.id),null);
});
test('cleanup respects in-flight saves, handles failed saves, and recovers expired delete claims',async()=>{
  const asset=await mediaUpload();await Media.updateOne({_id:asset.id},{$set:{deleteAfter:new Date(0)}});
  await withMedia({image:asset.url},async()=>{await cleanupMedia(uploads);assert.ok(await Media.findById(asset.id));});
  await assert.rejects(withMedia({image:asset.url},async()=>{throw new Error('Save rejected');}));
  assert.equal((await Media.findById(asset.id).lean())?.leases.length,0);
  await Media.updateOne({_id:asset.id},{$set:{state:'deleting',claimUntil:new Date(0)}});
  await cleanupMedia(uploads);assert.equal(await Media.findById(asset.id),null);
});
test('legacy upload import is idempotent and unused images can be selected again or queued for cleanup',async()=>{
  const asset=await mediaUpload();await Media.deleteOne({_id:asset.id});
  await importLegacyMedia(uploads);await importLegacyMedia(uploads);
  const filename=asset.url.split('/').at(-1)!;const record=await Media.findOne({filename}).lean();assert.ok(record);
  assert.equal(await Media.countDocuments({filename}),1);
  await staff('administrator').del(`/api/admin/media/${record._id}`).expect(200);
  await staff('communications').post(`/api/admin/media/${record._id}/select`).expect(200);
  assert.ok((await Media.findById(record._id).lean())!.deleteAfter!.getTime()>Date.now()+6*MEDIA_GRACE_MS);
  await Media.updateOne({_id:record._id},{$set:{deleteAfter:new Date(0)}});await cleanupMedia(uploads);await request(app).get(asset.url).expect(404);
});
