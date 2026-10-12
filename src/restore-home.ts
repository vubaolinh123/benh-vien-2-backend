import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Content, Post, Settings, connectDatabase } from './db/models.js';
import { readConfig } from './config.js';
import { cleanHtml } from './lib/http.js';
import { invalidatePublicCache } from './lib/cache.js';

const banners = [
  ['cong-dong', 'Gửi trọn niềm tin. Nhận lại sự tận tâm.', 'Đồng hành cùng địa phương, chung tay chăm sóc sức khỏe cộng đồng.', 'adc8d1977f6d574e.png', '/tin-tuc/cong-dong/'],
  ['gia-dinh', 'Khỏe mạnh hôm nay. An tâm mỗi ngày.', 'Dành thời gian cho sức khỏe của bạn và những người thân yêu. Đại An đồng hành từ những bước thăm khám đầu tiên.', '55d1223a1ac3ed1d.png', ''],
  ['chan-doan', 'Thấu hiểu sức khỏe. Chăm sóc tận tình.', 'Tìm hiểu hoạt động chẩn đoán hình ảnh và hướng dẫn chuẩn bị trước khi đến khám tại Đại An.', '4c135fdb1e0c0e75.png', '/chuyen-khoa/chan-doan-hinh-anh/'],
  ['tre-em', 'Chăm sóc bé yêu. Trao gửi an tâm.', 'Khám phá thông tin test nhanh hô hấp 7 trong 1 được chia sẻ trên fanpage Bệnh viện Đa khoa Đại An.', '9005f84045d8d7a6.png', '/song-khoe/ho-hap/'],
  ['se-chia', 'Một chút sẻ chia. Thêm nhiều ấm áp.', 'Sự quan tâm không chỉ nằm trong từng thăm khám, mà còn trong những khoảnh khắc gần gũi với người bệnh.', '9f782df485306de5.jpg', '/lien-he/'],
];
const questions = [
  ['dat-lich-kham', 'Tôi có thể đặt lịch khám trước như thế nào?', 'Tôi muốn chủ động thời gian đến viện và biết lịch khám của chuyên khoa. Cần liên hệ qua kênh nào?', 'Bạn có thể gửi yêu cầu đặt lịch trên website, gọi hotline 0947 907 636 hoặc nhắn fanpage Đại An. Bộ phận chăm sóc khách hàng sẽ liên hệ xác nhận lịch khám.'],
  ['chuan-bi-kham', 'Đến khám lần đầu cần chuẩn bị những gì?', 'Tôi lần đầu đến Đại An. Tôi nên mang theo giấy tờ và hồ sơ nào để được hướng dẫn thuận tiện?', 'Bạn có thể chuẩn bị giấy tờ tùy thân, thông tin BHYT và hồ sơ khám trước đây nếu có. Liên hệ bệnh viện để được hướng dẫn riêng theo dịch vụ.'],
  ['lich-cuoi-tuan', 'Có thể đến khám vào cuối tuần không?', 'Gia đình tôi muốn sắp xếp đến khám vào thứ Bảy hoặc Chủ nhật. Làm thế nào để xác nhận lịch?', 'Fanpage thông báo bệnh viện làm việc tất cả các ngày trong tuần. Gọi hotline để xác nhận lịch chuyên khoa và thời gian phù hợp trước khi đến.'],
  ['chi-phi-kham', 'Tôi có thể tìm hiểu chi phí khám ở đâu?', 'Tôi muốn tham khảo thông tin chi phí trước khi lựa chọn dịch vụ và đặt lịch khám.', 'Vui lòng liên hệ hotline để được tư vấn chi phí phù hợp với dịch vụ. Bảng giá sẽ được cập nhật khi bệnh viện cung cấp thông tin chính thức.'],
  ['ket-qua-kham', 'Tôi có thể nhận kết quả khám như thế nào?', 'Tôi cần được hướng dẫn nhận kết quả khám và xét nghiệm sau khi đến viện.', 'Vui lòng liên hệ bộ phận tiếp đón hoặc hotline để được hướng dẫn nhận kết quả. Website chưa kết nối hệ thống tra cứu bệnh án.'],
  ['gop-y', 'Tôi muốn gửi góp ý về trải nghiệm khám bệnh', 'Tôi có ý kiến muốn chia sẻ cùng bệnh viện và mong nhận được phản hồi từ bộ phận hỗ trợ.', 'Bạn có thể sử dụng biểu mẫu góp ý trên website, gửi tin nhắn qua fanpage Đại An hoặc gọi hotline. Bộ phận chăm sóc khách hàng sẽ tiếp nhận phản hồi.'],
];

