# FE-012 — Settings Appearance

Tài liệu này đặc tả contract frontend cho mục `Appearance` của Settings: chọn chế độ sáng/tối, chọn theme dựng sẵn, sửa màu giao diện và bảng màu terminal, chỉnh cỡ chữ giao diện/terminal, xem trước trực tiếp trên toàn ứng dụng và khôi phục theme mặc định. Tài liệu cũng đặc tả lớp áp dụng theme cho toàn bộ cửa sổ, vì đây là nơi đầu tiên trong repo biến snapshot Appearance thành giao diện thật.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-012` |
| Phase | `1` |
| Khu vực chính | `src/features/settings/` |
| Yêu cầu chức năng | `§17.2`; yêu cầu tương tác chung `§18`, đặc biệt là độ tương phản và khả năng tăng/giảm cỡ chữ giao diện lẫn terminal |
| Wireframe | `01-Wireframe/02-AppShell.html#settings-appearance` |
| Backend liên quan | `BE-008` cho `get_settings`, `update_settings` và `restore_appearance_defaults` |
| Phụ thuộc | `FE-011` phải hoàn thành trước; `BE-008` đã triển khai và `src/bindings/settings.ts` đã được sinh |

## Mục tiêu

Người dùng mở `Settings › Appearance`, chọn `Light`/`Dark`/`System`, chọn một trong ba theme dựng sẵn, chỉnh bốn màu giao diện của từng chế độ, chỉnh nền/chữ và 16 màu ANSI của terminal, chỉnh cỡ chữ giao diện và terminal; mọi thay đổi hiển thị ngay trên toàn cửa sổ và được lưu bền vững. Một nút `Restore default theme` đưa toàn bộ Appearance về mặc định. Sau khi mở lại ứng dụng, giao diện khởi động đúng theme đã lưu.

### Quyết định và giả định đã chốt

- `Interface text size` được áp dụng bằng cách phóng to toàn bộ giao diện: `document.documentElement.style.zoom` nhận tỉ lệ `interfaceFontSizePx / 14`. Toàn repo đang ghi cỡ chữ bằng px cố định (`text-[13px]`, `text-[28px]`), nên đổi `font-size` của `body` gần như không có tác dụng; chuyển toàn bộ sang `rem` nằm ngoài phạm vi FE-012 và sẽ phá layout của các feature đã hoàn thành. Hệ quả được chấp nhận: đây là một thang phóng giao diện, chữ và khoảng cách phóng cùng nhau.
- `Terminal text size` nằm trong cùng không gian pixel CSS đã phóng đó. `--terminal-font-size` không chia lại cho `--ui-scale`; hai control là tỉ lệ tương đối giữa giao diện và terminal, không phải kích thước vật lý.
- Màu được sửa bằng một `<input type="color">` (hộp chọn màu sẵn có của WebView2) đi kèm một ô nhập hex `#rrggbb`. Không thêm dependency color picker; không tự viết panel HSV.
- Khối `Interface colours` có một nút gạt `Light`/`Dark` chọn đang sửa bộ màu nào, mặc định là bộ của chế độ đang có hiệu lực. Backend lưu hai bộ riêng nên người dùng phải sửa được cả hai mà không cần đổi `Theme`.
- `index.css` giữ hai bảng token viết sẵn cho Light và Dark. Bốn màu người dùng chọn ghi đè trực tiếp `--color-canvas`, `--color-sidebar`, `--color-ink` và `--color-brand`; các token phụ (`surface-card`, `hairline`, `body`, `muted`, …) được suy ra bằng `color-mix()` theo công thức cố định trong `appearance-theme.ts`. Token ngữ nghĩa cố định (`success`, `warning`, `error`, `overlay`, shadow) có giá trị riêng cho Dark trong CSS chứ không suy ra từ bốn màu.
- Chọn preset **không** có preview cục bộ. Frontend không sở hữu bảng màu của `cream`/`ink`/`paper`; một cú bấm preset gọi thẳng `update_settings` và toàn ứng dụng vẽ lại từ snapshot trả về. `PRESET_CARDS` chỉ giữ hai ô màu minh họa cố định cho mỗi card, đúng như wireframe, và là dữ liệu trình bày; sai lệch với backend chỉ ảnh hưởng hình minh họa, không ảnh hưởng màu thật.
- Sửa màu và kéo slider có preview cục bộ tức thì rồi commit sau một khoảng lặng `300 ms`; rời trang hoặc unmount sẽ flush ngay commit đang chờ.
- Frontend kiểm tra trước độ tương phản theo đúng bốn quy tắc của `BE-008` (`text/canvas` ≥ 4.5, `text/sidebar` ≥ 4.5, `accent/canvas` ≥ 3, `terminal foreground/background` ≥ 4.5) và không gửi request khi vi phạm. Đây là bản sao để phản hồi tức thì; backend vẫn là nơi quyết định cuối cùng và lỗi `contrast_too_low` trả về vẫn phải hiển thị được.
- Lệnh đọc settings lúc khởi động ứng dụng đặt tại `src/main.tsx` qua `bootstrapAppSettings()`, không đặt trong component áp theme. Nhờ vậy các component test đang render `AppProviders` (`app-shell`, `app-sidebar`, `app-topbar`, `app-router`, `projects-route`) không phát sinh lời gọi IPC mới.
- `AppearanceThemeSync` là component chỉ có side effect, render `null`, được `AppProviders` mount đúng một lần. Nó đọc `appearanceDraft ?? snapshot.appearance` nên preview và giá trị đã lưu đi qua cùng một đường.
- Khi chưa có snapshot, `AppearanceThemeSync` chỉ đặt `data-theme` và `color-scheme` theo `prefers-color-scheme`, không ghi biến màu nào. Mặc định của backend là `system` + `cream` nên bảng token viết sẵn trong CSS đã là kết quả đúng cho đa số trường hợp và không có nhấp nháy đổi màu.
- Nút `Restore default theme` không có hộp thoại xác nhận, đúng như wireframe. Nhãn đã cụ thể theo `§18` và hành động chỉ ảnh hưởng theme, không xóa dữ liệu người dùng.
- `Slider` được sao chép vào `src/components/ui/` theo shadcn/ui, dùng primitive `Slider` của package `radix-ui` đã có trong repo. Lát cắt này không thêm dependency npm hoặc crate nào.
- Segmented control và card preset là control riêng của mục Appearance nên nằm trong feature, không nâng lên `src/components/`.

