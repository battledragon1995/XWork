# Định nghĩa yêu cầu chức năng

Tài liệu này mô tả XWork dưới góc nhìn người dùng: ứng dụng có những khu vực nào, người dùng có thể làm gì, các luồng chính diễn ra ra sao và những trạng thái nào cần xuất hiện trên giao diện.

Tài liệu không mô tả code, kiến trúc, thư viện hoặc cách triển khai. Mức chi tiết được chọn để có thể dựng wireframe cho toàn bộ sản phẩm mà không phải tự suy đoán chức năng cốt lõi.

## 1. Phạm vi sản phẩm

XWork là ứng dụng desktop local-first giúp một người dùng làm việc với nhiều project và nhiều AI CLI trong cùng một cửa sổ. Ứng dụng hỗ trợ Windows và macOS, không yêu cầu tài khoản và không đồng bộ dữ liệu qua cloud.

Bốn phase đều được định nghĩa ở mức chi tiết tương đương:

| Phase | Phạm vi |
|---|---|
| Phase 1 | Project, phiên làm việc, tab, terminal và split pane |
| Phase 2 | Duyệt file, xem source và sửa Markdown |
| Phase 3 | Note, Quick Note và thao tác ghi chú |
| Phase 4 | Calendar, event, reminder và thông báo |

### Ngoài phạm vi

- Đăng nhập, tài khoản, phân quyền, cộng tác và đồng bộ nhiều máy.
- Tạo folder project mới hoặc clone Git repository trong XWork.
- Commit, checkout, pull, push hoặc các thao tác Git khác.
- Sửa source code, LSP, debug và các chức năng IDE.
- Tạo, đổi tên, di chuyển hoặc xóa file/folder trong File Explorer.
- Khôi phục tiến trình terminal, lịch sử CLI hoặc phiên làm việc sau khi thoát hẳn XWork.
- Nhiều cửa sổ làm việc độc lập; ngoại lệ duy nhất là cửa sổ Quick Note.
- Task, người tham gia hoặc lịch cộng tác.

## 2. Người dùng và nguyên tắc trải nghiệm

- XWork phục vụ một người dùng trên một máy.
- Giao diện bản đầu tiên dùng tiếng Anh; tài liệu project vẫn dùng tiếng Việt.
- Mọi dữ liệu của XWork được lưu cục bộ. Source của project tiếp tục nằm tại folder gốc và không được sao chép vào XWork.
- Ứng dụng ưu tiên thao tác bằng bàn phím nhưng mọi chức năng chính vẫn phải có điểm truy cập trực quan trên giao diện.
- Các hành động có thể làm mất phiên, tiến trình đang chạy hoặc nội dung chưa lưu phải cảnh báo trước.
- XWork chỉ hiển thị và chỉnh sửa những gì thuộc phạm vi đã định nghĩa; không mở rộng thành IDE, Git client hoặc công cụ quản lý công việc.

## 3. Thuật ngữ

| Thuật ngữ | Ý nghĩa |
|---|---|
| Project | Một folder có sẵn trên máy được người dùng thêm vào XWork. |
| Phiên làm việc | Không gian làm việc tạm thời bên trong một project, chứa tab, pane, terminal và file đang mở. |
| Tab | Một mục trên thanh tab của phiên; mỗi tab chứa một bố cục gồm một hoặc nhiều pane. |
| Pane | Một vùng trong tab, dùng để chạy Terminal/CLI hoặc hiển thị file. |
| CLI profile | Cấu hình dùng để khởi chạy Codex, Claude, terminal thường hoặc một CLI tùy chỉnh. |
| Note | Ghi chú Markdown được XWork lưu cục bộ, độc lập với file Markdown trong project. |
| Event | Một mục trên Calendar, có thể có thời gian, chu kỳ lặp và reminder. |

## 4. Kiến trúc thông tin

### 4.1. Sidebar chính

Sidebar cố định ở bên trái cửa sổ và gồm:

1. `Home`.
2. `Projects`.
3. `Notes`.
4. `Calendar`.
5. Khu vực project để truy cập nhanh.
6. `Settings` ở cuối sidebar.