/** One-time restoration of old CMS defaults; later admin edits/hiding/deletions win. */
export async function restoreHomeContent() {
  const migrations = mongoose.connection.collection<{ _id: string; completedAt: Date }>('content_migrations');
  const key = 'restore-original-home-v1';
  if (await migrations.findOne({ _id: key })) return { restored: false };
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed-data');
  const specialties = JSON.parse(await readFile(path.join(directory, 'specialties.json'), 'utf8')) as { name: string; desc: string; details: string; image?: string; photoClass?: string }[];
  const slugs = ['kham-tong-quat', 'san-phu-khoa', 'nhi-khoa', 'tai-mui-hong', 'chan-doan-hinh-anh', 'xet-nghiem', 'ngoai-khoa', 'tu-van-suc-khoe'];
  for (const [index, item] of specialties.entries()) {
    const originalBody = cleanHtml(`<p>${item.details.replaceAll('bản demo', 'website')}</p>`);
    const image = `/assets/${item.image || 'design-reference.png'}`;
    for (const kind of ['service', 'specialty'] as const) {
      await Content.updateOne({ kind, slug: slugs[index] }, { $setOnInsert: { name: item.name, summary: item.desc, body: originalBody, image, active: true, order: index } }, { upsert: true });
      await Content.updateOne({ kind, slug: slugs[index], name: item.name, summary: item.desc, body: originalBody, active: false }, { $set: { active: true, order: index } });
      await Content.updateOne({ kind, slug: slugs[index], name: item.name, image: '' }, { $set: { image } });
    }
  }
  for (const [index, name] of ['Nội khoa', 'Mắt', 'Răng Hàm Mặt', 'Cơ xương khớp'].entries()) {
    const slug = ['noi-khoa', 'mat', 'rang-ham-mat', 'co-xuong-khop'][index];
    await Content.updateOne({ kind: 'specialty', slug }, { $setOnInsert: { name, summary: 'Liên hệ bệnh viện để xác nhận chuyên khoa và lịch khám.', body: '<p>Vui lòng gọi hotline để được hướng dẫn dịch vụ và lịch khám phù hợp.</p>', active: true, order: index + 8 } }, { upsert: true });
  }
  await Content.updateOne({ kind: 'banner', slug: 'dai-an' }, { $setOnInsert: { name: 'Chủ động bảo vệ sức khỏe, trọn vẹn niềm vui', image: '/assets/9d44f85881139d9f.png', active: true, order: 0 } }, { upsert: true });
  await Content.updateOne({ kind: 'service', slug: 'tu-van-dat-lich', name: 'Tư vấn đặt lịch khám', order: 0 }, { $set: { order: 100 } });
  for (const [index, [slug, name, summary, image, link]] of banners.entries()) await Content.updateOne({ kind: 'banner', slug }, { $setOnInsert: { name, summary, image: `/assets/${image}`, link, active: true, order: index + 1 } }, { upsert: true });
  const posts = JSON.parse(await readFile(path.join(directory, 'posts.json'), 'utf8')) as { id: string; category: string; title: string; excerpt: string; image: string; body: string[]; url: string }[];
  for (const post of posts) {
    const body = cleanHtml(post.body.map(text => `<p>${text}</p>`).join('') + `<p><a href="${post.url}">Nguồn bài viết trên fanpage</a></p>`);
    await Post.updateOne({ slug: post.id }, { $setOnInsert: { title: post.title, category: post.category === 'health' ? 'health' : 'news', excerpt: post.excerpt, image: `/assets/${post.image}`, body, status: 'published', publishedAt: new Date() } }, { upsert: true });
    await Post.updateOne({ slug: post.id, title: post.title, body, status: 'draft' }, { $set: { status: 'published', publishedAt: new Date() } });
  }
  for (const [slug, title, excerpt, answer] of questions) await Post.updateOne({ slug }, { $setOnInsert: { title, excerpt, body: cleanHtml(`<p>${answer}</p>`), category: 'qa', status: 'published', publishedAt: new Date() } }, { upsert: true });
  for (const [index, [slug, name, image, link]] of [
    ['dong-hanh-cong-dong', 'Đại An — Đồng hành cùng sức khỏe cộng đồng', 'adc8d1977f6d574e.png', '/assets/community-demo.mp4'],
    ['khong-gian-tham-kham', 'Một vòng không gian thăm khám', '4c135fdb1e0c0e75.png', '/assets/facilities-demo.mp4'],
    ['trung-thu', 'Trung thu này, Đại An có gì?', '9f782df485306de5.jpg', 'https://www.facebook.com/reel/1110638461414671/'],
  ].entries()) await Content.updateOne({ kind: 'video', slug }, { $setOnInsert: { name, image: `/assets/${image}`, link, summary: index < 2 ? 'Video trình chiếu ảnh hoạt động Đại An' : 'Xem video trên fanpage', active: true, order: index } }, { upsert: true });
  await Settings.updateOne({ key: 'site', workingHours: 'Vui lòng gọi hotline để xác nhận lịch làm việc và lịch khám của từng chuyên khoa.' }, { $set: { workingHours: 'Tất cả các ngày trong tuần. Vui lòng liên hệ trước để xác nhận lịch khám từng chuyên khoa.' } });
  await migrations.updateOne({ _id: key }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
  invalidatePublicCache();
  return { restored: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = readConfig();
  await connectDatabase(config.MONGODB_URI);
  try { console.log(await restoreHomeContent()); } finally { await mongoose.disconnect(); }
}