### Ngoài phạm vi

- Nối `sidebar.widthPx`/`sidebar.collapsed` vào settings persistence: đó là phần mở rộng `FE-001` trong cùng giai đoạn 6.
- Mọi mục Settings khác: `FE-013`, `FE-014`, `FE-015`, `FE-023`; trang `General`/`About` thuộc `FE-011`.
- Terminal thật, WTerm và việc terminal tiêu thụ `--terminal-*`: thuộc `FE-008`. FE-012 chỉ công bố token và một khối xem trước tĩnh.
- Thêm preset thứ tư, đặt tên hoặc lưu nhiều theme tùy chỉnh.
- Đổi cỡ chữ bằng phím tắt toàn cục hoặc `Ctrl` + con lăn: thuộc `FE-014`.
- Chuyển cỡ chữ hardcode của các feature đã hoàn thành sang `rem`.
- Đồng bộ theme sang cửa sổ Quick Note: cửa sổ đó chỉ xuất hiện ở `FE-020`/`BE-017`.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/settings/settings-appearance-route.tsx` | Trang `Appearance`: header kèm `Restore default theme`, sáu hàng thiết lập, trạng thái tải/lỗi đọc và lỗi ghi. |
| `src/features/settings/use-appearance-editor.ts` | Hook điều phối chỉnh sửa: dựng giá trị preview, kiểm tra hex và tương phản cục bộ, gom commit theo khoảng lặng, flush khi unmount. |
| `src/features/settings/appearance-theme.ts` | Hàm thuần dựng tập biến CSS và thuộc tính gốc từ `AppearanceSettingsDto` cùng chế độ có hiệu lực; chứa công thức `color-mix()` cho token phụ và cách chọn `--color-on-primary`. |
| `src/features/settings/appearance-theme-sync.tsx` | Component không giao diện, ghi/gỡ biến CSS, `data-theme`, `color-scheme` và `zoom` trên `document.documentElement` theo state hiện tại. |
| `src/features/settings/appearance-contrast.ts` | Tính tỉ lệ tương phản WCAG trên sRGB và liệt kê các cặp vi phạm theo đúng ngưỡng của `BE-008`. |
| `src/features/settings/appearance-color-field.tsx` | Một dòng chỉnh màu: nhãn, `<input type="color">`, ô nhập hex, thông báo lỗi hex/tương phản của riêng dòng đó. |
| `src/features/settings/appearance-segmented.tsx` | Segmented control dạng `radiogroup` dùng cho `Theme` và cho nút gạt `Light`/`Dark` của khối màu giao diện. |
| `src/features/settings/appearance-preset-cards.tsx` | Ba card preset dạng `radiogroup`, ô màu minh họa cố định, dấu tích ở card đang chọn và nhãn trạng thái `Custom`. |
| `src/features/settings/appearance-terminal-preview.tsx` | Khối xem trước terminal tĩnh dùng nền, chữ và các chỉ số ANSI đang chọn. |
| `src/features/settings/use-effective-color-scheme.ts` | Hook trả về `"light"`/`"dark"` từ `themeMode` và `prefers-color-scheme`, có đăng ký và hủy đăng ký media query. |
| `src/features/settings/settings-store.ts` | Mở rộng store hiện có: draft Appearance, trạng thái ghi, hàng đợi commit một-tại-một-thời-điểm, `bootstrapAppSettings`. |
| `src/features/settings/settings-error-copy.ts` | Bổ sung phân loại lỗi cho thao tác ghi: thông điệp, có retry được hay không và có phải bỏ draft hay không. |
| `src/features/settings/settings-section.tsx` | Bổ sung biến thể xếp dọc của `SettingRow` cho hai hàng màu chiếm trọn chiều rộng. |
| `src/features/settings/settings-test-fixture.ts` | Bổ sung tham số ghi đè phần `appearance` cho fixture snapshot dùng chung. |
| `src/lib/ipc/settings.ts` | Bổ sung wrapper `updateSettings` và `restoreAppearanceDefaults`. |
| `src/components/ui/slider.tsx` | Component slider sao chép từ shadcn/ui cho hai hàng cỡ chữ. |
| `src/index.css` | Bảng token Light/Dark viết sẵn, token terminal, `--ui-scale`, và `color-scheme` theo `data-theme`. |
| `src/app/app-providers.tsx` | Mount `AppearanceThemeSync` đúng một lần cho toàn ứng dụng. |
| `src/app/app-router.tsx` | Trỏ route `/settings/appearance` sang `SettingsAppearanceRoute` thay cho placeholder. |
| `src/main.tsx` | Gọi `bootstrapAppSettings()` trước khi render để theme đã lưu được áp dụng ngay từ lần vẽ đầu tiên. |
| `src/test-setup.ts` | Bổ sung stub `window.matchMedia` cho jsdom. |
| `src/features/settings/settings-appearance-route.test.tsx` | Test trang: sáu hàng, chọn chế độ/preset, sửa màu, slider, restore, các trạng thái tải/lỗi. |
| `src/features/settings/use-appearance-editor.test.ts` | Test hook: preview tức thì, gom commit theo khoảng lặng, flush khi unmount, chặn commit khi tương phản không đạt. |
| `src/features/settings/appearance-theme.test.ts` | Test hàm dựng biến: ghi đè bốn màu, công thức token phụ, chọn `--color-on-primary`, token terminal, `--ui-scale`. |
| `src/features/settings/appearance-theme-sync.test.tsx` | Test side effect: ghi đúng thuộc tính lên phần tử gốc, ưu tiên draft, dọn sạch khi unmount, không ghi màu khi chưa có snapshot. |
| `src/features/settings/appearance-contrast.test.ts` | Test tỉ lệ tương phản tại giá trị biên và danh sách cặp vi phạm. |
| `src/features/settings/appearance-color-field.test.tsx` | Test dòng màu: đồng bộ hai control, chuẩn hóa hex, chặn hex sai, hiển thị lỗi. |
| `src/features/settings/use-effective-color-scheme.test.ts` | Test hook: ba chế độ, phản ứng khi media query đổi, hủy đăng ký. |
| `src/features/settings/settings-store.test.ts` | Bổ sung: draft, hàng đợi commit, thay snapshot sau khi ghi thành công, quy tắc giữ hoặc bỏ draft theo mã lỗi. |
| `src/lib/ipc/settings.test.ts` | Bổ sung: tên command, payload patch và ánh xạ lỗi typed của hai wrapper mới. |
| `src/app/app-router.test.tsx` | Bổ sung: `/settings/appearance` render trang thật; bỏ dòng kiểm tra placeholder `FE-012`. |

Feature không thêm dependency npm hoặc crate, không sửa `src/bindings/`, không sửa `src-tauri/`, không thêm capability và không đổi `tauri.conf.json`.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `SettingsAppearanceRoute` | Trang nằm trong `Outlet` của khung Settings: tiêu đề `Appearance` cùng nút `Restore default theme` trên một hàng, dòng mô tả, rồi sáu `SettingRow`. | `#settings-appearance` |
| `AppearanceSegmented` | Nhóm nút liền khối `role="radiogroup"`; dùng cho `Theme` với ba lựa chọn `Light`, `Dark`, `System` và cho nút gạt hai lựa chọn `Light`/`Dark` của khối màu giao diện. | `#settings-appearance` |
| `AppearancePresetCards` | Lưới ba card `Cream`, `Ink`, `Paper`; mỗi card có hai ô màu minh họa xếp chồng, tên preset và dấu tích khi đang chọn. | `#settings-appearance` |
| `AppearanceColorField` | Một dòng màu: nhãn bên trái; bên phải là ô màu vuông (`<input type="color">`) và ô nhập hex chữ mono; lỗi của dòng hiển thị ngay dưới. | `#settings-appearance` |
| `AppearanceTerminalPreview` | Khối xem trước cao `96px`, bo góc, nền và chữ lấy từ bảng màu đang chọn, cỡ chữ theo `terminalFontSizePx`, nội dung mẫu cố định. | `#settings-appearance` |
| `Slider` | Thanh trượt số nguyên cho hai hàng cỡ chữ, đi kèm số đọc dạng mono rộng `40px` bên trái. | `#settings-appearance` |
| `SettingRow` biến thể xếp dọc | Hai hàng `Interface colours` và `Terminal palette` cho control chiếm trọn chiều rộng cột phải và canh trên thay vì canh giữa. | `#settings-appearance` |

