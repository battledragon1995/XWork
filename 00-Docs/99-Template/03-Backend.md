# BE-NNN — <Tên chức năng backend>

Tài liệu này đặc tả một chức năng backend ở mức contract, đủ dữ kiện để lập plan hoặc triển khai trực tiếp mà không phải suy đoán: dữ liệu lưu thế nào, command và event công khai ra sao, business rule nào phải giữ và khi nào được coi là hoàn thành.

Quy tắc viết:

- Mỗi chức năng một file, đặt tại `00-Docs/03-Backend/BE-NNN-<ten-kebab>.md`.
- Chỉ ghi contract: chữ ký, kiểu dữ liệu, hành vi và ràng buộc. Không dán implementation đầy đủ; riêng schema bảng và chữ ký command phải ghi chính xác đến mức copy ra dùng được.
- Không ghi trạng thái file kiểu "mới" hoặc "chỉnh sửa"; thông tin đó sai dần theo thời gian. Người triển khai kiểm tra file đã tồn tại trên đĩa hay chưa tại thời điểm làm.
- Mọi quyết định thiết kế phải nằm trong tài liệu. Điều chưa quyết được ghi vào `Câu hỏi mở`; người triển khai dừng lại hỏi thay vì tự đoán.
- Đường dẫn và cách đặt file tuân theo `00-Docs/00-Overview/02-ProjectStructure.md`; công nghệ và giới hạn tuân theo `00-Docs/00-Overview/01-TechStack.md`. Không lặp lại nội dung hai file đó ở đây.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-NNN` |
| Phase | `<1–4>` |
| Capability | `src-tauri/src/<capability>/` |
| Yêu cầu chức năng | `<Mục trong 00-Docs/00-Overview/03-FunctionalRequirements.md, ví dụ §7.2>` |
| Frontend liên quan | `<FE-NNN, ... hoặc "Không có">` |
| Phụ thuộc | `<BE-NNN phải hoàn thành trước hoặc "Không có">` |

## Mục tiêu

`<1–3 câu: backend cung cấp năng lực gì sau khi chức năng hoàn thành.>`

### Ngoài phạm vi

- `<Điều dễ bị làm lố nhưng không thuộc chức năng này; ghi rõ để không tự mở rộng.>`

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/src/<capability>/mod.rs` | `<Model, command và xử lý nghiệp vụ nào>` |
| `src-tauri/migrations/NNNN_<mo_ta>.sql` | `<Thay đổi schema nào>` |
| `src-tauri/src/app/<file>.rs` | `<Đăng ký command hoặc managed state như thế nào>` |
| `src-tauri/tests/<capability>_<hanh_vi>.rs` | `<Integration test cho hành vi nào>` |

> Liệt kê đầy đủ mọi file cần tạo hoặc chỉnh sửa để chức năng chạy được, kể cả file đăng ký command, migration và file test. Một file không có trong bảng thì không được đụng vào.

## Dữ liệu

### Bảng `<table_name>`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `<ten_cot>` | `<TEXT / INTEGER / ...>` | `<PRIMARY KEY, NOT NULL, UNIQUE, FK...>` | `<Cột lưu gì, giá trị hợp lệ>` |

- Index: `<Index hoặc unique constraint cần có, hoặc "Không có">`
- Migration: `src-tauri/migrations/NNNN_<mo_ta>.sql`

> Xóa mục này nếu chức năng không đụng schema. Migration chỉ được thêm file mới, không sửa migration đã phát hành.

## DTO public

```rust
// Chỉ ghi field, không ghi impl. DTO public derive ts-rs để sinh binding cho frontend.
#[derive(Serialize, Deserialize, TS)]
pub struct <Ten>Dto {
    pub <truong>: <Kiểu>,
}
```

> DTO thuộc capability sở hữu nó. Binding sinh vào `src/bindings/` và không được sửa tay.

## Tauri command

Một mục cho mỗi command. Command phải mỏng: parse và validate DTO, gọi xử lý của capability, chuyển kết quả thành DTO.

### `<command_name>`

`<Một câu mô tả mục đích.>`

```rust
#[tauri::command]
async fn <command_name>(<tham_so>: <Kiểu>) -> Result<<KiểuTrảVề>, <Capability>Error>
```

| Nội dung | Giá trị |
|---|---|
| Validation | `<Từng quy tắc kiểm tra input; backend luôn kiểm tra lại dù frontend đã validate>` |
| Side effect | `<Ghi database, tạo tiến trình, phát event... hoặc "Không có">` |
| Lỗi trả về | `<Variant lỗi nào, trong tình huống nào>` |

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `<Tên event hoặc channel>` | `<Kiểu DTO>` | `<Điều kiện phát>` | `<Thứ tự, tần suất, có gộp dồn không>` |

> Output có thông lượng cao như terminal phải đi qua Channel, không dùng event thường. Ghi `Không có` nếu chức năng không phát gì.

## Business rule và invariant

1. `<Quy tắc nghiệp vụ hoặc điều kiện luôn phải đúng, viết kiểm chứng được. Ví dụ: một tab có tối đa bốn pane.>`

## Lỗi

```rust
// Chỉ ghi variant, không ghi impl.
pub enum <Capability>Error {
    <Variant>,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `<Variant>` | `<Tình huống>` | `<Hiển thị thông điệp riêng, cho retry... hoặc "Chỉ hiển thị lỗi chung">` |

## Luồng chính

1. `<Từng bước của luồng nhiều bước; ghi rõ bước nào chạm database, bước nào tạo tiến trình, bước nào phát event và thứ tự giữa chúng.>`

> Xóa mục này nếu các mục Command và Event đã mô tả đủ hành vi.

## Ràng buộc kỹ thuật

- Blocking: `<Tác vụ blocking nào phải chạy ngoài async worker và chạy ở đâu, hoặc "Không có">`
- Bảo mật: `<Giới hạn đường dẫn, secret, dữ liệu không được ghi log... hoặc "Không có">`
- Hiệu năng: `<Giới hạn phải giữ, ví dụ bốn terminal đồng thời vẫn ổn định, hoặc "Không có">`

## Tiêu chí hoàn thành

- [ ] `<Hành vi kiểm chứng được bằng test hoặc thao tác cụ thể; không dùng mô tả chung chung như "hoạt động ổn định".>`

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/<capability>/mod.rs` (`#[cfg(test)]`) | Unit | `<Hành vi được xác nhận>` |
| `src-tauri/tests/<capability>_<hanh_vi>.rs` | Integration | `<Hành vi qua public boundary được xác nhận>` |

## Câu hỏi mở

- `<Điều chưa quyết và ai cần trả lời. Ghi "Không có" khi tài liệu đã đủ.>`

> Chức năng chỉ được triển khai khi mục này là `Không có`.
