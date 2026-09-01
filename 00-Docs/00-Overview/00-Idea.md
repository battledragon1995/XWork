# Ý tưởng xwork(Dự án cá nhân first, có thể mở rộng public source sau)
## Tình hình
- Mỗi ngày tôi đang làm việc với nhiều project và sử dụng ai agent(claude code cli, codex cli). Tại sao lại là cli => Nhẹ, ổn định, cập nhật sớm, ít lỗi vặt. 
- Mỗi project là một folder trên PC gắn với một git repo. 
- Hiện tại đang sử dụng terminal: làm việc với chỉ 1 project khá ổn, nhưng làm việc với nhiều project khá phiền: khai báo thêm profile, cd thủ công, chia tab xấu và không resize tab được.
- Tôi có thử qua một vài app như warp, wave thì các app này giao diện đang rối, xấu, khả năng custom màu sắc khá tệ.
- Lúc trước có làm qua app sử dụng xtermjs thì chất lượng khá tệ khi sử dụng với cli(claude code cli, codex cli), có một vài vẫn đề phải custom cực kì phiền.

## Ý tưởng
- Một app đa nền tảng(windows, macOS) dùng để làm việc với nhiều project.
- Hỗ trợ mở nhanh cli: claude code, codex... (Có thể khai tự báo thêm)
- Hỗ trợ chia tab, resize tab.

## Chức năng thêm
**Note**
- Màn hình chính sẽ hiển thị các note, cho phép chạy ngầm, sử dụng phím tắt để mở nhanh giao diện ghi chú format markdown
**Calendar**
- Chức năng về lịch, nhắc nhở....
**Xem, edit file**
- View nhanh một file ở project: có thể là md hoặc source, riêng về md thì cho phép edit.(App này k nhắm đến kiểu một IDE)

## Lộ trình phát triển mong muốn
**Phase 1** Project, Terminal.
**Phase 2** Xem, edit file.
**Phase 3** Note.
**Phase 4** Calendar.

## Lưu ý
- Ưu tiên việc sử dụng các công nghệ mới, đang trending