Nội dung văn bản lấy nguyên văn wireframe: dòng mô tả trang là `Theme, colours and text size. Changes preview live in the window behind this panel.`; các nhãn và dòng phụ là `Theme` / `Follow the operating system or pin one mode.`, `Preset` / `Pick a starting point, then adjust colours below.`, `Interface colours` / `Accent is used for primary actions only.`, `Terminal palette` / `Background, foreground and the 16 ANSI colours.`, `Interface text size`, `Terminal text size`. Bốn nhãn màu giao diện là `Accent`, `Canvas`, `Sidebar`, `Text`; hai nhãn màu terminal là `Background`, `Foreground`; 16 màu còn lại có nhãn `ANSI 0` … `ANSI 15`.

Nội dung mẫu của khối xem trước terminal, đúng ba dòng của wireframe:

```text
PS F:\Self Projects\XWork> pnpm test
 ✓ project-card.test.tsx (6)   ⚠ 1 skipped   ✗ 0 failed
PS F:\Self Projects\XWork> ▮
```

Ánh xạ màu của khối xem trước: dấu nhắc dùng `ansiColors[12]`, dấu `✓` dùng `ansiColors[2]`, dấu `⚠` dùng `ansiColors[3]`, dấu `✗` dùng `ansiColors[1]`, phần `(6)` dùng `ansiColors[8]`, con trỏ và chữ còn lại dùng `foreground`, nền dùng `background`.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| `Đang tải` | `status` của store là `idle` hoặc `loading`. | Tiêu đề, dòng mô tả và nút `Restore default theme` (bị khóa) vẫn hiển thị; vùng hàng hiển thị `Loading settings…` với `aria-busy="true"`; không render control nào. |
| `Sẵn sàng` | `status === "ready"` và có snapshot. | Sáu hàng hiển thị giá trị từ `appearanceDraft ?? snapshot.appearance`. |
| `Lỗi đọc` | `status === "error"`. | Thông điệp từ `classifySettingsFailure` trong một vùng `role="alert"`, kèm nút `Try again` khi lỗi cho phép; lỗi không retry được chỉ có thông điệp yêu cầu khởi động lại XWork. Không control nào được render. |
| `Đang lưu` | `saveStatus === "saving"`. | Control vẫn dùng được và vẫn phản ánh draft; một dòng `Saving…` trong vùng `aria-live="polite"` cạnh tiêu đề; nút `Restore default theme` bị khóa cho đến khi request kết thúc. |
| `Lỗi ghi giữ lại chỉnh sửa` | `saveStatus === "error"` với mã `invalid_color`, `contrast_too_low`, `persistence_failed` hoặc `unavailable`. | Vùng `role="alert"` dưới header nêu thông điệp; draft được giữ nguyên nên người dùng thấy đúng giá trị vừa nhập. Với `persistence_failed` và `unavailable` có thêm nút `Try again` gửi lại đúng patch vừa hỏng. Với `invalid_color` và `contrast_too_low`, thông điệp lỗi còn hiện cạnh nhóm màu tương ứng theo `field` mà backend trả về. |
| `Lỗi ghi bỏ chỉnh sửa` | `saveStatus === "error"` với mã `value_out_of_range`, `invalid_preset_combination`, `empty_patch`, `unauthorized_window`, `corrupt_stored_settings` hoặc `unknown`. | Draft bị bỏ, control quay về snapshot đã commit gần nhất, vùng `role="alert"` nêu thông điệp và khoảng giá trị hợp lệ khi backend có trả `min`/`max`; không có nút `Try again`. |
| `Tương phản không đạt` | Kiểm tra cục bộ tìm thấy cặp vi phạm trong bộ màu đang sửa. | Preview vẫn áp dụng để người dùng thấy vấn đề; không gửi request nào; dòng lỗi hiện dưới nhóm màu, nêu cặp màu và ngưỡng bắt buộc; các hàng khác vẫn commit bình thường. |
| `Preset tùy chỉnh` | `themePreset === "custom"`. | Không card nào ở trạng thái chọn; dưới lưới card hiện dòng `Custom colours`. |
| `Rỗng` | Không xảy ra. | Appearance luôn có đúng sáu hàng do backend bảo đảm trả đủ snapshot, nên feature không có trạng thái rỗng riêng. |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Bấm `Light`, `Dark` hoặc `System` ở hàng `Theme` | Preview ngay và commit ngay `{ appearance: { themeMode } }`; toàn cửa sổ đổi chế độ; nút gạt của khối màu giao diện chuyển theo chế độ mới nếu người dùng chưa tự chọn bộ khác. | `←` / `→` di chuyển trong nhóm, `Space` chọn |
| Bấm một card preset | Không preview cục bộ; gọi ngay `{ appearance: { themePreset } }` và vẽ lại toàn ứng dụng từ snapshot trả về; card đang chọn có dấu tích. | `←` / `→` di chuyển trong nhóm, `Space` chọn |
| Bấm `Light`/`Dark` trong khối `Interface colours` | Chỉ đổi bộ màu đang được chỉnh; không gửi request và không đổi `themeMode`. | `←` / `→`, `Space` |
| Đổi màu bằng ô màu | Preview cập nhật liên tục theo từng bước kéo; commit `{ appearance: { interfaceColors } }` hoặc `{ appearance: { terminalPalette } }` sau `300 ms` không thao tác, hoặc ngay khi hộp chọn màu đóng. | `Enter` / `Space` mở hộp chọn màu |
| Gõ hex vào ô nhập | Chuỗi chưa đủ `#rrggbb` chỉ ở trong ô, không preview và không commit; khi đủ và hợp lệ thì preview ngay và commit theo cùng quy tắc khoảng lặng; hex sai định dạng hiển thị lỗi dòng khi rời ô. | `Enter` xác nhận và commit ngay, `Esc` trả ô về giá trị hiện hành |
| Kéo hoặc bấm phím trên slider cỡ chữ | Preview ngay từng bước `1 px`; commit `{ appearance: { interfaceFontSizePx } }` hoặc `{ appearance: { terminalFontSizePx } }` sau `300 ms` không thao tác. | `←`/`→` ±1, `Home`/`End` về hai đầu khoảng |
| Bấm `Restore default theme` | Gọi `restore_appearance_defaults`, bỏ draft, thay snapshot bằng kết quả và vẽ lại toàn ứng dụng về `system` + `cream` + `14 px` + `13 px`. | `Không có` |
| Bấm `Try again` khi lỗi đọc | Gọi lại `get_settings`; nút bị khóa trong lúc gọi và vùng nội dung quay về trạng thái đang tải. | `Không có` |
| Bấm `Try again` khi lỗi ghi retry được | Gửi lại đúng patch vừa hỏng; nút bị khóa trong lúc gọi. | `Không có` |
| Rời trang Appearance khi còn commit đang chờ | Commit được flush ngay lập tức; không mất thay đổi cuối. | `Không có` |
| Rời trang Appearance khi draft đang vi phạm tương phản | Draft bị bỏ và giao diện quay về theme đã commit, vì giá trị đó không thể lưu. | `Không có` |
| Đổi chế độ sáng/tối của hệ điều hành khi `themeMode === "system"` | Toàn ứng dụng đổi theo ngay, không gọi backend và không tạo revision mới. | `Không có` |

