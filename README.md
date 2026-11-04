# HSK5 by quyky

Website hỗ trợ người học tiếng Trung (dành cho người Việt Nam) tự học theo từng bài trong giáo trình **HSK5**, tập trung vào hai chức năng cốt lõi:
1. **Flashcard ghi nhớ từ vựng và ngữ pháp** (hiệu ứng lật 3D, 5 chế độ học, tự động chuyển thẻ, phím tắt).
2. **Luyện viết chữ Hán** (ô luyện viết Mễ tự cách hỗ trợ chuột & cảm ứng, kết hợp hướng dẫn thứ tự nét bằng Hanzi Writer và chế độ thử thách viết từng nét).

## Công nghệ sử dụng
- React 18 + TypeScript + Vite
- Tailwind CSS (hỗ trợ giao diện Sáng / Tối)
- Lucide Icons
- Hanzi Writer (hướng dẫn thứ tự nét chữ Hán, kèm fallback ngoại tuyến)
- LocalStorage (lưu tiến độ học tập bền vững trên trình duyệt)

## Cách thêm bài học mới
Chỉ cần bổ sung bài học mới (`bai4`, `bai5`, ...) vào đối tượng `translation` trong `src/data/hsk5.json` (hoặc dùng nút **Quản lý JSON** ngay trên thanh công cụ của website), hệ thống sẽ tự động cập nhật số lượng bài học, từ vựng và ngữ pháp mà không cần chỉnh sửa code giao diện.

## Chạy dự án tại máy cá nhân / GitHub Pages
```bash
npm install
npm run dev
```