Mỗi project trong khu vực project có biểu tượng folder và có thể mở rộng hoặc thu gọn. Khi mở rộng, project hiển thị tất cả phiên đang tồn tại trong lần chạy hiện tại, tương tự cấu trúc project và task của Codex app. Phiên đang chọn có nền nổi bật và các phiên có hoạt động mới có chỉ báo trạng thái.

Project ghim nằm trên cùng. Các project không ghim giữ thứ tự theo thời điểm được thêm vào, không tự đổi thứ tự khi được mở.

Sidebar cho phép:

- Kéo để thay đổi độ rộng.
- Thu gọn thành một thanh chỉ có icon.
- Ghi nhớ độ rộng và trạng thái thu gọn.
- Ẩn danh sách project và phiên khi đang ở chế độ chỉ có icon.

### 4.2. Thanh trên cùng

Thanh trên cùng chứa tối thiểu:

- Điểm truy cập tìm kiếm hợp nhất/Command Palette.
- Biểu tượng chuông và số thông báo chưa đọc.
- Ngữ cảnh hiện tại như tên khu vực, project hoặc phiên.
- Các điều khiển cửa sổ phù hợp với hệ điều hành.

### 4.3. Vùng nội dung

Vùng nội dung thay đổi theo mục được chọn trên sidebar. Trong phiên làm việc, vùng này gồm thanh tab, vùng pane và File Explorer phụ khi được bật.

## 5. Khởi động, đóng cửa sổ và thoát ứng dụng

### 5.1. Lần đầu sử dụng

Khi chưa có dữ liệu, XWork hiển thị màn hình Welcome tối giản gồm:

- Mô tả ngắn về XWork.
- Hành động chính `Add Project`.
- Hành động mở Quick Note.
- Liên kết xem các phím tắt chính.

Không tạo project, note hoặc event mẫu.

### 5.2. Các lần mở sau

- XWork luôn mở tại `Home`.
- Không có phiên làm việc nào được khôi phục sau khi ứng dụng đã thoát hoàn toàn.
- Project, note, event, CLI profile, theme, phím tắt và settings vẫn được giữ.

### 5.3. Đóng cửa sổ

- Đóng cửa sổ chính chỉ ẩn XWork xuống system tray.
- Terminal, AI CLI, Quick Note và reminder tiếp tục hoạt động nền.
- Mở lại từ tray đưa cửa sổ chính về trước mà không làm thay đổi các phiên đang chạy.

### 5.4. Thoát XWork

- `Quit XWork` mới kết thúc hẳn ứng dụng.
- Nếu còn bất kỳ phiên nào, XWork phải hiển thị hộp thoại xác nhận.
- Hộp thoại nêu số phiên và tiến trình đang chạy, đồng thời cảnh báo rằng toàn bộ phiên runtime sẽ không được khôi phục.
- Hai hành động chính là `Cancel` và `Quit`.
- Sau khi thoát, tên phiên, tab, pane, output terminal và tiến trình CLI đều bị loại bỏ.

## 6. Home

Home là dashboard tổng hợp nhưng ưu tiên Note.

### 6.1. Khu vực chính

- Editor Quick Note để nhập trực tiếp trên Home.
- Tiêu đề là tùy chọn.
- Nội dung dùng Markdown.
- Người dùng có thể chọn một project liên kết hoặc để trống.
- `Save` tạo note và làm trống form.
- Bên dưới hoặc cạnh editor là note ghim và note chỉnh sửa gần đây.

### 6.2. Khu vực phụ

- Phiên đang chạy, có output chưa xem hoặc cần chú ý.
- Project được mở gần đây.
- Event và reminder sắp tới.
- Mỗi khối có hành động mở khu vực đầy đủ tương ứng.

Ở các phase chưa có Note hoặc Calendar, Home chỉ hiển thị những khối đã được triển khai. Wireframe trạng thái cuối cùng phải thể hiện đầy đủ các khối trên.

## 7. Projects

### 7.1. Trang Projects

Trang `Projects` dùng bố cục lưới card. Phần đầu trang có:

- Tiêu đề trang.
- Tìm kiếm theo tên hiển thị hoặc đường dẫn.
- Nút `Add Project`.

Mỗi card project hiển thị:

