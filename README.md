# Backend Bệnh viện Đa khoa Đại An

REST API Node.js/Express/TypeScript và MongoDB, độc lập với frontend `../benh-vien-2`. Cài đặt và deploy thư mục này riêng; không cần source frontend để chạy, seed hay build.

## Cấu hình .env

File `.env` đã được tạo để cấu hình cục bộ; `.env.example` là mẫu không chứa secret. `.gitignore` và `.dockerignore` loại trừ `.env`, uploads và dữ liệu kiểm thử.

| Biến | Cách cấu hình |
| --- | --- |
| `NODE_ENV` | `development` cục bộ; `production` trên server |
| `PORT` | Cổng API, mặc định `4000` |
| `MONGODB_URI` | MongoDB cục bộ hoặc URI MongoDB Atlas của bạn |
| `JWT_SECRET` | `.env` đã có secret ngẫu nhiên; dùng secret riêng cho production, tối thiểu 48 ký tự |
| `SITE_ORIGIN` | `http://localhost:3000` cục bộ; `https://benhviendaian.vn` khi vận hành |
| `TRUST_PROXY` | `0` trực tiếp, `1` nếu qua Caddy; phải khớp proxy thực tế |
| `UPLOAD_DIR` | Thư mục ảnh, mặc định `./uploads`; cần lưu bền vững và sao lưu |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Tài khoản khởi tạo; điền trước khi chạy seed. Mật khẩu ít nhất 12 ký tự |
| `TURNSTILE_SECRET_KEY` | Tùy chọn; cấu hình cùng khóa công khai bên frontend |
| `API_DOMAIN` | Hostname API cho Docker/Caddy, ví dụ `api.benhviendaian.vn` |

Không có tài khoản quản trị mặc định. Không gửi hoặc commit `.env`. Sau khi tạo Administrator, có thể bỏ `ADMIN_PASSWORD` khỏi môi trường chạy thông thường. Không chạy seed vào database chưa kiểm tra cấu hình.

## Chạy cục bộ

Yêu cầu Node.js 24 và MongoDB đang chạy hoặc MongoDB Atlas. Mở terminal trong thư mục backend:

```sh
npm ci
npm run seed
npm run dev
```

Health API: `http://127.0.0.1:4000/api/health`. Frontend dùng `API_INTERNAL_URL=http://127.0.0.1:4000` và proxy `/api/*` sang backend.

Seed chỉ tạo nội dung/tài khoản chưa tồn tại, không ghi đè nội dung hoặc mật khẩu đã chỉnh sửa. Theo yêu cầu khôi phục trang chủ, nội dung cũ được nhập và hiển thị trong CMS: dịch vụ/chuyên khoa, 6 banner, bài viết, hỏi đáp, ảnh và video. Không tạo hồ sơ bác sĩ minh họa. Ảnh `/assets/*` được phục vụ bởi frontend; ảnh CMS tải lên được phục vụ tại `/api/media/*`.

Với database đã seed trước thay đổi này, chạy `npm run restore:home`. Đây là migration một lần: xuất bản lại các bản ghi mặc định cũ, thêm nội dung còn thiếu, giữ nội dung đã được admin biên tập. Sau khi hoàn thành, chạy lại không khôi phục những mục admin đã sửa, ẩn hoặc xóa. Migration không thay tài khoản, mật khẩu, đăng ký khám hay góp ý. Frontend chỉ hardcode các khối trình bày chưa có CMS riêng (hai hàng ảnh/liên kết, ảnh hoạt động đội ngũ khi chưa có hồ sơ bác sĩ và liên kết bảng giá); dữ liệu CMS vẫn lấy từ API.

## Build, kiểm thử và chạy production

```sh
npm run typecheck
npm test
npm run build
npm start
```

`npm test` dùng MongoDB tạm cô lập, không đọc database trong `.env`. `npm run dev:fixture` khởi động API trên cổng 4000 với dữ liệu chỉ dành cho kiểm thử frontend; không dùng lệnh này để vận hành. `npm start` tự đọc `.env` nếu có; biến môi trường do server cung cấp được ưu tiên.

