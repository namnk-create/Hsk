# HSK Tứ Kỹ — app tự học tiếng Trung (nghe · nói · hội thoại · đọc · viết)

Chạy trên **Cloudflare Workers + D1 + Workers AI**. Giao diện là một file `public/index.html`
(từ vựng HSK1–5, 2.700 từ, nghe, nói, hội thoại, đọc, viết); API nằm trong `public/_worker.js`.

## Cấu trúc
```
public/index.html      app chính (PWA, cài được lên màn hình điện thoại)
public/_worker.js      API: đăng nhập, tiến độ, bình luận, AI hội thoại, quản trị
public/manifest.json   + sw.js + icon-*.png  → PWA
public/tu-vung-cu.html app từ vựng bản cũ (giữ để tham khảo)
wrangler.jsonc         cấu hình Worker (D1 `hsk-tuky`, binding AI)
migrations/001-init.sql schema D1 (đã chạy)
.github/workflows/deploy.yml  push lên main → tự deploy
```

## Deploy lần đầu (làm một lần)
1. GitHub → repo này → **Settings → Secrets and variables → Actions** → thêm 2 secret
   `CLOUDFLARE_API_TOKEN` và `CLOUDFLARE_ACCOUNT_ID` (giống repo SF-Time-Management).
2. Tab **Actions** → chạy lại workflow "Deploy to Cloudflare Workers" (hoặc push một commit).
3. Mở `https://hsk-tuky.<tài-khoản>.workers.dev/api/ping` → thấy `{"ok":true,...}`.
4. Vào app, đăng nhập **nam / hsk2026** → app bắt đổi mật khẩu ngay.
5. Màn **Tôi** (bấm vào số từ đã thuộc ở góc phải) → mục Quản trị → tạo tài khoản cho vợ và người học (tối đa 12).

## Tính năng
- **Từ vựng** theo 18 chủ đề × 5 cấp HSK, flashcard + kiểm tra.
- **Nghe**: nghe từ / câu / hội thoại, chọn đáp án.
- **Nói**: đọc từ / câu, máy nhận giọng (Chrome) và chấm từng chữ.
- **Hội thoại** (mới): 8 kịch bản (làm quen, gọi món, mua sắm, hỏi đường, giao hàng, thời tiết,
  khách sạn, họp công việc) — máy nói vai A, bạn nói vai B bằng giọng, chấm điểm từng câu;
  **Trò chuyện tự do với AI** (Workers AI, Qwen3) theo trình độ HSK đang chọn, có pinyin, bản dịch và
  gợi ý sửa lỗi câu của bạn.
- **Đọc**: bài đọc + câu hỏi, **bình luận trao đổi** giữa các người học dưới mỗi bài.
- **Viết**: thứ tự nét, viết lên ô 田字格.
- **Tài khoản**: tiến độ đồng bộ lên D1; admin xem tiến độ mọi người, tạo/khoá tài khoản, đặt lại mật khẩu.
- Không đăng nhập vẫn học được (tiến độ chỉ lưu trên máy).

## Lưu ý
- Nhận giọng nói cần **Chrome** (Android/máy tính) hoặc Safari iOS 14.5+; cần cho phép micro.
- AI dùng model `@cf/qwen/qwen3-30b-a3b-fp8`, dự phòng `@cf/zai-org/glm-4.7-flash` (đổi trong `wrangler.jsonc`).