- Tên hiển thị.
- Đường dẫn folder.
- Branch hiện tại nếu là Git repository.
- Git status ở mức tóm tắt.
- Trạng thái khả dụng của folder.
- Trạng thái ghim.
- Các hành động mở project và menu thao tác.

Project ghim xuất hiện trước, các project còn lại theo thứ tự được thêm.

### 7.2. Thêm project

Luồng thêm project:

1. Người dùng chọn `Add Project`.
2. XWork mở hộp chọn folder của hệ điều hành.
3. Người dùng chọn một folder có sẵn.
4. XWork lấy tên folder làm tên hiển thị mặc định và tự nhận diện Git repository nếu có.
5. Project xuất hiện trong sidebar và trang Projects.
6. XWork mở trang tổng quan của project vừa thêm.

XWork không tạo folder mới và không clone repository.

### 7.3. Thông tin và thao tác project

Mỗi project lưu và hiển thị:

- Tên hiển thị.
- Đường dẫn gốc.
- Thời điểm được thêm và thời điểm mở gần nhất.
- Trạng thái ghim.
- Có phải Git repository hay không.
- Branch hiện tại và số file thay đổi.

Các thao tác gồm:

- Mở project.
- Đổi tên hiển thị.
- Ghim hoặc bỏ ghim.
- Mở folder bằng trình quản lý file của hệ điều hành.
- Chọn lại folder nếu đường dẫn cũ không còn hợp lệ.
- Gỡ project khỏi XWork.

Gỡ project chỉ xóa metadata khỏi XWork, không xóa folder hoặc file trên máy. Nếu project còn phiên hay tiến trình đang chạy, XWork phải cảnh báo và nêu rõ chúng sẽ bị kết thúc trước khi cho xác nhận.

### 7.4. Project không khả dụng

Nếu folder bị di chuyển, đổi tên hoặc xóa bên ngoài:

- Project vẫn nằm trong danh sách.
- Card và sidebar hiển thị trạng thái `Unavailable`.
- Người dùng có thể chọn lại folder hoặc gỡ project.
- Không cho tạo phiên mới cho đến khi đường dẫn hợp lệ.

### 7.5. Trang tổng quan project

Bấm tên project trên sidebar vừa mở rộng danh sách phiên vừa mở trang tổng quan. Trang này gồm:

- Header với tên, đường dẫn, branch và Git status.
- Nút `New Session`.
- Danh sách tất cả phiên đang tồn tại trong lần chạy hiện tại.
- Danh sách file được mở gần đây.
- Note liên kết với project.
- Event liên kết với project.

Git chỉ có tính chất đọc. Người dùng có thể xem branch, số lượng và danh sách file thay đổi nhưng không thực hiện thao tác Git.

## 8. Phiên làm việc

### 8.1. Vòng đời

- Một project có thể có nhiều phiên cùng lúc.
- Phiên mới có tên mặc định `New Session` và có thể đổi tên.
- Phiên chỉ tồn tại trong lần chạy hiện tại của XWork.
- Ẩn cửa sổ xuống tray hoặc chuyển sang project khác không làm mất phiên.
- Thoát hẳn XWork xóa toàn bộ phiên runtime.
- Phiên chỉ có hai thao tác quản lý: đổi tên và xóa.
- Xóa phiên kết thúc các tiến trình bên trong; nếu còn tiến trình chạy hoặc Markdown chưa lưu, phải xác nhận trước.

### 8.2. Trạng thái phiên trên sidebar

Một phiên có thể hiển thị một trong các trạng thái người dùng cần phân biệt:

- Đang được chọn.
- Có tiến trình đang chạy.
- Có output chưa xem.
- Cần người dùng chú ý.
- Tiến trình đã kết thúc hoặc gặp lỗi.

Khi chuyển phiên, các terminal và AI CLI trong phiên cũ tiếp tục chạy nền.

### 8.3. Tạo phiên

Khi tạo phiên mới:

1. Phiên xuất hiện ngay dưới project với tên `New Session`.
2. Vùng nội dung hiển thị màn hình chọn công cụ.
3. Các lựa chọn gồm Codex, Claude, Terminal, CLI profile tùy chỉnh và công cụ dùng gần đây.
4. Chọn một công cụ sẽ tạo tab terminal tại folder gốc project và chạy ngay lệnh của profile.

