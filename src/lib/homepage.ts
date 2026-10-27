import { z } from 'zod';
import { imageUrl } from './http.js';

export const defaultCopy = {
  bannerEyebrow: 'BỆNH VIỆN ĐA KHOA ĐẠI AN', bannerMore: 'Tìm hiểu thêm →', bannerBooking: 'Đặt lịch trực tuyến →', bannerEmpty: 'Đại An — Sáng y đức, giỏi y thuật', qaEmpty: 'Các câu hỏi thường gặp đang được cập nhật. Bạn có thể gọi hotline để được hướng dẫn.', qaAnswer: 'Xem câu trả lời', doctorProfile: 'Xem hồ sơ bác sĩ →', footerFeedback: 'Góp ý – phản hồi', footerStaff: 'Đăng nhập nhân sự', footerHotline: 'Hotline:',
  mainTitle: 'Bệnh viện Đa khoa Đại An — Sáng y đức, giỏi y thuật', seoTitle: 'Sáng y đức, giỏi y thuật', seoDescription: 'Bệnh viện Đa khoa Đại An — Sáng y đức, giỏi y thuật. Thông tin dịch vụ, chuyên khoa và hướng dẫn khám bệnh cho bạn và gia đình.',
  tagline: 'Sáng y đức – Giỏi y thuật', headerSearch: 'Tìm chuyên khoa, dịch vụ, thông tin sức khỏe…', headerConsult: 'Tư vấn & đặt lịch', headerBooking: 'Đặt lịch khám', stickyBooking: 'Đặt lịch ngay', utilityExplore: 'Khám phá Đại An', introMenuLabel: 'Giới thiệu',
  servicesTitle: 'DỊCH VỤ NỔI BẬT', servicesEyebrow: 'CHĂM SÓC TOÀN DIỆN CHO CẢ GIA ĐÌNH', servicesMore: 'Xem tất cả dịch vụ', servicesLess: 'Thu gọn',
  introMore: 'Tìm hiểu bệnh viện →', promoEyebrow: 'ĐẠI AN · ĐỒNG HÀNH CÙNG BẠN', promoButton: 'Tìm hiểu ngay →',
  teamTitle: 'ĐỘI NGŨ BÁC SĨ', teamEyebrow: 'ĐỘI NGŨ CHĂM SÓC ĐẠI AN', teamMore: 'Xem đội ngũ bác sĩ →', teamBooking: 'Đặt lịch khám', teamNote: 'Ảnh hoạt động thực tế từ fanpage Đại An. Hồ sơ bác sĩ, học vị và lịch khám sẽ được cập nhật từ bệnh viện.',
  specialtiesTitle: 'CHUYÊN KHOA', specialtiesMore: 'Xem tất cả chuyên khoa →', facilityTitle: 'Cơ sở vật chất & hoạt động thăm khám', facilityDescription: 'Cùng khám phá những hình ảnh thực tế trong hành trình chăm sóc người bệnh tại Đại An.', priceLabel: 'BẢNG GIÁ DỊCH VỤ', priceLink: '/huong-dan/prices/',
  imagesTitle: 'HÌNH ẢNH', imagesMore: 'Xem thêm hình ảnh ›', imagesLink: '/thu-vien/hinh-anh/', videosTitle: 'VIDEO', videosMore: 'Xem thêm video ↗', videosLink: 'https://www.facebook.com/bvdkdaian/videos/',
  qaTitle: 'HỎI ĐÁP CHUYÊN GIA', qaMore: 'Xem tất cả câu hỏi →', qaLink: '/hoi-dap/', qaCategory: 'Hướng dẫn người bệnh', qaCustomer: 'Khách hàng quan tâm', qaCaption: 'Hỏi đáp Đại An',
  newsTitle: 'TIN TỨC NỔI BẬT', newsMore: 'Xem tất cả tin tức →', newsLink: '/tin-tuc/', healthTitle: 'SỐNG KHỎE', healthMore: 'Xem bài viết sống khỏe →', healthLink: '/song-khoe/', hospitalTitle: 'TIN TỨC',
  supportTitle: 'ĐẠI AN LUÔN BÊN BẠN', supportDescription: 'Thông tin cần thiết cho một hành trình thăm khám thuận tiện.', bookingEyebrow: 'ĐỪNG ĐỂ SỨC KHỎE CHỜ ĐỢI', bookingTitle: 'Đặt lịch hôm nay, an tâm hơn mỗi ngày.', bookingButton: 'Đặt lịch khám ngay',
  footerSlogan: 'Sáng y đức – Giỏi y thuật\nĐồng hành vì sức khỏe cộng đồng.', footerConsult: 'Tư vấn & đặt khám:', footerPolicyLabel: 'Chính sách bảo mật', footerTermsLabel: 'Điều khoản sử dụng', footerSocialTitle: 'KẾT NỐI MẠNG XÃ HỘI', footerSocialNote: 'Theo dõi fanpage để cập nhật tin tức và hoạt động mới.', footerHoursTitle: 'THỜI GIAN LÀM VIỆC', footerSupportTitle: 'HỖ TRỢ KHÁCH HÀNG', footerInfoTitle: 'THÔNG TIN HỮU ÍCH', footerCopyright: 'BỆNH VIỆN ĐA KHOA ĐẠI AN', footerMapLabel: 'Xem đường đi ↗',
};
export const sectionKeys = ['banner','services','introduction','team','specialties','specialtyPromos','facilities','price','media','qa','news','health','support','booking'] as const;
export const websiteLink = z.string().max(300).refine(value => /^\/(?:[a-z0-9-]+\/)*(?:#[a-z0-9-]+)?$/.test(value) || /^https:\/\/[^\s]+$/.test(value), 'Nhập đường dẫn nội bộ hoặc URL HTTPS hợp lệ');
const menuLink = z.object({ label: z.string().trim().min(1).max(100), href: websiteLink }).strict();
const navigationLink = menuLink.extend({ children: z.array(menuLink).max(30).optional() }).strict();
const links = (prefix: string, labels: string[]) => labels.map(label => ({ label, href: `/${prefix}/${toMenuSlug(label)}/` }));
export function toMenuSlug(value: string) { return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
export const defaultMenuChildren: Record<string, { label: string; href: string }[]> = {
  '/chuyen-khoa/': links('chuyen-khoa', ['Khoa Kiểm soát nhiễm khuẩn','Khoa Gây mê hồi sức','Khoa Liên chuyên khoa','Khoa Ngoại tổng hợp','Khoa Chấn thương chỉnh hình','Khoa Sản','Khoa Nhi','Khoa Nội tổng hợp','Đơn nguyên Mắt','Khoa Vật lý trị liệu - Phục hồi chức năng','Khoa Y học cổ truyền','Khoa Khám bệnh','Khoa Chẩn đoán hình ảnh','Trung tâm tiêm chủng']),
  '/dich-vu/': links('dich-vu', ['Khám sức khỏe lái xe','Khám sức khỏe doanh nghiệp','Nội soi tiêu hóa không đau','Tán sỏi thận qua da','Tán sỏi thận ống mềm']),
  '/song-khoe/': links('song-khoe/chu-de', ['Bệnh lý nội khoa','Bệnh lý ngoại khoa','Sản khoa','Nhi khoa','Xét nghiệm','Bệnh lý về mắt','Bệnh tai mũi họng','Bệnh răng hàm mặt','Chẩn đoán hình ảnh','Vắc xin tiêm chủng']),
};
export const homepageSchema = z.object({
  copy: z.record(z.enum(Object.keys(defaultCopy) as [keyof typeof defaultCopy, ...Array<keyof typeof defaultCopy>]), z.string().max(2000)).superRefine((value, context) => {
    for (const [key, text] of Object.entries(value)) if (key.endsWith('Link') && !websiteLink.safeParse(text).success) context.addIssue({ code: 'custom', path: [key], message: 'Liên kết nội bộ hoặc HTTPS hợp lệ' });
  }),
  logo: imageUrl, logoAlt: z.string().min(1).max(150),
  sections: z.array(z.object({ key: z.enum(sectionKeys), visible: z.boolean() }).strict()).length(sectionKeys.length).refine(items => new Set(items.map(item => item.key)).size === sectionKeys.length, 'Mỗi khối trang chủ phải xuất hiện một lần'),
  navigation: z.array(navigationLink).max(12), introductionMenu: z.array(menuLink).max(15), footerSupport: z.array(menuLink).max(15), footerInfo: z.array(menuLink).max(15),
  teamMode: z.enum(['auto','doctors','activities']), galleryLeadSlug: z.string().max(100), galleryInitialSlug: z.string().max(100), galleryThumbnailSlugs: z.array(z.string().min(1).max(100)).max(3),
}).strict();
export const defaultHomepage = homepageSchema.parse({
  copy: defaultCopy, logo: '/assets/Dai_An-01.png', logoAlt: 'Bệnh viện Đa khoa Đại An', sections: sectionKeys.map(key => ({ key, visible: true })),
  navigation: [['Chuyên khoa','/chuyen-khoa/'],['Dịch vụ y tế','/dich-vu/'],['Đội ngũ bác sĩ','/doi-ngu/'],['Sống khỏe','/song-khoe/'],['Hỏi đáp','/hoi-dap/'],['Hỗ trợ khách hàng','/huong-dan/'],['Tin tức','/tin-tuc/'],['Liên hệ','/lien-he/']].map(([label,href]) => ({label,href,...(defaultMenuChildren[href] ? { children: defaultMenuChildren[href] } : {})})),
  introductionMenu: [['Sứ mệnh – tầm nhìn','/gioi-thieu/su-menh-tam-nhin/'],['Đội ngũ bác sĩ','/doi-ngu/'],['Hệ thống y tế Đại An','/gioi-thieu/he-thong-y-te/'],['Hoạt động Bệnh viện Đại An','/gioi-thieu/hoat-dong/'],['Văn hóa doanh nghiệp tại Bệnh viện Đại An','/gioi-thieu/van-hoa-doanh-nghiep/'],['Thư viện hình ảnh','/thu-vien/hinh-anh/'],['Thư viện video','/thu-vien/video/']].map(([label,href]) => ({label,href})),
  footerSupport: [['Hướng dẫn khám bệnh','/huong-dan/guide/'],['Bảo hiểm y tế','/huong-dan/insurance/'],['Bảng giá dịch vụ','/huong-dan/prices/'],['Tra cứu kết quả','/hoi-dap/ket-qua-kham/'],['Liên hệ','/lien-he/'],['Tin tức bệnh viện','/tin-tuc/']].map(([label,href]) => ({label,href})),
  footerInfo: [['Thư viện hình ảnh & video','/thu-vien/hinh-anh/'],['Tuyển dụng','/tin-tuc/tuyen-dung/'],['Giới thiệu Đại An','/gioi-thieu/']].map(([label,href]) => ({label,href})),
  teamMode: 'auto', galleryLeadSlug: 'hoat-dong-6', galleryInitialSlug: 'hoat-dong-5', galleryThumbnailSlugs: ['hoat-dong-5','hoat-dong-4','hoat-dong-1'],
});

// Menus saved before dropdowns existed have no `children`; give the default dropdowns to their matching items.
export function resolveHomepage(configuration?: Partial<z.infer<typeof homepageSchema>> | null) {
  const navigation = (configuration?.navigation ?? defaultHomepage.navigation).map(item => item.children || !defaultMenuChildren[item.href] ? item : { ...item, children: defaultMenuChildren[item.href] });
  return {...defaultHomepage,...configuration,navigation,copy:{...defaultCopy,...configuration?.copy}};
}
