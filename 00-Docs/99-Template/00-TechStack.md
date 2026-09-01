# Tech Stack

Tài liệu này ghi lại các công nghệ project đang sử dụng, vai trò của chúng và những giới hạn cần tuân theo.

Không đặt hướng dẫn cài đặt, cấu trúc thư mục hoặc mô tả kiến trúc trong file này.

## Tổng quan

| Nội dung | Giá trị |
|---|---|
| Loại project | `<Web, desktop, mobile, thư viện, dịch vụ...>` |
| Nền tảng chạy | `<Windows, macOS, Linux, trình duyệt, cloud...>` |
| Ngôn ngữ chính | `<Tên và phiên bản>` |
| Công cụ quản lý thư viện | `<Tên và phiên bản>` |

## Công nghệ chính

| Nhóm | Công nghệ | Phiên bản | Vai trò | Ghi chú |
|---|---|---:|---|---|
| Nền tảng | `<Tên công nghệ>` | `<Phiên bản>` | `<Mục đích sử dụng>` | `<Thông tin cần lưu ý>` |
| Giao diện | `<Tên công nghệ>` | `<Phiên bản>` | `<Mục đích sử dụng>` | `<Thông tin cần lưu ý>` |
| Xử lý chính | `<Tên công nghệ>` | `<Phiên bản>` | `<Mục đích sử dụng>` | `<Thông tin cần lưu ý>` |
| Dữ liệu | `<Tên công nghệ>` | `<Phiên bản>` | `<Mục đích sử dụng>` | `<Thông tin cần lưu ý>` |
| Giao tiếp bên ngoài | `<Tên công nghệ>` | `<Phiên bản>` | `<Mục đích sử dụng>` | `<Thông tin cần lưu ý>` |

> Xóa những dòng không áp dụng và thêm nhóm mới khi cần.

## Phát triển và kiểm tra chất lượng

| Mục đích | Công cụ | Phiên bản | Cấu hình chính |
|---|---|---:|---|
| Chạy môi trường phát triển | `<Tên công cụ>` | `<Phiên bản>` | `<File cấu hình hoặc lệnh>` |
| Định dạng code | `<Tên công cụ>` | `<Phiên bản>` | `<File cấu hình>` |
| Kiểm tra code | `<Tên công cụ>` | `<Phiên bản>` | `<File cấu hình>` |
| Kiểm thử | `<Tên công cụ>` | `<Phiên bản>` | `<Loại kiểm thử>` |
| Đóng gói | `<Tên công cụ>` | `<Phiên bản>` | `<Kết quả đầu ra>` |

## Hạ tầng và triển khai

| Thành phần | Công nghệ / dịch vụ | Mục đích |
|---|---|---|
| Môi trường chạy | `<Tên>` | `<Mục đích>` |
| Lưu trữ dữ liệu | `<Tên>` | `<Mục đích>` |
| Theo dõi lỗi / hoạt động | `<Tên>` | `<Mục đích>` |
| Phát hành | `<Tên>` | `<Mục đích>` |

> Nếu project không có hạ tầng hoặc quy trình triển khai riêng, ghi `Không áp dụng`.

## Ràng buộc kỹ thuật

- Hệ điều hành / môi trường hỗ trợ: `<Thông tin>`
- Phiên bản tối thiểu: `<Thông tin>`
- Giới hạn tài nguyên hoặc hiệu năng: `<Thông tin hoặc "Không có">`
- Yêu cầu tương thích đặc biệt: `<Thông tin hoặc "Không có">`

## Quản lý phiên bản

- Nguồn xác định phiên bản đang dùng: `<Tên các file cấu hình>`
- Cách khóa phiên bản thư viện: `<Quy tắc>`
- Nguyên tắc cập nhật: `<Khi nào và ai chịu trách nhiệm>`
- Công nghệ không còn sử dụng phải được xóa khỏi tài liệu này cùng lúc với code liên quan.