## 9. Tab và pane

### 9.1. Tab

Mỗi tab chứa một bố cục pane riêng. Thanh tab hỗ trợ:

- Tạo tab.
- Đổi tên tab.
- Kéo thả để sắp xếp.
- Đóng tab.
- Mở lại tab vừa đóng trong lần chạy hiện tại.

Đóng tab có terminal đang chạy hoặc Markdown chưa lưu phải hiển thị cảnh báo.

### 9.2. Pane

Một pane có thể chứa:

- Terminal thường.
- Codex, Claude hoặc CLI tùy chỉnh.
- Source viewer.
- Markdown editor hoặc preview.

Notes và Calendar không được đặt trong pane; chúng là khu vực chính riêng của ứng dụng.

Pane đang active có các hành động:

- Chia ngang.
- Chia dọc.
- Phóng to tạm thời và quay lại bố cục cũ.
- Đóng pane.

Các hành động chính đều có phím tắt. Một tab có tối đa 4 pane. Khi đạt giới hạn, nút chia bị vô hiệu hóa.

Pane mới sau khi chia hiển thị màn hình chọn nội dung gồm Terminal/CLI hoặc File, với lựa chọn gần đây nằm trước.

## 10. Terminal và CLI profile

### 10.1. Terminal

Terminal hỗ trợ các thao tác thiết yếu:

- Nhập lệnh và tương tác đầy đủ với CLI.
- Chọn và sao chép văn bản.
- Dán nội dung.
- Cuộn lịch sử output.
- Tìm trong output.
- Xóa màn hình.
- Mở liên kết.
- Tự điều chỉnh kích thước theo pane.

Terminal phải hiển thị đúng Unicode, hỗ trợ nhập liệu theo hệ điều hành và giữ thao tác ổn định khi nhiều pane cùng xuất output.

### 10.2. CLI profile

XWork có sẵn profile cho:

- Codex.
- Claude.
- Terminal thường.

Người dùng có thể tạo CLI profile tùy chỉnh với:

- Tên.
- Lệnh khởi chạy.
- Tham số.
- Shell tùy chọn.
- Icon và màu nhận diện.
- Biến môi trường.

Working directory mặc định luôn là folder gốc project. Terminal dùng shell mặc định của hệ điều hành; người dùng có thể đổi shell mặc định chung hoặc chỉ định shell riêng trong từng profile.

### 10.3. CLI không khả dụng

Nếu lệnh của profile không được tìm thấy:

- Công cụ vẫn xuất hiện trên màn hình chọn nhưng ở trạng thái `Unavailable`.
- Giao diện giải thích `Command not found`.
- Có hành động mở phần CLI Profiles trong Settings.
- Có nút kiểm tra lại sau khi người dùng sửa cấu hình hoặc cài CLI.
- Không tạo terminal từ profile cho đến khi kiểm tra thành công.

## 11. File trong project

### 11.1. File Explorer

Trong mỗi phiên, người dùng có thể bật hoặc tắt một File Explorer phụ bên cạnh vùng tab/pane. File Explorer hỗ trợ:

- Mở và thu gọn folder.
- Tìm hoặc lọc theo tên file.
- Refresh cây file.
- Sao chép đường dẫn.
- Mở vị trí bằng trình quản lý file của hệ điều hành.
- Mở file trong XWork.

File Explorer không tạo, đổi tên, di chuyển hoặc xóa file/folder.

### 11.2. Mở file

- Bấm file mặc định mở file trong một tab mới.
- Menu phụ cho phép mở vào pane trống hoặc chia cạnh pane hiện tại.
- File source/text được mở ở chế độ chỉ đọc và có syntax highlighting.
- File binary hoặc file vượt giới hạn hỗ trợ hiển thị trạng thái không thể mở, cùng hành động mở bằng ứng dụng ngoài.

### 11.3. Markdown

File Markdown có hai chế độ riêng:

- `Edit` để chỉnh nội dung.
- `Preview` để xem nội dung đã render.

Không có chế độ Edit và Preview song song. XWork nhớ chế độ gần nhất khi file vẫn còn mở trong phiên.

Markdown dùng cơ chế lưu thủ công:

- Nút `Save` và phím `Ctrl/Cmd + S`.
- Tab có chỉ báo nội dung chưa lưu.
- Đóng tab, pane, phiên hoặc project khi còn thay đổi phải cảnh báo.
- Nếu file thay đổi từ bên ngoài trong lúc đang sửa, XWork yêu cầu chọn tải lại nội dung ngoài hoặc giữ nội dung hiện tại; không tự ghi đè âm thầm.

## 12. Notes

### 12.1. Mô hình note

- Note tồn tại độc lập ở phạm vi toàn ứng dụng.
- Một note có thể tùy chọn liên kết với một project.
- Note gồm tiêu đề và nội dung Markdown.
- Tiêu đề có thể để trống khi tạo bằng Quick Note.
- Nội dung được tự động lưu khi người dùng nhập.
- Note có hai chế độ `Edit` và `Preview`.

### 12.2. Trang Notes

Trang Notes dùng bố cục hai vùng:

- Bên trái: tìm kiếm, bộ lọc và danh sách note.
- Bên phải: editor hoặc preview của note đang chọn.

Danh sách note được tổ chức theo:

- Note ghim.
- Note chỉnh sửa gần đây.
- Tìm kiếm theo tiêu đề và nội dung.
- Lọc theo project liên kết.
- Khu vực lưu trữ và thùng rác.

Các thao tác note gồm:

- Tạo và sửa.
- Ghim hoặc bỏ ghim.
- Thêm, đổi hoặc bỏ project liên kết.
- Lưu trữ và khôi phục khỏi lưu trữ.
- Đưa vào thùng rác.
- Khôi phục, xóa vĩnh viễn hoặc dọn toàn bộ thùng rác.

Note trong thùng rác được giữ đến khi người dùng chủ động xóa vĩnh viễn.

### 12.3. Quick Note

Quick Note có hai điểm truy cập:

- Editor nhập trực tiếp trên Home.
- Cửa sổ nổi được mở bằng phím tắt toàn cục hoặc menu tray.

Cửa sổ nổi hiển thị trên ứng dụng người dùng đang làm việc và gồm:

- Tiêu đề tùy chọn.
- Nội dung Markdown.
- Project liên kết tùy chọn.
- `Save` và `Cancel`.

Lưu thành công sẽ đóng cửa sổ nổi và note xuất hiện trong trang Notes cũng như trên project liên kết, nếu có.

## 13. Calendar

### 13.1. Bố cục

Calendar gồm:

- Lịch tháng là chế độ xem chính.
- Panel lịch trình của ngày đang chọn.
- Danh sách `Upcoming`.
- Danh sách `Missed` cho reminder bị bỏ lỡ khi XWork đã thoát.
- Nút `New Event`.

Bấm một ngày sẽ chọn ngày đó, cập nhật panel lịch trình và cung cấp hành động tạo event với ngày đã điền sẵn. Bấm một event sẽ mở panel chi tiết để xem, sửa hoặc xóa.

### 13.2. Event

Event tồn tại ở phạm vi toàn ứng dụng và có thể tùy chọn liên kết với một project.

Form tạo/chỉnh sửa event gồm:

- Tiêu đề.
- Ngày và giờ bắt đầu–kết thúc, hoặc lựa chọn cả ngày.
- Mô tả.
- Project liên kết tùy chọn.
- Quy tắc lặp.
- Một hoặc nhiều mốc reminder.

Event hỗ trợ:

- Không lặp.
- Hằng ngày.
- Hằng tuần.
- Hằng tháng.
- Hằng năm.
- Kết thúc lặp theo ngày hoặc số lần.

Không có reminder độc lập bên ngoài event.

### 13.3. Reminder

Khi reminder đến hạn:

- XWork gửi thông báo hệ điều hành nếu event không đang hiện trên màn hình.
- Reminder đồng thời xuất hiện trong trung tâm thông báo của XWork.
- Người dùng có thể mở event, hoãn 5/10/30 phút hoặc bỏ qua.

Nếu reminder đến hạn khi XWork đã thoát hoàn toàn, lần mở sau reminder được đưa vào `Missed`. XWork không phát hàng loạt thông báo hệ điều hành cho các reminder này.

## 14. Tìm kiếm hợp nhất và Command Palette

