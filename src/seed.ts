import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { z } from 'zod';
import { readConfig, type Config } from './config.js';
import { connectDatabase, Content, Post, Settings, User } from './db/models.js';
import { passwordSchema } from './routes/auth.js';
import { cleanHtml } from './lib/http.js';
import { restoreHomeContent } from './restore-home.js';
import { setupHomeManagement } from './setup-home.js';

export async function seedDatabase(config: Config, email: string, password: string, name = 'Quản trị viên') {
  z.email().parse(email); passwordSchema.parse(password);
  await User.updateOne({ email: email.toLowerCase() }, { $setOnInsert: { name, role: 'administrator', active: true, passwordHash: await bcrypt.hash(password, 12) } }, { upsert: true });
  await Settings.updateOne({ key: 'site' }, { $setOnInsert: {
    name: 'Bệnh viện Đa khoa Đại An', phone: '0947 907 636', email: 'benhviendakhoadaian.vn@gmail.com', address: 'Quốc lộ 45, xã Thiệu Trung, tỉnh Thanh Hóa',
    introduction: '<p>Bệnh viện Đa khoa Đại An — Sáng y đức, giỏi y thuật.</p><p>Liên hệ bệnh viện để được tư vấn lịch khám và hướng dẫn trước khi đến.</p>',
    workingHours: 'Vui lòng gọi hotline để xác nhận lịch làm việc và lịch khám của từng chuyên khoa.',
    privacy: '<p>Khi gửi đăng ký khám, bạn đồng ý cung cấp họ tên, số điện thoại, dịch vụ và thời gian dự kiến để bộ phận chăm sóc khách hàng liên hệ xử lý yêu cầu. Thông tin được lưu trong hệ thống của bệnh viện và chỉ nhân sự được phân quyền tiếp nhận đăng ký được truy cập.</p><p>Không gửi kết quả xét nghiệm, bệnh án hoặc thông tin sức khỏe nhạy cảm qua biểu mẫu. Đăng ký trực tuyến là yêu cầu tiếp nhận; lịch khám chỉ được xác nhận sau khi bệnh viện liên hệ.</p><p>Thống kê truy cập chỉ ghi nhận số lượt theo ngày và trang. Hệ thống không lưu địa chỉ IP thô cho thống kê và không dùng thông tin đăng ký để quảng cáo.</p><p>Để yêu cầu chỉnh sửa hoặc xóa thông tin đã cung cấp, vui lòng liên hệ hotline 0947 907 636 hoặc email benhviendakhoadaian.vn@gmail.com.</p>',
    facebook: 'https://www.facebook.com/bvdkdaian/', tiktok: 'https://www.tiktok.com/@bvdk_dai_an',
  } }, { upsert: true });
  await Content.updateOne({ kind: 'banner', slug: 'dai-an' }, { $setOnInsert: { name: 'Chủ động bảo vệ sức khỏe, trọn vẹn niềm vui', image: '/assets/9d44f85881139d9f.png', active: true, order: 0 } }, { upsert: true });
  await Content.updateOne({ kind: 'service', slug: 'tu-van-dat-lich' }, { $setOnInsert: { name: 'Tư vấn đặt lịch khám', summary: 'Bộ phận chăm sóc khách hàng sẽ liên hệ hướng dẫn chọn chuyên khoa và lịch phù hợp.', body: '<p>Gửi yêu cầu tư vấn hoặc gọi hotline để được hướng dẫn trước khi đến khám.</p>', active: true, order: 0 } }, { upsert: true });
  for (const [index, [image, title]] of [ ['4c135fdb1e0c0e75.png', 'Hoạt động chẩn đoán hình ảnh'], ['b89bed8cfcf32aa1.png', 'Hoạt động lấy mẫu xét nghiệm'], ['55d1223a1ac3ed1d.png', 'Lắng nghe trong từng thăm khám'], ['adc8d1977f6d574e.png', 'Đồng hành cùng sức khỏe cộng đồng'], ['9f782df485306de5.jpg', 'Sẻ chia niềm vui cùng bệnh nhi'], ['98e18acf2b0b12e7.png', 'Không gian thăm khám tại Đại An'] ].entries()) await Content.updateOne({ kind: 'gallery', slug: `hoat-dong-${index + 1}` }, { $setOnInsert: { name: title, image: `/assets/${image}`, active: true, order: index } }, { upsert: true });
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed-data');
  const specialties = JSON.parse(await readFile(path.join(directory, 'specialties.json'), 'utf8')) as { name: string; desc: string; details: string; image?: string }[];
  const slugs = ['kham-tong-quat', 'san-phu-khoa', 'nhi-khoa', 'tai-mui-hong', 'chan-doan-hinh-anh', 'xet-nghiem', 'ngoai-khoa', 'tu-van-suc-khoe'];
  for (const [index, item] of specialties.entries()) {
    for (const kind of ['service', 'specialty'] as const) await Content.updateOne({ kind, slug: slugs[index] }, { $setOnInsert: { name: item.name, summary: item.desc, body: cleanHtml(`<p>${item.details.replaceAll('bản demo', 'website')}</p>`), image: item.image ? `/assets/${item.image}` : '', active: false, order: index + 1 } }, { upsert: true });
  }
  const posts = JSON.parse(await readFile(path.join(directory, 'posts.json'), 'utf8')) as { id: string; category: string; title: string; excerpt: string; image: string; body: string[]; url: string }[];
  for (const post of posts) await Post.updateOne({ slug: post.id }, { $setOnInsert: { title: post.title, category: post.category === 'health' ? 'health' : 'news', excerpt: post.excerpt, image: `/assets/${post.image}`, body: cleanHtml(post.body.map(text => `<p>${text}</p>`).join('') + `<p><a href="${post.url}">Nguồn bài viết trên fanpage</a></p>`), status: 'draft' } }, { upsert: true });
  await restoreHomeContent();
  await setupHomeManagement();
  console.log(`Initial content ready. Administrator: ${email}. Existing passwords and edited content were preserved.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = readConfig();
  const email = process.env.ADMIN_EMAIL; const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before seeding. No default credentials are created.');
  await connectDatabase(config.MONGODB_URI);
  try { await seedDatabase(config, email, password, process.env.ADMIN_NAME); } finally { await mongoose.disconnect(); }
}