## Luồng chính

1. `src/main.tsx` gọi `bootstrapAppSettings()` trước khi render: hàm này giữ khu vực Settings cho suốt vòng đời ứng dụng và gọi `load()` một lần.
2. `AppProviders` mount `AppearanceThemeSync`. Trong lúc chờ snapshot, component chỉ đặt `data-theme` và `color-scheme` theo `prefers-color-scheme`, nên cửa sổ dùng đúng bảng token viết sẵn của `index.css`.
3. Khi `get_settings` trả về, `AppearanceThemeSync` tính chế độ có hiệu lực, dựng tập biến CSS bằng `buildAppearanceStyle` rồi ghi lên `document.documentElement` cùng `zoom`.
4. Người dùng mở `/settings/appearance`. `SettingsRoute` thấy store không còn ở `idle` nên không gọi lại `get_settings`; trang đọc thẳng từ store.
5. Một thao tác chỉnh sửa gọi `previewAppearance(next)`. Draft thay đổi, `AppearanceThemeSync` ghi lại biến CSS ngay, nên cả cửa sổ phía sau panel đổi theo đúng yêu cầu "preview live" của wireframe.
6. `use-appearance-editor` kiểm tra hex và tương phản trên giá trị mới. Nếu vi phạm thì dừng ở bước preview và hiển thị lỗi cục bộ. Nếu hợp lệ, hook hẹn commit sau `300 ms` không thao tác.
7. `commitAppearance(patch)` chỉ cho một request bay tại một thời điểm. Gọi mới trong lúc đang bay được ghi nhận là patch chờ, gộp theo từng section; khi request hiện tại kết thúc, patch chờ mới nhất được gửi tiếp.
8. `update_settings` trả về snapshot mới. Store thay `snapshot`, xóa `appearanceDraft`, đặt `saveStatus` về `idle`. Vì snapshot trả về đã chuẩn hóa hex về chữ thường và có thể đã đổi `themePreset` thành `custom`, giao diện luôn hiển thị đúng trạng thái backend công nhận.
9. Nếu command lỗi, store đặt `saveStatus === "error"` cùng `saveErrorCode`, rồi giữ hoặc bỏ draft theo bảng trạng thái ở trên.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `get_settings` | Không có | `AppSettingsDto` | Giữ nguyên cách xử lý của `FE-011`: `unavailable` và `persistence_failed` hiển thị thông điệp kèm `Try again`; `corrupt_stored_settings` hiển thị lỗi dữ liệu không retry được; các mã còn lại và rejection không nhận dạng được coi là lỗi tích hợp không retry được. |
| `update_settings` | `UpdateSettingsDto` chỉ chứa `appearance`; FE-012 không gửi `sidebar` | `AppSettingsDto` | `invalid_color`: nêu lỗi cạnh nhóm màu chứa `field`, giữ draft. `contrast_too_low`: nêu cặp `foreground`/`background` cạnh nhóm màu, giữ draft. `value_out_of_range`: bỏ draft, đưa control về snapshot và nêu khoảng `min`–`max`. `invalid_preset_combination` và `empty_patch`: lỗi tích hợp, bỏ draft, không retry. `unauthorized_window`: lỗi tích hợp, bỏ draft, không retry. `persistence_failed` và `unavailable`: giữ draft, cho `Try again`. `corrupt_stored_settings` và rejection không mang `code` nhận biết được: lỗi tích hợp, bỏ draft. |
| `restore_appearance_defaults` | Không có | `AppSettingsDto` | `unauthorized_window` và `corrupt_stored_settings`: lỗi tích hợp, không retry. `persistence_failed` và `unavailable`: thông điệp kèm `Try again`. Các mã còn lại không thể xảy ra với lệnh không có input và được xử lý như lỗi tích hợp. |