```text
src/
  db/                  Models, index và kết nối MongoDB
  middleware/          JWT, CSRF, Origin và phân quyền
  routes/              Public, auth và admin REST API
  lib/                 Validation, cache, upload và chống spam
  app.ts               Express application
  server.ts            Khởi động và graceful shutdown
  seed.ts              Tạo Administrator và dữ liệu ban đầu
seed-data/             Nội dung nhập ban đầu, không phụ thuộc frontend
scripts/               Fixture kiểm thử cô lập
tests/                 Kiểm thử API
deploy/                Docker Compose và Caddy HTTPS
.env                   Cấu hình riêng, không commit
```

## Docker và HTTPS

Điền URI MongoDB, JWT, tài khoản seed và `API_DOMAIN` trong `.env`. Trỏ DNS hostname API về server. Docker Compose đặt `NODE_ENV=production`, `SITE_ORIGIN=https://benhviendaian.vn` và `TRUST_PROXY=1`; Caddy tự cấp TLS khi DNS đúng.

```sh
docker compose --env-file .env -f deploy/compose.yml up -d --build
docker compose --env-file .env -f deploy/compose.yml run --rm api node dist/seed.js
```

Giữ volume uploads khi cập nhật, sao lưu MongoDB và ảnh. MongoDB không mở công khai ra Internet. Cache và rate limit giúp giảm tải; Firewall/CDN cần cấu hình ở hosting. Rate limit hiện dùng bộ nhớ từng tiến trình; khi chạy nhiều replica cần Redis store hoặc gateway chung. Xem thêm hướng dẫn Vercel/proxy trong `../benh-vien-2/docs/deployment.md`.

## Quản trị toàn bộ trang chủ

Backend tự bổ sung cấu hình `Homepage` và các loại nội dung promotion/care_activity/support_link/editorial_link khi khởi động hoặc seed. Có thể chạy `npm run setup:home` riêng. Migration chỉ thêm dữ liệu ban đầu; không ghi đè nội dung đã sửa và không khôi phục mục admin đã xóa. Icon 12 chuyên khoa khôi phục đúng source demo, giữ icon đã được chỉnh. GET/PUT `/api/admin/homepage` chỉ dành cho Administrator và dùng xác thực/CSRF hiện có. Cấu hình bao gồm SEO, chữ, menu, logo, lựa chọn đội ngũ và 14 khối có thứ tự/ẩn hiện; dữ liệu được trả trong `/api/public/home` cùng các thẻ nội dung.

Kiểm thử cô lập trên cổng riêng: đặt `TEST_API_PORT=4001` trước `npm run dev:fixture`, frontend dùng `API_INTERNAL_URL=http://127.0.0.1:4001` khi build/chạy kiểm thử. Fixture mặc định chấp nhận origin `http://127.0.0.1:3100`; đổi bằng `TEST_SITE_ORIGIN` khi cần.

## Vòng đời ảnh upload

Collection Media quản lý metadata của file WebP trong UPLOAD_DIR. Khi khởi động, API lập chỉ mục các file upload cũ và chạy đợt dọn; sau đó chạy mỗi giờ, tối đa 100 ảnh/đợt. Cần volume uploads bền vững trên backend riêng; backup thư mục này cùng MongoDB. Frontend Vercel truy cập /api/media qua proxy.

Ảnh mới chưa sử dụng giữ 7 ngày. Xóa/sửa bài, nội dung, cấu hình trang chủ và thông tin bệnh viện lên lịch kiểm tra ảnh cũ sau 24 giờ. Worker kiểm tra tất cả tham chiếu, gồm ảnh đại diện, ảnh HTML, bài nháp/nội dung ẩn và cấu hình. Chỉ file upload hợp lệ trong UPLOAD_DIR được unlink; không đụng ảnh public/assets.

CMS save đặt lease nguyên tử trên ảnh; worker chỉ nhận ảnh không có save đang chạy. Claim dọn có thời hạn để phục hồi khi tiến trình gián đoạn; lỗi filesystem được ghi vào metadata và thử lại. API không cho lưu URL upload đã bị xóa. Các instance dùng chung MongoDB phải cùng truy cập một volume uploads; không dùng các ổ cục bộ độc lập.

GET /api/admin/media hỗ trợ phân trang, tìm tên, lọc used/unused và trả nơi dùng. POST /api/admin/media/:id/select gia hạn ảnh để chọn lại. DELETE /api/admin/media/:id chỉ Administrator, từ chối ảnh đang dùng và lên lịch dọn sau 24 giờ.
