import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDatabase, Content, Post, User } from '../src/db/models.js';
async function main() {
await connectDatabase(process.env.MONGODB_URI!);
await Content.updateOne({ kind: 'service', slug: 'kham-tong-quat' }, { $set: { active: true, body: '<p>Thông tin dịch vụ dùng trong môi trường kiểm thử.</p>' } });
await Content.updateOne({ kind: 'specialty', slug: 'kham-tong-quat' }, { $set: { active: true } });
await Post.updateOne({ slug: 'ho-hap' }, { $set: { category: 'health', status: 'published', publishedAt: new Date() } });
await Post.updateOne({ slug: 'cong-dong' }, { $set: { status: 'published', publishedAt: new Date() } });
await Post.updateOne({ slug: 'dat-lich-kham' }, { $setOnInsert: { title: 'Làm thế nào để đặt lịch khám?', excerpt: 'Bạn có thể gửi yêu cầu qua website hoặc gọi hotline.', body: '<p>Bộ phận chăm sóc khách hàng sẽ liên hệ để xác nhận lịch khám.</p>', category: 'qa', status: 'published', publishedAt: new Date() } }, { upsert: true });
await Content.create({ kind: 'doctor', slug: 'bac-si-kiem-thu', name: 'Bác sĩ kiểm thử', qualification: 'Hồ sơ chỉ dành cho kiểm thử', specialty: 'Khám tổng quát', summary: 'Hồ sơ kiểm tra giao diện, không dùng trong dữ liệu triển khai.', body: '<p>Chỉ xuất hiện trong database kiểm thử.</p>', image: '/assets/55d1223a1ac3ed1d.png', active: true });
await Content.create({ kind: 'banner', slug: 'banner-kiem-thu', name: 'Banner kiểm thử', image: '/assets/9d44f85881139d9f.png', active: true, order: 1 });
for (const role of ['communications', 'customer_service']) await User.create({ name: role, email: `${role}@example.test`, passwordHash: await bcrypt.hash('Local-test-password-2026!', 12), role });
await mongoose.disconnect();
}
void main();