Giá trị `field` của `invalid_color` và `value_out_of_range`, cùng `foreground`/`background` của `contrast_too_low`, dùng đúng đường dẫn mà `BE-008` phát ra: `interfaceColors.light.<accent|canvas|sidebar|text>`, `interfaceColors.dark.<...>`, `terminalPalette.background`, `terminalPalette.foreground`, `terminalPalette.ansiColors.<0-15>`, `interfaceFontSizePx`, `terminalFontSizePx`. UI ánh xạ tiền tố đường dẫn về đúng nhóm màu; đường dẫn không nhận dạng được chỉ hiển thị thông điệp chung ở vùng lỗi của trang.

Quy tắc patch bắt buộc tuân theo `BE-008`: một patch chứa `themePreset` khác `custom` không được kèm `interfaceColors` hoặc `terminalPalette`; gửi `interfaceColors` hoặc `terminalPalette` sẽ tự đặt preset thành `custom` ở backend nên frontend không gửi kèm `themePreset` trong trường hợp đó. Patch tổng và mỗi object patch phải có ít nhất một field.

### Event / Channel đăng ký

Không có. `BE-008` không phát event ở Phase 1; snapshot mới luôn đến qua giá trị trả về của command.

## State frontend

```ts
// Trạng thái ghi Appearance, nằm cùng store snapshot của FE-011.
type SettingsSaveStatus = "idle" | "saving" | "error";

// Bổ sung vào SettingsState đã có (status, snapshot, errorCode, load).
interface AppearanceSettingsState {
  appearanceDraft: AppearanceSettingsDto | null;
  saveStatus: SettingsSaveStatus;
  saveErrorCode: SettingsErrorCode | null;
  lastFailedPatch: AppearanceSettingsPatchDto | null;
  previewAppearance(next: AppearanceSettingsDto): void;
  commitAppearance(patch: AppearanceSettingsPatchDto): Promise<void>;
  restoreAppearance(): Promise<void>;
  discardAppearanceDraft(): void;
}

// Đọc snapshot một lần cho toàn ứng dụng khi khởi động.
function bootstrapAppSettings(): void;

// Chế độ thật sự đang được vẽ, sau khi đã hỏi hệ điều hành cho "system".
type EffectiveColorScheme = "light" | "dark";

// Kết quả kiểm tra tương phản cục bộ của một cặp màu bắt buộc.
interface ContrastViolation {
  foregroundField: string;
  backgroundField: string;
  required: number;
  actual: number;
}

// Bề mặt chỉnh sửa mà trang Appearance dùng.
interface AppearanceEditor {
  appearance: AppearanceSettingsDto;
  editedScheme: EffectiveColorScheme;
  violations: readonly ContrastViolation[];
  invalidHexFields: readonly string[];
  setEditedScheme(next: EffectiveColorScheme): void;
  setThemeMode(next: ThemeModeDto): void;
  setPreset(next: Exclude<ThemePresetDto, "custom">): void;
  setInterfaceColor(key: keyof InterfaceColorsDto, hex: string): void;
  setTerminalColor(key: "background" | "foreground" | `ansi:${number}`, hex: string): void;
  setInterfaceFontSizePx(next: number): void;
  setTerminalFontSizePx(next: number): void;
  flushPendingCommit(): void;
}

// Đầu ra thuần của lớp áp theme.
interface AppearanceDocumentStyle {
  dataTheme: EffectiveColorScheme;
  colorScheme: EffectiveColorScheme;
  zoom: string;
  variables: Readonly<Record<string, string>>;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `snapshot` | Backend qua `get_settings`, `update_settings`, `restore_appearance_defaults` | Luôn thay toàn bộ bằng DTO backend trả về; không vá từng phần ở frontend và không ghi vào bất kỳ storage nào của webview. |
| `appearanceDraft` | UI tạm thời | Chỉ tồn tại giữa lúc người dùng chỉnh và lúc backend xác nhận; bị xóa sau khi commit thành công và bị bỏ theo bảng lỗi. Không bao giờ là nguồn dữ liệu lâu dài. |
| `saveStatus`, `saveErrorCode`, `lastFailedPatch` | UI tạm thời | Mô tả đúng một lần ghi gần nhất; bị xóa khi một lần ghi thành công hoặc khi người dùng chỉnh sửa tiếp. |
| `editedScheme` | UI tạm thời của trang | Mặc định theo chế độ có hiệu lực và chỉ đổi khi người dùng bấm nút gạt; không gửi lên backend. |
| `violations`, `invalidHexFields` | Tính từ giá trị đang chỉnh | Không lưu; tính lại mỗi lần render bằng hàm thuần. |
| Chế độ hệ điều hành | `window.matchMedia("(prefers-color-scheme: dark)")` | Chỉ đọc; không lưu, đúng theo quyết định của `BE-008` là không ghi lại chế độ hiện hành của OS. |

## Contract công khai của feature

```ts
// Nội dung mục Appearance, gắn vào route `/settings/appearance`.
export function SettingsAppearanceRoute(): JSX.Element

