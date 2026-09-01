# Project Structure

Tài liệu này mô tả cách project được chia thành các khu vực, trách nhiệm của từng khu vực và quy tắc đặt file mới.

Không đặt danh sách công nghệ, hướng dẫn cài đặt hoặc mô tả chi tiết luồng xử lý trong file này.

## Nguyên tắc tổ chức

- Cách chia chính: `<Theo chức năng, theo loại file, theo tầng xử lý...>`
- Thành phần dùng chung chỉ được tạo khi: `<Điều kiện>`
- Mỗi khu vực phải có một trách nhiệm rõ ràng và không chứa code không liên quan.
- Không tạo thêm thư mục chỉ để chứa một file, trừ khi dự kiến khu vực đó sẽ mở rộng.

## Cây thư mục

```text
<project-root>/
├── <source>/             # <Mã nguồn chính>
│   ├── <area>/           # <Khu vực hoặc chức năng>
│   └── <shared>/         # <Thành phần dùng chung>
├── <tests>/              # <Code kiểm thử>
├── <docs>/               # <Tài liệu>
├── <scripts>/            # <Công cụ hỗ trợ project>
└── <config-file>         # <Cấu hình cấp project>
```

Chỉ liệt kê các thư mục và file quan trọng. Không cần liệt kê file được sinh tự động, thư viện đã cài hoặc kết quả build.

## Trách nhiệm

| Đường dẫn | Trách nhiệm | Không chứa |
|---|---|---|
| `<path>` | `<Loại nội dung được đặt tại đây>` | `<Nội dung không thuộc khu vực này>` |
| `<path>` | `<Loại nội dung được đặt tại đây>` | `<Nội dung không thuộc khu vực này>` |

## Quy tắc đặt file mới

- File thuộc riêng một chức năng được đặt tại: `<Đường dẫn hoặc quy tắc>`
- Thành phần dùng chung được đặt tại: `<Đường dẫn>`
- Code kiểm thử được đặt tại: `<Đường dẫn hoặc quy tắc>`
- Cấu hình được đặt tại: `<Đường dẫn hoặc quy tắc>`
- Tài nguyên tĩnh được đặt tại: `<Đường dẫn hoặc quy tắc>`
- Ngoại lệ: `<Thông tin hoặc "Không có">`

## Quy tắc phụ thuộc

- `<Khu vực A>` được phép sử dụng: `<Các khu vực>`
- `<Khu vực A>` không được phép sử dụng trực tiếp: `<Các khu vực>`
- Giao tiếp giữa các khu vực thông qua: `<Cách thức hoặc file trung gian>`
- Nếu xuất hiện phụ thuộc vòng, phải tách phần dùng chung ra khỏi các khu vực liên quan.

## Quy tắc đặt tên

| Đối tượng | Quy tắc | Ví dụ |
|---|---|---|
| Thư mục | `<Quy tắc>` | `<Ví dụ>` |
| File | `<Quy tắc>` | `<Ví dụ>` |
| File kiểm thử | `<Quy tắc>` | `<Ví dụ>` |
| File cấu hình | `<Quy tắc>` | `<Ví dụ>` |

## Nội dung được sinh tự động

| Đường dẫn | Được tạo bởi | Có được sửa thủ công? |
|---|---|---|
| `<path>` | `<Công cụ hoặc lệnh>` | `<Có / Không>` |

> Xóa mục này nếu project không có file hoặc thư mục được sinh tự động.
