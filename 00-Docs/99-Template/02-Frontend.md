# FE-NNN — <Tên feature>

Tài liệu này đặc tả một feature frontend ở mức contract, đủ dữ kiện để lập plan hoặc triển khai trực tiếp mà không phải suy đoán: feature làm gì, đụng vào những file nào, giao tiếp với backend ra sao và khi nào được coi là hoàn thành.

Quy tắc viết:

- Mỗi feature một file, đặt tại `00-Docs/02-Frontend/FE-NNN-<ten-kebab>.md`.
- Chỉ ghi contract: chữ ký, kiểu dữ liệu, hành vi và ràng buộc. Không dán implementation đầy đủ.
- Không ghi trạng thái file kiểu "mới" hoặc "chỉnh sửa"; thông tin đó sai dần theo thời gian. Người triển khai kiểm tra file đã tồn tại trên đĩa hay chưa tại thời điểm làm.
- Mọi quyết định thiết kế phải nằm trong tài liệu. Điều chưa quyết được ghi vào `Câu hỏi mở`; người triển khai dừng lại hỏi thay vì tự đoán.
- Đường dẫn và cách đặt file tuân theo `00-Docs/00-Overview/02-ProjectStructure.md`; công nghệ và giới hạn tuân theo `00-Docs/00-Overview/01-TechStack.md`. Không lặp lại nội dung hai file đó ở đây.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-NNN` |
| Phase | `<1–4>` |
| Khu vực chính | `src/features/<feature>/` |
| Yêu cầu chức năng | `<Mục trong 00-Docs/00-Overview/03-FunctionalRequirements.md, ví dụ §7.2>` |
| Wireframe | `<File trong 00-Docs/01-Wireframe/ hoặc "Chưa có">` |
| Backend liên quan | `<BE-NNN, ... hoặc "Không có">` |
| Phụ thuộc | `<FE-NNN phải hoàn thành trước hoặc "Không có">` |

## Mục tiêu

`<1–3 câu: người dùng làm được gì sau khi feature hoàn thành.>`

### Ngoài phạm vi

- `<Điều dễ bị làm lố nhưng không thuộc feature này; ghi rõ để không tự mở rộng.>`

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/<feature>/<file>.tsx` | `<Nội dung file đảm nhận>` |
| `src/lib/ipc/<file>.ts` | `<Wrapper cho command/channel nào>` |
| `src/app/<file>.tsx` | `<Đăng ký route hoặc ghép vào shell như thế nào>` |

> Liệt kê đầy đủ mọi file cần tạo hoặc chỉnh sửa để feature chạy được, kể cả file đăng ký route, wrapper IPC và file test. Một file không có trong bảng thì không được đụng vào.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `<ComponentName>` | `<Hiển thị gì, đặt ở đâu trong layout>` | `<Tham chiếu hoặc "Không có">` |

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| `<Rỗng>` | `<Khi nào xảy ra>` | `<Hiển thị gì, hành động tiếp theo là gì>` |
| `<Đang tải>` | `<Khi nào xảy ra>` | `<Hiển thị gì>` |
| `<Lỗi>` | `<Khi nào xảy ra>` | `<Thông điệp và hành động khắc phục>` |

> Tối thiểu phải định nghĩa trạng thái rỗng, đang tải và lỗi theo yêu cầu tương tác chung của `03-FunctionalRequirements.md`. Thêm dòng cho các trạng thái riêng của feature.

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| `<Người dùng làm gì>` | `<Giao diện phản hồi ra sao>` | `<Tổ hợp phím hoặc "Không có">` |

## Luồng chính

1. `<Từng bước của luồng nhiều bước; ghi rõ bước nào gọi command, bước nào chờ event, bước nào cảnh báo người dùng.>`

> Xóa mục này nếu bảng Tương tác đã mô tả đủ hành vi.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `<command_name>` | `<Kiểu DTO>` | `<Kiểu DTO>` | `<Từng loại lỗi và cách hiển thị>` |

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `<Tên event hoặc channel>` | `<Kiểu DTO>` | `<Điều kiện phát>` | `<Cập nhật gì trên giao diện>` |

> Kiểu DTO lấy từ `src/bindings/`, không định nghĩa lại thủ công. Command hoặc event chưa tồn tại phải được đặc tả trong tài liệu `BE-NNN` tương ứng trước khi feature này được triển khai. Ghi `Không có` nếu feature không gọi backend.

## State frontend

```ts
// Chỉ ghi hình dạng state và chữ ký action, không ghi implementation.
interface <Feature>State {
  <truong>: <Kiểu>;
  <action>(<thamSo>: <Kiểu>): void;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `<Trường state>` | `<UI tạm thời / Backend qua command>` | `<Khi nào lấy lại từ backend; không cache business state lâu dài>` |

## Contract công khai của feature

```ts
// Chỉ ghi export mà src/app/ hoặc feature khác được phép dùng, ở mức chữ ký.
export function <ScreenComponent>(props: { <prop>: <Kiểu> }): JSX.Element
```

> Feature khác không import implementation nội bộ. Nếu feature chỉ export route entry, ghi rõ như vậy.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| `<Điều kiện bất thường: dữ liệu thiếu, thao tác lặp, mất kết nối với backend...>` | `<Giao diện làm gì, hiển thị gì>` |

## Tiêu chí hoàn thành

- [ ] `<Hành vi kiểm chứng được bằng thao tác cụ thể hoặc test cụ thể; không dùng mô tả chung chung như "hoạt động ổn định".>`

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/<feature>/<file>.test.tsx` | `<Component / Unit>` | `<Hành vi được xác nhận>` |

## Câu hỏi mở

- `<Điều chưa quyết và ai cần trả lời. Ghi "Không có" khi tài liệu đã đủ.>`

> Feature chỉ được triển khai khi mục này là `Không có`.