// Áp theme đã lưu hoặc đang preview lên toàn cửa sổ. Mount đúng một lần trong `AppProviders`.
export function AppearanceThemeSync(): null

// Đọc snapshot settings một lần khi ứng dụng khởi động.
export function bootstrapAppSettings(): void
```

`src/app/` chỉ được dùng ba export trên cùng các export sẵn có của `FE-011`. `useAppearanceEditor`, `buildAppearanceStyle`, `contrastRatio`, `AppearanceColorField`, `AppearanceSegmented`, `AppearancePresetCards`, `AppearanceTerminalPreview`, `useEffectiveColorScheme` và `PRESET_CARDS` là nội bộ feature; feature khác không import chúng. `FE-008` sẽ tiêu thụ theme terminal qua các biến CSS `--terminal-*` chứ không import code của mục Settings.

## Token và công thức theme

`index.css` giữ hai bảng giá trị viết sẵn. Khối `:root` là bảng Light hiện có; khối `:root[data-theme="dark"]` định nghĩa lại `--color-canvas`, `--color-surface-soft`, `--color-surface-card`, `--color-cream-strong`, `--color-hairline`, `--color-hairline-soft`, `--color-ink`, `--color-body-strong`, `--color-body`, `--color-muted`, `--color-muted-soft`, `--color-brand`, `--color-brand-active`, `--color-brand-disabled`, `--color-success`, `--color-warning`, `--color-error`, `--color-teal`, `--color-amber`, `--color-warn-surface`, `--color-warn-ink`, `--color-overlay`, `--shadow-sm` và `--shadow-pop`. Các alias ngữ nghĩa đã là chuỗi `var()` nên tự đi theo. `color-scheme` được đặt theo `data-theme` để thanh cuộn và control gốc của WebView2 khớp chế độ.

`buildAppearanceStyle(appearance, scheme)` trả về các thuộc tính sau, ghi bằng inline style trên `document.documentElement` nên luôn thắng cả hai khối trên:

| Biến | Nguồn |
|---|---|
| `--color-canvas` | `interfaceColors[scheme].canvas` |
| `--color-sidebar`, `--color-surface-soft` | `interfaceColors[scheme].sidebar` |
| `--color-ink` | `interfaceColors[scheme].text` |
| `--color-brand` | `interfaceColors[scheme].accent` |
| `--color-surface-card` | `color-mix(in srgb, <text> 8%, <sidebar>)` |
| `--color-cream-strong` | `color-mix(in srgb, <text> 14%, <sidebar>)` |
| `--color-hairline` | `color-mix(in srgb, <text> 12%, <canvas>)` |
| `--color-hairline-soft` | `color-mix(in srgb, <text> 7%, <canvas>)` |
| `--color-body-strong` | `color-mix(in srgb, <text> 92%, <canvas>)` |
| `--color-body` | `color-mix(in srgb, <text> 78%, <canvas>)` |
| `--color-muted` | `color-mix(in srgb, <text> 58%, <canvas>)` |
| `--color-muted-soft` | `color-mix(in srgb, <text> 42%, <canvas>)` |
| `--color-brand-active` | `color-mix(in srgb, <text> 22%, <accent>)` |
| `--color-brand-disabled` | `color-mix(in srgb, <accent> 30%, <canvas>)` |
| `--color-on-primary` | `#ffffff` hoặc `<text>`, chọn bên có tỉ lệ tương phản cao hơn với `<accent>` |
| `--color-dark` | `terminalPalette.background` |
| `--color-dark-elevated` | `color-mix(in srgb, <terminal foreground> 10%, <terminal background>)` |
| `--color-on-dark` | `terminalPalette.foreground` |
| `--terminal-background`, `--terminal-foreground` | Bảng màu terminal |
| `--terminal-ansi-0` … `--terminal-ansi-15` | `terminalPalette.ansiColors[i]` |
| `--terminal-font-size` | `${terminalFontSizePx}px` |
| `--ui-font-size` | `${interfaceFontSizePx}px` |
| `--ui-scale` | `interfaceFontSizePx / 14`, làm tròn bốn chữ số thập phân |