Command Palette là một hộp tìm kiếm và chạy lệnh dùng được hoàn toàn bằng bàn phím.

Nó hỗ trợ:

- Tìm project theo tên hoặc đường dẫn.
- Tìm phiên đang tồn tại.
- Tìm note theo tiêu đề và nội dung.
- Tìm event.
- Tìm file trong project theo tên.
- Chạy các thao tác chính của ứng dụng.

Kết quả được nhóm theo loại, hiển thị ngữ cảnh liên quan và mở đúng màn hình hoặc đối tượng khi được chọn.

## 15. Thông báo

Biểu tượng chuông trên thanh trên cùng mở panel thông báo. Panel gồm:

- Reminder đến hạn hoặc bị bỏ lỡ.
- Terminal/AI CLI cần chú ý.
- Tiến trình nền đã kết thúc hoặc gặp lỗi.
- Trạng thái đã đọc/chưa đọc.

Mỗi thông báo có hành động mở đúng project, phiên hoặc event liên quan. Người dùng có thể đánh dấu đã đọc hoặc xóa thông báo.

Thông báo hệ điều hành chỉ được gửi có chọn lọc khi nội dung liên quan không đang hiển thị, tránh thông báo cho mọi output terminal.

## 16. System tray

Menu system tray gồm:

- `Open XWork`.
- `Quick Note`.
- Danh sách ngắn các phiên đang cần chú ý.
- `Quit XWork`.

Bấm một phiên trong tray mở cửa sổ chính và điều hướng trực tiếp đến phiên đó.

## 17. Settings

Settings được chia thành các khu vực sau:

### 17.1. General

- Ngôn ngữ giao diện; bản đầu tiên chỉ có English.
- Hành vi cửa sổ và system tray.
- Các tùy chọn chung không thuộc chức năng riêng.

### 17.2. Appearance

- `Light`, `Dark` hoặc theo hệ điều hành.
- Chọn theme dựng sẵn.
- Tùy chỉnh màu giao diện.
- Tùy chỉnh bảng màu terminal.
- Xem trước trực tiếp.
- Khôi phục theme mặc định.
- Điều chỉnh cỡ chữ giao diện và terminal.

### 17.3. Terminal & CLI Profiles

- Chọn shell mặc định.
- Xem trạng thái profile Codex, Claude và Terminal.
- Tạo, sửa và xóa CLI profile tùy chỉnh.
- Kiểm tra lại lệnh của profile.

### 17.4. Keyboard Shortcuts

- Xem và tìm thao tác.
- Đổi phím tắt cho Quick Note, điều hướng project/phiên/tab, tab, pane, tìm kiếm và Command Palette.
- Cảnh báo khi hai thao tác dùng phím xung đột.
- Khôi phục một phím hoặc toàn bộ phím mặc định.

### 17.5. Notifications

- Bật/tắt thông báo cho terminal/AI CLI.
- Bật/tắt thông báo event/reminder.
- Chọn loại trạng thái CLI đủ điều kiện gửi thông báo hệ điều hành.

### 17.6. Data

- Xuất dữ liệu cấu hình XWork ra một gói sao lưu cục bộ.
- Nhập gói sao lưu để khôi phục project metadata, note, event, CLI profile, theme, phím tắt và settings.
- Hiển thị vị trí dữ liệu XWork.
- Reset ứng dụng sau bước xác nhận rõ ràng.

Gói sao lưu không chứa source project, phiên runtime, terminal output hoặc lịch sử CLI.

### 17.7. About

- Tên và phiên bản XWork.
- Thông tin hệ điều hành liên quan đến hỗ trợ.
- Liên kết tài liệu, license và nơi báo lỗi khi được phát hành public source.

## 18. Yêu cầu tương tác chung

- Mọi icon không có nhãn phải có tooltip.
- Thành phần đang focus phải có chỉ báo rõ ràng.
- Các thao tác chính phải dùng được bằng bàn phím.
- Màu chữ, nền và trạng thái phải có độ tương phản đủ để phân biệt.
- Người dùng có thể tăng hoặc giảm cỡ chữ giao diện và terminal.
- Trạng thái rỗng phải giải thích ngắn nội dung và đưa ra hành động tiếp theo.
- Trạng thái lỗi phải nói rõ đối tượng gặp lỗi và cung cấp hành động khắc phục khi có thể.
- Hành động phá hủy phải dùng nhãn cụ thể như `Remove Project`, `Delete Note` hoặc `Quit`, không dùng nhãn chung chung.
- Các thao tác kéo thả phải có phương án tương đương bằng menu hoặc bàn phím.

