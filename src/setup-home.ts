import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Content, Homepage, connectDatabase } from './db/models.js';
import { defaultHomepage, defaultMenuChildren } from './lib/homepage.js';
import { invalidatePublicCache } from './lib/cache.js';
import { readConfig } from './config.js';

export async function setupHomeManagement() {
  const migrations = mongoose.connection.collection<{ _id: string; completedAt: Date }>('content_migrations');
  const iconMigration = 'specialty-demo-icons-v1';
  if (!await migrations.findOne({ _id: iconMigration })) {
    const icons = {'kham-tong-quat':'cross','san-phu-khoa':'heart','nhi-khoa':'users','tai-mui-hong':'shield','chan-doan-hinh-anh':'file','xet-nghiem':'search','ngoai-khoa':'cross','tu-van-suc-khoe':'message','noi-khoa':'heart','mat':'search','rang-ham-mat':'shield','co-xuong-khop':'users'};
    for (const [slug, icon] of Object.entries(icons)) await Content.updateOne({kind:'specialty',slug,$or:[{icon:''},{icon:null},{icon:{$exists:false}}]}, {$set:{icon}});
    await migrations.updateOne({_id:iconMigration}, {$setOnInsert:{completedAt:new Date()}}, {upsert:true});
    invalidatePublicCache();
  }
  // Banners are image-only; remove every legacy banner without an image, preserving all image banners and their order.
  const textSlidesRemoval = 'banner-image-only-v2';
  if (!await migrations.findOne({ _id: textSlidesRemoval })) {
    await Content.deleteMany({ kind: 'banner', $or: [{ image: '' }, { image: null }, { image: { $exists: false } }] });
    await migrations.updateOne({ _id: textSlidesRemoval }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
    invalidatePublicCache();
  }
  // Every department and service in the main menu dropdowns needs a public page; staff fill in the details later.
  const menuPages = 'main-menu-pages-v1';
  if (!await migrations.findOne({ _id: menuPages })) {
    for (const [kind, href] of [['specialty', '/chuyen-khoa/'], ['service', '/dich-vu/']] as const) {
      for (const [order, { label, href: link }] of defaultMenuChildren[href].entries()) {
        const slug = link.split('/')[2];
        await Content.updateOne({ kind, slug }, { $setOnInsert: { kind, slug, name: label, summary: `Thông tin về ${label} tại Bệnh viện Đa khoa Đại An.`, body: `<p>Nội dung chi tiết về ${label} đang được cập nhật. Vui lòng gọi hotline hoặc đặt lịch để được tư vấn.</p>`, active: true, order: 100 + order } }, { upsert: true });
      }
    }
    await migrations.updateOne({ _id: menuPages }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
    invalidatePublicCache();
  }
  const key = 'manage-all-home-v1';
  if (await migrations.findOne({ _id: key })) return;
  await Homepage.updateOne({ key: 'home' }, { $setOnInsert: { configuration: defaultHomepage } }, { upsert: true });
  const records = [
    ...[
      ['ca-gia-dinh','Chăm sóc cả gia đình','55d1223a1ac3ed1d.png','intro','booking',''],
      ['ket-noi','Kết nối với Đại An','9f782df485306de5.jpg','intro','feedback',''],
      ['bhyt','An tâm cùng bảo hiểm y tế','b89bed8cfcf32aa1.png','intro','link','/huong-dan/insurance/'],
      ['cong-dong','Khám sức khỏe cộng đồng','adc8d1977f6d574e.png','specialties','link','/tin-tuc/cong-dong/'],
      ['chan-doan','Chẩn đoán hình ảnh','4c135fdb1e0c0e75.png','specialties','link','/chuyen-khoa/chan-doan-hinh-anh/'],
      ['tre-em','Chăm sóc sức khỏe trẻ em','9005f84045d8d7a6.png','specialties','link','/song-khoe/ho-hap/'],
    ].map(([slug,name,image,placement,action,link],order) => ({ kind: 'promotion', slug, name, image: `/assets/${image}`, placement, action, link, order, eyebrow: defaultHomepage.copy.promoEyebrow, buttonLabel: defaultHomepage.copy.promoButton })),
    ...[
      ['kham-tong-quat','Khám tổng quát','Lắng nghe, thăm khám và hướng dẫn người bệnh lựa chọn dịch vụ phù hợp.','55d1223a1ac3ed1d.png'],
      ['tre-em','Chăm sóc trẻ em','Đồng hành cùng ba mẹ trong từng bước chăm sóc sức khỏe cho bé.','adc8d1977f6d574e.png'],
      ['chan-doan','Chẩn đoán hình ảnh','Hướng dẫn người bệnh trong quá trình thực hiện chẩn đoán hình ảnh.','4c135fdb1e0c0e75.png'],
      ['xet-nghiem','Hoạt động xét nghiệm','Hỗ trợ người bệnh từ tiếp đón đến các bước lấy mẫu theo hướng dẫn.','b89bed8cfcf32aa1.png'],
      ['nguoi-benh','Chăm sóc người bệnh','Quan tâm, chia sẻ và đồng hành cùng người bệnh và gia đình.','9f782df485306de5.jpg'],
    ].map(([slug,name,summary,image],order) => ({ kind: 'care_activity', slug, name, summary, image: `/assets/${image}`, order, eyebrow: 'Đội ngũ Đại An', qualification: 'Hoạt động chăm sóc người bệnh' })),
    ...[
      ['dat-lich','Đặt lịch trực tuyến','Chủ động, thuận tiện','calendar','booking',''],
      ['ket-qua','Tra cứu kết quả','Thông tin khám, xét nghiệm','file','link','/hoi-dap/ket-qua-kham/'],
      ['bang-gia','Bảng giá dịch vụ','Thông tin minh bạch','money','link','/huong-dan/prices/'],
      ['huong-dan','Hướng dẫn khám bệnh','An tâm từ bước đầu','book','link','/huong-dan/guide/'],
      ['bhyt','Bảo hiểm y tế','Hỗ trợ thủ tục','shield','link','/huong-dan/insurance/'],
      ['gop-y','Góp ý – phản hồi','Lắng nghe để tốt hơn','message','feedback',''],
    ].map(([slug,name,summary,icon,action,link],order) => ({ kind: 'support_link', slug, name, summary, icon, action, link, order })),
    ...[
      ['featured-guide','featured','Hướng dẫn chuẩn bị trước khi đến khám','Thông tin hướng dẫn cho người bệnh và gia đình.','55d1223a1ac3ed1d.png','link','/huong-dan/guide/',''],
      ['featured-gallery','featured','Những khoảnh khắc sẻ chia tại Đại An','Khám phá thư viện ảnh hoạt động bệnh viện.','9f782df485306de5.jpg','gallery','','hoat-dong-5'],
      ['health-guide','health','Hướng dẫn chuẩn bị trước khi đến khám','Thông tin hướng dẫn cho người bệnh và gia đình.','55d1223a1ac3ed1d.png','link','/huong-dan/guide/',''],
      ['hospital-gallery','hospital','Những khoảnh khắc sẻ chia tại Đại An','Khám phá thư viện ảnh hoạt động bệnh viện.','9f782df485306de5.jpg','gallery','','hoat-dong-5'],
    ].map(([slug,placement,name,summary,image,action,link,targetSlug],order) => ({ kind: 'editorial_link', slug, placement, name, summary, image: `/assets/${image}`, action, link, targetSlug, order })),
  ];
  for (const record of records) await Content.updateOne({ kind: record.kind as 'promotion' | 'care_activity' | 'support_link' | 'editorial_link', slug: record.slug }, { $setOnInsert: { ...record, active: true } }, { upsert: true });
  await migrations.updateOne({ _id: key }, { $setOnInsert: { completedAt: new Date() } }, { upsert: true });
  invalidatePublicCache();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await connectDatabase(readConfig().MONGODB_URI);
  try { await setupHomeManagement(); console.log('Homepage CMS configured; existing edits were preserved.'); } finally { await mongoose.disconnect(); }
}