Ngoài biến, component đặt `data-theme`, `style.colorScheme` và `style.zoom` bằng `--ui-scale`. Vì `color-mix()` chỉ có ý nghĩa khi trình duyệt tính toán, các công thức trên được ghi thành chuỗi CSS chứ không tính sẵn ở TypeScript; test khẳng định chuỗi sinh ra đúng công thức và đúng màu nguồn.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Người dùng kéo ô màu liên tục nhiều giây | Preview mượt theo từng bước, nhưng chỉ có tối đa một request đang bay và chỉ patch cuối được gửi tiếp sau khi request trước xong. |
| Bấm hai preset liên tiếp rất nhanh | Request thứ hai chờ request thứ nhất xong rồi mới gửi; snapshot cuối cùng phản ánh preset bấm sau. |
| Đang lưu thì bấm `Restore default theme` | Nút bị khóa trong lúc `saveStatus === "saving"`, nên không có hai lệnh ghi chồng nhau. |
| `update_settings` trả `contrast_too_low` dù frontend đã kiểm tra trước | Draft được giữ, lỗi hiển thị cạnh nhóm màu theo `foreground`/`background` backend trả về; đây là trường hợp phòng thủ cho sai lệch làm tròn giữa hai lớp. |
| Người dùng dán một chuỗi hex viết hoa | Ô nhập nhận, chuẩn hóa thành chữ thường trước khi preview và gửi đi; giá trị hiển thị lại lấy từ snapshot backend nên luôn là `#rrggbb` chữ thường. |
| Người dùng nhập `#abc`, tên màu hoặc `rgb(...)` | Không preview, không commit; ô hiển thị lỗi định dạng khi rời ô và giữ nguyên văn bản để người dùng sửa. |
| `themeMode === "system"` và hệ điều hành đổi chế độ trong lúc đang sửa màu | Bộ màu đang chỉnh vẫn là bộ người dùng chọn ở nút gạt; chỉ chế độ được vẽ đổi theo. Không có commit tự phát. |
| `window.matchMedia` không tồn tại | Hook trả `"light"` và không đăng ký gì; ứng dụng vẫn chạy và `themeMode` cố định vẫn hoạt động đầy đủ. |
| Snapshot đọc thất bại lúc khởi động | Cửa sổ dùng bảng token viết sẵn theo `prefers-color-scheme`; trang Appearance hiển thị trạng thái lỗi đọc kèm `Try again` như `FE-011`. |
| Người dùng rời khu vực Settings ngay sau khi kéo slider | Commit đang chờ được flush khi component unmount, nên giá trị cuối vẫn được lưu. |
| Người dùng đặt cỡ chữ giao diện `20 px` rồi thu nhỏ cửa sổ | Toàn giao diện phóng theo `zoom`; sidebar vẫn giữ giới hạn chiều rộng của `FE-001` trong không gian đã phóng và thân trang không cuộn ngang. |
| Snapshot có `themePreset === "custom"` | Không card nào được chọn, dòng `Custom colours` hiển thị; bấm một card vẫn commit bình thường và ghi đè toàn bộ màu. |
| Component unmount trong lúc `update_settings` chưa trả về | Kết quả về sau vẫn cập nhật store dùng chung, vì theme là trạng thái toàn ứng dụng; không có cảnh báo cập nhật state trên component đã unmount vì store nằm ngoài vòng đời component. |
| Cửa sổ hẹp | Cột sub-nav giữ `220px`; lưới ba card preset và lưới ô màu ANSI xuống dòng trong cột nội dung; khối xem trước terminal cuộn ngang trong khung riêng. |

## Tiêu chí hoàn thành