## 19. Danh sách wireframe cần có

### 19.1. Khung ứng dụng

1. Welcome lần đầu sử dụng.
2. Application shell với sidebar đầy đủ.
3. Sidebar thu gọn dạng icon.
4. Command Palette và nhóm kết quả.
5. Notification panel.
6. Menu system tray.
7. Settings và từng khu vực con.

### 19.2. Home

1. Home trạng thái chưa có dữ liệu.
2. Home hoàn chỉnh với Quick Note, note ghim/gần đây và cột thông tin phụ.
3. Trạng thái lưu Quick Note thành công hoặc không hợp lệ.

### 19.3. Project và phiên

1. Projects dạng lưới card.
2. Add Project qua folder picker.
3. Project Overview đầy đủ.
4. Project không khả dụng.
5. Project mở rộng trên sidebar với nhiều phiên.
6. New Session với màn hình chọn công cụ.
7. Công cụ/CLI profile không khả dụng.
8. Phiên có nhiều tab và bố cục 1–4 pane.
9. Pane chọn nội dung.
10. Cảnh báo xóa phiên, gỡ project và Quit XWork.

### 19.4. File

1. Phiên với File Explorer đang mở.
2. Source viewer chỉ đọc.
3. Markdown ở chế độ Edit.
4. Markdown ở chế độ Preview.
5. File chưa lưu.
6. File thay đổi từ bên ngoài.
7. File không được hỗ trợ hoặc quá lớn.

### 19.5. Notes

1. Notes với danh sách và editor song song.
2. Note ở chế độ Preview.
3. Bộ lọc project và kết quả tìm kiếm.
4. Notes Archive.
5. Notes Trash.
6. Cửa sổ Quick Note nổi.

### 19.6. Calendar

1. Calendar tháng với panel lịch trình.
2. Danh sách Upcoming.
3. Danh sách Missed.
4. Form New/Edit Event.
5. Panel chi tiết event.
6. Notification reminder với hành động mở, hoãn và bỏ qua.

## 20. Tiêu chí hoàn thành theo phase

### Phase 1 — Project và Terminal

- Người dùng thêm được folder có sẵn và quản lý project mà không ảnh hưởng dữ liệu trên ổ đĩa.
- Project hiển thị Git status ở chế độ đọc.
- Người dùng tạo nhiều phiên runtime cho nhiều project và chuyển qua lại mà tiến trình tiếp tục chạy.
- Một tab có thể chia ngang/dọc tối đa 4 pane và resize.
- Codex, Claude, Terminal và CLI profile tùy chỉnh khởi chạy tại folder gốc project.
- Đóng cửa sổ đưa ứng dụng xuống tray; Quit cảnh báo và không khôi phục phiên ở lần mở sau.

### Phase 2 — File

- Người dùng duyệt và tìm file trong File Explorer phụ.
- Source được hiển thị chỉ đọc với syntax highlighting.
- Markdown chuyển được giữa Edit và Preview, lưu thủ công và cảnh báo khi chưa lưu.
- File thay đổi bên ngoài, file binary và file quá lớn đều có trạng thái rõ ràng.

### Phase 3 — Note

- Người dùng tạo, tìm, ghim, liên kết project, lưu trữ và xóa note.
- Nội dung Markdown của note tự động lưu.
- Quick Note hoạt động từ Home, phím tắt toàn cục và tray.
- Note trong thùng rác chỉ bị xóa vĩnh viễn khi người dùng chủ động thực hiện.

### Phase 4 — Calendar

- Người dùng xem lịch tháng, lịch trình theo ngày, Upcoming và Missed.
- Event hỗ trợ thời gian, cả ngày, project liên kết, lặp và nhiều reminder.
- Reminder xuất hiện trong XWork và qua thông báo hệ điều hành theo đúng trạng thái nền.
- Reminder đến hạn khi ứng dụng đã thoát được đưa vào Missed ở lần mở sau.