- [ ] `/settings/appearance` render trang thật thay cho placeholder `FE-012`, breadcrumb hiển thị `Settings` rồi `Appearance`, và test router khẳng định điều đó.
- [ ] Trang hiển thị đúng sáu hàng theo thứ tự wireframe cùng nguyên văn nhãn và dòng phụ, cộng nút `Restore default theme` ở hàng tiêu đề.
- [ ] Chọn `Light`, `Dark`, `System` gửi đúng `{ appearance: { themeMode } }`, và với `System` thì chế độ được vẽ đổi theo `prefers-color-scheme` mà không gọi thêm command nào.
- [ ] Chọn một preset gửi đúng `{ appearance: { themePreset } }` không kèm màu; sau khi snapshot trả về, màu hiển thị lấy từ snapshot chứ không từ hằng số frontend.
- [ ] Sửa một màu giao diện gửi đúng `{ appearance: { interfaceColors } }` với cả hai bộ Light/Dark và không kèm `themePreset`; sửa màu terminal gửi đúng `{ appearance: { terminalPalette } }` với đủ 16 phần tử ANSI.
- [ ] Nút gạt `Light`/`Dark` của khối màu giao diện sửa được bộ màu của chế độ không hiển thị mà không đổi `themeMode`.
- [ ] Ô màu và ô hex của cùng một dòng luôn đồng bộ; hex sai định dạng không gửi request và hiển thị lỗi dòng.
- [ ] Một bộ màu vi phạm ngưỡng tương phản không gửi request, hiển thị lỗi nêu cặp màu và ngưỡng, và vẫn preview để người dùng thấy vấn đề.
- [ ] Hai slider giới hạn đúng `12..=20` và `10..=24`, bước `1 px`, dùng được bằng `←`/`→`/`Home`/`End`, và số đọc bên cạnh khớp giá trị.
- [ ] Chỉ có tối đa một `update_settings` đang bay; thao tác trong lúc chờ được gộp và gửi sau, có test chứng minh bằng promise bị giữ.
- [ ] Commit đang chờ được flush khi rời trang; test khẳng định giá trị cuối vẫn được gửi.
- [ ] Bấm `Restore default theme` gọi `restore_appearance_defaults`, xóa draft và cập nhật giao diện theo snapshot trả về.
- [ ] Mỗi mã lỗi ghi được phủ test đúng theo bảng trạng thái: nhóm giữ draft, nhóm bỏ draft, và sự hiện diện của nút `Try again`.
- [ ] `AppearanceThemeSync` ghi `data-theme`, `color-scheme`, `zoom` và toàn bộ biến trong bảng token lên phần tử gốc, ưu tiên draft hơn snapshot, và gỡ sạch mọi thuộc tính đã ghi khi unmount.
- [ ] Khi chưa có snapshot, `AppearanceThemeSync` chỉ đặt `data-theme`/`color-scheme` theo `prefers-color-scheme` và không ghi biến màu nào.
- [ ] `index.css` có khối token Dark đầy đủ; chuyển sang Dark không để lại vùng nào còn nền hoặc chữ của bảng Light.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` và `pnpm build` pass trên Windows.
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` và `cargo test --manifest-path src-tauri/Cargo.toml` vẫn pass trên Windows.
- [ ] `pnpm tauri build` chạy được; smoke thủ công trên Windows xác nhận: preview đổi ngay trên cửa sổ thật, theme và cỡ chữ còn nguyên sau khi mở lại ứng dụng, `System` đổi theo cài đặt Windows, và ở cả `12 px` lẫn `20 px` shell vẫn lấp đầy cửa sổ không sinh thanh cuộn ngoài ý muốn.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/settings/settings-appearance-route.test.tsx` | Component | Sáu hàng đúng nhãn và thứ tự; chọn chế độ, preset, màu và slider gửi đúng patch; nút gạt Light/Dark; trạng thái đang tải, lỗi đọc, đang lưu và cả hai nhóm lỗi ghi; `Restore default theme` gọi đúng command và bị khóa khi đang lưu; dòng `Custom colours`. |
| `src/features/settings/use-appearance-editor.test.ts` | Unit | Preview tức thì; gộp commit theo khoảng lặng `300 ms`; flush khi unmount; chặn commit khi tương phản không đạt hoặc hex sai; `editedScheme` mặc định theo chế độ có hiệu lực và không tự đổi sau khi người dùng chọn tay. |
| `src/features/settings/appearance-theme.test.ts` | Unit | Bốn màu ghi đè đúng token; từng công thức `color-mix()` sinh đúng chuỗi và đúng màu nguồn; chọn `--color-on-primary` theo tương phản; đủ 16 biến ANSI; `--ui-scale` tại `12`, `14` và `20 px`. |
| `src/features/settings/appearance-theme-sync.test.tsx` | Component | Ghi đúng thuộc tính lên phần tử gốc; draft thắng snapshot; không ghi biến màu khi snapshot còn `null`; dọn sạch khi unmount; phản ứng khi media query đổi ở chế độ `system`. |
| `src/features/settings/appearance-contrast.test.ts` | Unit | Tỉ lệ tương phản tại giá trị biên `4.5:1` và `3:1`; danh sách cặp vi phạm của bộ màu giao diện và của bảng màu terminal; đường dẫn field khớp đúng định dạng backend phát ra. |
| `src/features/settings/appearance-color-field.test.tsx` | Component | Hai control đồng bộ; chuẩn hóa hex viết hoa; chặn `#abc`, tên màu và `rgb(...)`; `Enter` commit ngay, `Esc` hoàn tác; hiển thị lỗi dòng. |
| `src/features/settings/use-effective-color-scheme.test.ts` | Unit | `light`, `dark` và `system`; phản ứng khi media query đổi; hủy đăng ký khi unmount; trả `light` khi thiếu `matchMedia`. |
| `src/features/settings/settings-store.test.ts` | Unit | Bổ sung: `previewAppearance` không gọi IPC; hàng đợi commit một-tại-một-thời-điểm và gộp patch chờ; thay snapshot cùng xóa draft sau khi ghi thành công; giữ hay bỏ draft theo từng mã lỗi; `restoreAppearance`; `bootstrapAppSettings` chỉ đọc một lần; `resetSettingsStore` xóa cả state mới. |
| `src/lib/ipc/settings.test.ts` | Unit | Bổ sung: `updateSettings` gọi `update_settings` với đúng payload `{ input }`; `restoreAppearanceDefaults` gọi `restore_appearance_defaults` không tham số; cả hai bọc rejection thành `IpcCallError` mang payload typed. |
| `src/app/app-router.test.tsx` | Component | Bổ sung: `/settings/appearance` render `SettingsAppearanceRoute`; bỏ dòng kiểm tra placeholder `FE-012`; breadcrumb hai cấp vẫn đúng. |

## Câu hỏi mở

Không có.
