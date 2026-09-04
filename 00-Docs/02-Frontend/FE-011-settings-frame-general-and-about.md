# FE-011 — Settings khung, General và About

Tài liệu này đặc tả contract frontend cho khu vực Settings của XWork: khung điều hướng gồm bảy mục con, trang `General` chỉ đọc lấy từ `BE-008`, trang `About` lấy tên/phiên bản ứng dụng và thông tin hệ điều hành, cùng các trang placeholder cho những mục con chưa có chủ.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-011` |
| Phase | `1` |
| Khu vực chính | `src/features/settings/` |
| Yêu cầu chức năng | `§17.1`, `§17.7`; yêu cầu tương tác chung `§18`; điểm vào Settings trên sidebar theo `§4.1` |
| Wireframe | `01-Wireframe/02-AppShell.html#settings-general`, `01-Wireframe/02-AppShell.html#settings-about` |
| Backend liên quan | `BE-008` cho `get_settings`; Tauri core `app` và official plugin `os` cho dữ liệu About (không thuộc tài liệu `BE-NNN` nào) |
| Phụ thuộc | `FE-001` phải hoàn thành trước; `BE-008` đã triển khai và đã sinh `src/bindings/settings.ts` |

## Mục tiêu

Người dùng mở `Settings` từ sidebar và thấy một khung có danh sách bảy mục con giống wireframe, luôn vào đúng mục đang chọn qua đường dẫn riêng. Mục `General` hiển thị ngôn ngữ giao diện cùng bốn hành vi cửa sổ/tray mà `BE-008` trả về ở dạng chỉ đọc và giải thích vì sao không đổi được. Mục `About` hiển thị tên, phiên bản XWork và thông tin hệ điều hành đủ để hỗ trợ khi báo lỗi.

### Quyết định và giả định đã chốt

- Settings là một nhóm route lồng nhau: `/settings` chuyển hướng thay thế sang `/settings/general`, mỗi mục con có đường dẫn riêng. Nhờ vậy đường dẫn, mục đang chọn trên sub-nav và breadcrumb `Settings / General` luôn khớp nhau, và mỗi feature Settings sau này chỉ thay `element` của đúng route mình sở hữu.
- Cả bảy mục con đều xuất hiện trên sub-nav ngay ở lát cắt này theo wireframe. Năm mục chưa có chủ (`Appearance`, `Terminal & CLI Profiles`, `Keyboard Shortcuts`, `Notifications`, `Data`) render một trang placeholder bên trong khung Settings, nêu rõ mã feature sẽ mang nội dung tới. Đây là cùng quy ước mà shell đang dùng cho các khu vực chưa triển khai.
- Sub-nav của Settings **không** phải landmark `navigation`. `FE-001` chốt sidebar là landmark điều hướng duy nhất của shell và có test khẳng định điều đó; sub-nav vì vậy là một danh sách link có `aria-label` nằm trong landmark `main`.
- `General` là màn hình chỉ đọc hoàn toàn. `BE-008` không có patch cho General: `interfaceLanguage` luôn là `english`, còn bốn boolean là invariant vòng đời do `BE-001` sở hữu. Bốn hàng đó render bằng `Switch` ở trạng thái `disabled` kèm dòng giải thích, không phải control giả bấm được.
- Hàng `Start XWork when I sign in` trong wireframe bị bỏ, đúng theo quyết định đã chốt của `BE-008`: autostart không có trong `§17.1`, không có persistence và không có consumer ở v1.
- About lấy dữ liệu từ Tauri core `app` và official plugin `os`. Plugin được khai báo trong `src-tauri/Cargo.toml`, khởi tạo tại composition root và giới hạn quyền trong `src-tauri/capabilities/main.json`; frontend chỉ gọi qua một wrapper trong `src/lib/ipc/`. Đây là sai lệch có chủ ý so với ghi chú `Gọi từ Rust` ở mục Desktop integration của `01-TechStack.md`: phần khởi tạo và cấp quyền vẫn nằm ở Rust, chỉ điểm gọi nằm ở frontend vì không có capability backend nào sở hữu dữ liệu này. Vì chạm ranh giới frontend/backend, lát cắt này bắt buộc chạy Tauri build.
- About v1 bỏ ba nút liên kết `Documentation`, `License`, `Report an issue`, bỏ `Copy diagnostics` và bỏ dòng ghi chú cập nhật của wireframe. `§17.7` chỉ yêu cầu liên kết `khi được phát hành public source`; project chưa public, chưa có URL và chưa có updater, nên không dựng affordance rỗng.
- About v1 cũng bỏ ba hàng `WebView2`, `Terminal backend` và `Default shell` của wireframe: chúng cần dữ liệu của `BE-006` và `BE-007` chưa tồn tại. Hàng hệ điều hành giữ lại vì `§17.7` yêu cầu trực tiếp.
- `AppInfo` là kiểu do frontend định nghĩa trong `src/lib/ipc/app-info.ts`, không phải DTO backend nên không đặt trong `src/bindings/`. `src/bindings/` chỉ chứa output sinh tự động từ Rust.
- Store settings đọc snapshot một lần khi vào khu vực Settings và giữ trong bộ nhớ suốt phiên làm việc của khu vực đó; nút retry gọi lại `get_settings`. Không ghi `localStorage` và không cache dữ liệu nghiệp vụ lâu dài.
- Feature không gọi `update_settings` và `restore_appearance_defaults`; wrapper cho hai command đó đến cùng `FE-012`.
- `Switch` được sao chép vào `src/components/ui/` theo shadcn/ui, dùng Radix từ package `radix-ui` đã có trong repo. Dependency npm mới duy nhất của lát cắt này là `@tauri-apps/plugin-os`.

### Ngoài phạm vi

- Nội dung năm mục con còn lại: `FE-012`, `FE-013`, `FE-014`, `FE-015`, `FE-023`.
- Nối chiều rộng và trạng thái thu gọn sidebar vào settings persistence: đó là lát cắt mở rộng `FE-001` trong cùng giai đoạn 6, không thuộc tài liệu này.
- Mọi thao tác ghi settings, xem trước theme, đổi màu và đổi cỡ chữ: thuộc `FE-012`.
- Thêm ngôn ngữ giao diện thứ hai và hạ tầng dịch chuỗi.
- Liên kết ngoài, trình mở URL, kiểm tra cập nhật và gói chẩn đoán.
- Thông tin hệ điều hành mở rộng như WebView2, shell mặc định hoặc backend terminal.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/settings/settings-route.tsx` | Điểm vào `/settings`: layout hai cột của khu vực Settings, ghép sub-nav với `Outlet`, kích hoạt lần đọc snapshot đầu tiên. |
| `src/features/settings/settings-nav.tsx` | Danh sách bảy link mục con có `aria-label`, icon và trạng thái đang chọn; định nghĩa `SETTINGS_SECTIONS` là nguồn duy nhất của nhãn, đường dẫn và icon. |
| `src/features/settings/settings-section.tsx` | Khối trình bày dùng chung của một mục con: tiêu đề, dòng mô tả, `SettingRow` cho cặp nhãn/mô tả bên trái và control bên phải. |
| `src/features/settings/settings-general-route.tsx` | Trang `General`: hàng ngôn ngữ chỉ đọc, bốn hàng hành vi cửa sổ/tray khóa, cùng trạng thái đang tải và lỗi của snapshot. |
| `src/features/settings/settings-about-route.tsx` | Trang `About`: wordmark, tên, phiên bản, dòng mô tả ngắn và bảng thông tin hệ điều hành; trạng thái đang tải và lỗi kèm retry. |
| `src/features/settings/settings-section-placeholder.tsx` | Trang tạm cho mục con chưa có chủ, nêu tên mục và mã feature sẽ mang nội dung tới. |
| `src/features/settings/settings-store.ts` | State snapshot settings dùng chung cho khu vực Settings: trạng thái tải, snapshot, mã lỗi gần nhất, hành động `load`; `FE-012` mở rộng chính store này. |
| `src/features/settings/use-app-info.ts` | Hook đọc tên/phiên bản ứng dụng và thông tin hệ điều hành cho `About`, chống ghi state sau khi unmount và cho phép gọi lại. |
| `src/features/settings/settings-error-copy.ts` | Ánh xạ `SettingsError` và lỗi đọc app info thành thông điệp hiển thị cùng khả năng retry. |
| `src/lib/ipc/settings.ts` | Wrapper `getSettings` cho command `get_settings` của `BE-008`, dùng chung `invokeCommand`. |
| `src/lib/ipc/app-info.ts` | Wrapper gộp `getVersion` của Tauri core `app` và `platform`/`version`/`arch` của plugin `os` thành một kiểu `AppInfo`. |
| `src/components/ui/switch.tsx` | Component switch sao chép từ shadcn/ui, chỉ dùng ở trạng thái `disabled` trong lát cắt này. |
| `src/app/app-router.tsx` | Đăng ký route lồng `/settings` cùng bảy route con và breadcrumb hai cấp; bỏ placeholder khu vực Settings cũ. |
| `package.json` | Thêm dependency `@tauri-apps/plugin-os`, khóa exact version thuộc dòng `2.x` tương thích với `@tauri-apps/api` đang dùng. |
| `pnpm-lock.yaml` | Khóa dependency frontend sau khi manifest đổi. |
| `src-tauri/Cargo.toml` | Thêm crate `tauri-plugin-os`, khóa exact version cùng dòng `2.x` với các plugin Tauri hiện có. |
| `src-tauri/Cargo.lock` | Khóa dependency Rust sau khi manifest đổi. |
| `src-tauri/src/app/mod.rs` | Đăng ký `tauri_plugin_os` trong composition dùng chung để cả bản production lẫn composition test đều có plugin. |
| `src-tauri/capabilities/main.json` | Cấp cho cửa sổ `main` đúng các quyền mà About cần và không hơn. |
| `src-tauri/gen/schemas/` | Output sinh lại bởi `tauri-build` khi capability hoặc danh sách plugin đổi; commit nguyên trạng, không sửa tay. |
| `src/features/settings/settings-route.test.tsx` | Test khung: bảy mục con, chuyển hướng mặc định, mục đang chọn, một landmark navigation duy nhất, chỉ đọc snapshot một lần. |
| `src/features/settings/settings-general-route.test.tsx` | Test trang General: các hàng, trạng thái khóa, đang tải, lỗi và retry. |
| `src/features/settings/settings-about-route.test.tsx` | Test trang About: phiên bản, nhãn hệ điều hành, đang tải, lỗi, retry và các phần tử wireframe đã bỏ. |
| `src/features/settings/settings-store.test.ts` | Test store: chuyển trạng thái, chặn gọi trùng khi đang tải, phân loại lỗi, reset. |
| `src/features/settings/use-app-info.test.ts` | Test hook: thứ tự gọi, gộp kết quả, lỗi, gọi lại và không ghi state sau unmount. |
| `src/lib/ipc/settings.test.ts` | Test wrapper: tên command và ánh xạ lỗi typed. |
| `src/lib/ipc/app-info.test.ts` | Test wrapper: gọi đúng API, hình dạng `AppInfo`, và lỗi khi một nguồn thất bại. |
| `src/app/app-router.test.tsx` | Bổ sung: `/settings` chuyển hướng sang `/settings/general`; bảy đường dẫn con render đúng trang; breadcrumb hai cấp; bỏ dòng kiểm tra placeholder khu vực Settings. |
| `src-tauri/tests/app_builder.rs` | Bổ sung: composition root vẫn dựng được sau khi đăng ký plugin `os`. |

Feature không thêm migration, không thay `src-tauri/tauri.conf.json`, không sửa file trong `src/bindings/` và không đụng `src/app/shell-store.ts`.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `SettingsRoute` | Layout khu vực Settings: cột trái `220px` là sub-nav có viền phải `hairline`, cột phải là vùng nội dung `padding 28px 40px` chứa `Outlet`. | `#settings-general`, `#settings-about` |
| `SettingsNav` | Nhãn nhóm `Settings` dạng eyebrow và bảy link mục con cao `32px`, icon `15px`, mục đang chọn có nền `surface-card` và chữ `ink`. | `#settings-general` |
| `SettingsSection` | Tiêu đề mục dạng `h1` font `--font-display`, dòng mô tả `13px` màu `muted`, rồi danh sách `SettingRow`. | `#settings-general` |
| `SettingRow` | Grid `minmax(0, 1fr) 340px`, gap `24px`, padding dọc `14px`, viền trên `hairline-soft` trừ hàng đầu; trái là nhãn `14px/500` và mô tả `12px` màu `muted`, phải là control canh phải. | `#settings-general` |
| `SettingsGeneralRoute` | Năm hàng: `Interface language`, `Closing the window hides XWork to the tray`, `Show tray icon`, `Ask before quitting`, `Open at Home on launch`. | `#settings-general` |
| `Switch` | Control boolean, trong lát cắt này luôn `disabled` và phản ánh giá trị `GeneralSettingsDto`. | `#settings-general` |
| `SettingsAboutRoute` | Hàng wordmark cỡ lớn kèm tên, phiên bản dạng mono và dòng mô tả ngắn; bên dưới là bảng thông tin `max-width 560px`, font `13px`, mỗi ô padding `9px 10px`, viền dưới `hairline-soft`. | `#settings-about` |
| `SettingsSectionPlaceholder` | Tiêu đề mục và một câu nêu mã feature sẽ mang nội dung tới, đặt đúng vị trí nội dung của khung Settings. | `Không có` |

Nhãn và mô tả của các hàng General lấy nguyên văn từ wireframe: `More languages will arrive in a later release.`; `Terminals, AI CLIs and reminders keep running. Use Quit XWork to stop everything.`; `Turning this off means the window can only be reopened from the taskbar.`; `Shows how many sessions and processes will be stopped.`; `XWork always opens at Home. Sessions are not restored after Quit.`. Dòng mô tả của trang General là `Language, window and tray behaviour.`; dòng mô tả ngắn của About là `Local-first workspace for projects and AI CLIs`.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| `Khung sẵn sàng` | Bất kỳ đường dẫn nào khớp `/settings`. | Sub-nav luôn render đầy đủ bảy mục và không phụ thuộc kết quả IPC; chỉ vùng nội dung mới có trạng thái tải. |
| `Đang tải General` | `status` của store là `idle` hoặc `loading`. | Tiêu đề và dòng mô tả giữ nguyên; vùng hàng hiển thị dòng `Loading settings…` với `aria-busy="true"`; không render control nào. |
| `General sẵn sàng` | `status === "ready"` và có snapshot. | Năm hàng hiển thị giá trị từ `snapshot.general`; bốn `Switch` ở trạng thái `disabled`. |
| `Lỗi General` | `status === "error"`. | Thông điệp nêu rõ không đọc được settings, kèm nút `Try again` khi lỗi cho phép retry; lỗi không retry được hiển thị thông điệp yêu cầu khởi động lại XWork và không có nút. |
| `Đang tải About` | `useAppInfo().status === "loading"`. | Wordmark và tên XWork hiển thị ngay; phiên bản và bảng thông tin thay bằng dòng `Loading application details…` với `aria-busy="true"`. |
| `About sẵn sàng` | `useAppInfo().status === "ready"`. | Dòng `Version` kèm chuỗi phiên bản và bảng hai hàng `Operating system`, `Architecture`. |
| `Lỗi About` | `useAppInfo().status === "error"`. | Thông điệp `XWork couldn't read its application details.` kèm nút `Try again`; wordmark và tên vẫn hiển thị vì chúng là hằng số giao diện. |
| `Mục con chưa có chủ` | Đường dẫn khớp một trong năm mục chưa triển khai. | `SettingsSectionPlaceholder` với tên mục và câu nêu mã feature sẽ mang nội dung tới. |
| `Rỗng` | Không xảy ra. | Cả hai trang luôn có nội dung cố định: General có đúng năm hàng do backend bảo đảm trả đủ, About có tên ứng dụng ngay cả khi đọc thất bại. Vì vậy feature không định nghĩa trạng thái rỗng riêng. |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Bấm `Settings` trên sidebar | Điều hướng tới `/settings`, được thay thế ngay bằng `/settings/general`; mục `Settings` của sidebar giữ trạng thái đang chọn cho mọi đường dẫn con. | `Không có` |
| Bấm một mục trên sub-nav | Đổi đường dẫn sang mục đó, đổi nội dung bên phải và đổi cấp thứ hai của breadcrumb; sub-nav không cuộn lại và không mất focus. | `Không có` |
| Di chuyển focus bằng `Tab` trong khu vực Settings | Thứ tự là bảy link sub-nav theo thứ tự hiển thị, rồi tới các control có thể focus của nội dung; mọi link có viền focus rõ ràng. | `Tab` / `Shift+Tab` |
| Kích hoạt link sub-nav bằng bàn phím | Giống bấm chuột; không có thao tác nào chỉ dùng được bằng con trỏ. | `Enter` |
| Đưa focus hoặc con trỏ tới một `Switch` bị khóa | Control không nhận focus và không đổi giá trị; dòng mô tả bên trái cùng nhãn phụ bên phải giải thích vì sao giá trị cố định. | `Không có` |
| Bấm `Try again` khi General lỗi | Gọi lại `get_settings`; trong lúc gọi nút bị khóa và vùng nội dung quay về trạng thái đang tải. | `Không có` |
| Bấm `Try again` khi About lỗi | Đọc lại app info; trong lúc gọi nút bị khóa và vùng thông tin quay về trạng thái đang tải. | `Không có` |
| Quay lại khu vực Settings sau khi đã rời đi | Snapshot đã đọc được dùng lại, không gọi `get_settings` lần nữa trừ khi lần trước thất bại. | `Không có` |

## Luồng chính

1. Người dùng bấm `Settings` trên sidebar. Router khớp route cha `/settings`, `SettingsRoute` mount và render sub-nav ngay lập tức.
2. Route index của `/settings` chuyển hướng thay thế sang `/settings/general`, nên lịch sử không sinh thêm một mục trung gian và nút quay lại vẫn về đúng màn hình trước đó.
3. `SettingsRoute` gọi `load()` của store khi `status === "idle"`. Store gọi `getSettings()` một lần; mọi mục con dùng chung kết quả này.
4. `SettingsGeneralRoute` đọc trực tiếp từ store và render theo trạng thái tương ứng. Không có mục con nào tự gọi `get_settings`.
5. `SettingsAboutRoute` mount thì `useAppInfo()` gọi `readAppInfo()` một lần, độc lập hoàn toàn với store settings: lỗi của một bên không làm hỏng bên kia.
6. Mọi lần đổi mục con chỉ thay `Outlet`; sub-nav, snapshot đã đọc và trạng thái cuộn của cột trái được giữ nguyên.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `get_settings` | Không có | `AppSettingsDto` | `unavailable`: thông điệp lỗi tạm thời kèm `Try again`. `corrupt_stored_settings`: thông điệp lỗi dữ liệu cấp ứng dụng, yêu cầu khởi động lại XWork, không có nút retry và không tự sửa dữ liệu. `persistence_failed`: thông điệp lỗi kèm `Try again`. `unauthorized_window`, `empty_patch`, `invalid_color`, `contrast_too_low`, `value_out_of_range`, `invalid_preset_combination`: không thể xảy ra với một lệnh đọc, xử lý như lỗi tích hợp không retry được. Rejection không mang `code` nhận biết được: cũng là lỗi tích hợp không retry được. |

Feature chỉ đọc. `update_settings` và `restore_appearance_defaults` của `BE-008` không được gọi ở lát cắt này.

### API Tauri sử dụng cho About

| Nguồn | Hàm | Quyền cần cấp cho cửa sổ `main` | Giá trị dùng trên UI |
|---|---|---|---|
| `@tauri-apps/api/app` | `getVersion()` | `core:app:allow-version` | Phiên bản ứng dụng lấy từ `version` của `src-tauri/tauri.conf.json`, hiển thị nguyên văn sau nhãn `Version`. |
| `@tauri-apps/plugin-os` | `platform()` | `os:allow-platform` | Nền tảng, được ánh xạ sang nhãn hiển thị: `windows` thành `Windows`, `macos` thành `macOS`, giá trị khác giữ nguyên. |
| `@tauri-apps/plugin-os` | `version()` | `os:allow-version` | Phiên bản hệ điều hành, hiển thị nguyên văn cạnh nhãn nền tảng. |
| `@tauri-apps/plugin-os` | `arch()` | `os:allow-arch` | Kiến trúc CPU, hiển thị nguyên văn ở hàng `Architecture`. |

`src-tauri/capabilities/main.json` chỉ được thêm đúng bốn quyền trên; không dùng `os:default` vì nó mở cả `hostname` và `locale` mà feature không cần. Nếu ACL của plugin không định nghĩa một trong các identifier này, giữ đúng tập identifier tối thiểu mà plugin công bố cho ba giá trị nền tảng, phiên bản và kiến trúc. Cấu hình CSP hiện tại đã cho phép kênh IPC nên không cần sửa `tauri.conf.json`.

### Event / Channel đăng ký

Không có. Snapshot settings chỉ đổi khi chính frontend ghi, và lát cắt này không ghi. App info là hằng số trong một lần chạy ứng dụng.

## State frontend

```ts
// Trạng thái đọc snapshot settings dùng chung cho toàn khu vực Settings.
type SettingsStatus = "idle" | "loading" | "ready" | "error";

// Mã lỗi đã phân loại của lần đọc gần nhất; "unknown" cho rejection không nhận dạng được.
type SettingsErrorCode = SettingsError["code"] | "unknown";

interface SettingsState {
  status: SettingsStatus;
  snapshot: AppSettingsDto | null;
  errorCode: SettingsErrorCode | null;
  load(): Promise<void>;
}

// Kiểu do frontend sở hữu, không phải DTO backend.
interface AppInfo {
  appVersion: string;
  osPlatform: string;
  osVersion: string;
  osArch: string;
}

interface AppInfoState {
  status: "loading" | "ready" | "error";
  info: AppInfo | null;
  reload(): void;
}

// Phân loại một lỗi thành thông điệp hiển thị và khả năng thử lại.
interface SettingsFailure {
  kind: "retryable" | "integration";
  message: string;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `snapshot` | Backend qua `get_settings` | Đọc một lần cho mỗi lần vào khu vực Settings và giữ trong bộ nhớ; `load()` không chạy chồng khi đã có request đang bay và luôn thay toàn bộ snapshot khi thành công. Không ghi ra bất kỳ storage nào của webview. |
| `status`, `errorCode` | UI tạm thời | Chỉ mô tả lần đọc gần nhất; `errorCode` bị xóa khi một lần đọc thành công. |
| `info` | Tauri core `app` và plugin `os` | Bất biến trong một lần chạy ứng dụng; chỉ đọc lại khi người dùng bấm `Try again`. Hook bỏ qua kết quả về sau khi component đã unmount. |

## Contract công khai của feature

```ts
// Layout khu vực Settings, gắn vào route cha `/settings`.
export function SettingsRoute(): JSX.Element

// Nội dung của hai mục con mà FE-011 sở hữu.
export function SettingsGeneralRoute(): JSX.Element
export function SettingsAboutRoute(): JSX.Element

// Trang tạm cho một mục con chưa có chủ.
export function SettingsSectionPlaceholder(props: { section: string; arrivesWith: string }): JSX.Element

// Store snapshot settings; FE-012 mở rộng chính store này thay vì tạo store thứ hai.
export const useSettingsStore: UseBoundStore<StoreApi<SettingsState>>

// Khôi phục trạng thái mặc định của store để mỗi test không quan sát state của test khác.
export function resetSettingsStore(): void
```

`src/app/` chỉ được dùng các export trên. `SETTINGS_SECTIONS`, `SettingsNav`, `SettingsSection`, `SettingRow`, `useAppInfo` và bảng thông điệp lỗi là nội bộ feature; feature khác không import chúng.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Người dùng mở thẳng một đường dẫn con không tồn tại dưới `/settings` | Route bắt tất cả của shell xử lý như hiện tại và hiển thị trang không tìm thấy; khung Settings không tự đoán mục gần đúng. |
| `get_settings` trả `corrupt_stored_settings` | Trang General báo lỗi dữ liệu, không có nút retry, không hiển thị giá trị mặc định giả và không gọi lại command. Sub-nav cùng trang About vẫn dùng được. |
| `get_settings` thất bại rồi người dùng chuyển sang `About` và quay lại `General` | Trạng thái lỗi được giữ; quay lại `General` không tự động gọi lại. Chỉ nút `Try again` mới gọi lại. |
| `getVersion()` thành công nhưng một hàm của plugin `os` thất bại | `readAppInfo()` reject; About vào trạng thái lỗi và không hiển thị thông tin nửa vời. |
| Quyền của plugin `os` chưa được cấp trong capability | Lời gọi bị từ chối, About hiển thị đúng trạng thái lỗi thay vì màn hình trắng; test wrapper phải phủ nhánh này. |
| Người dùng bấm `Try again` nhiều lần liên tiếp | Chỉ có một request đang bay; nút bị khóa cho tới khi request kết thúc. |
| Component unmount trong lúc `get_settings` hoặc `readAppInfo()` chưa trả về | Kết quả về sau bị bỏ qua; không có cảnh báo cập nhật state trên component đã unmount. |
| Snapshot trả về một boolean General bằng `false` | UI hiển thị đúng trạng thái tắt của `Switch`, không hardcode giá trị bật. Backend là nguồn duy nhất của giá trị. |
| `version` trong `tauri.conf.json` vẫn là giá trị khởi tạo | About hiển thị đúng chuỗi backend trả về, không tự chế thêm số build hay nhãn phiên bản. |
| Cửa sổ hẹp | Cột sub-nav giữ `220px`; vùng nội dung co lại và bảng About cuộn ngang trong khung riêng, thân trang không cuộn ngang. |

## Tiêu chí hoàn thành

- [ ] Bấm `Settings` trên sidebar dẫn tới `/settings/general`; mục `Settings` của sidebar và mục `General` của sub-nav cùng ở trạng thái đang chọn, breadcrumb hiển thị hai cấp `Settings` rồi `General`.
- [ ] Sub-nav render đúng bảy mục theo thứ tự wireframe; mỗi mục dẫn tới một đường dẫn riêng và có test khẳng định đường dẫn của mọi mục đều render đúng trang tương ứng.
- [ ] Năm mục chưa có chủ hiển thị placeholder nêu đúng mã feature `FE-012`, `FE-013`, `FE-014`, `FE-015`, `FE-023`.
- [ ] Khu vực Settings giữ đúng một landmark `banner`, một `navigation` và một `main`; test hiện có của shell không phải nới lỏng để pass.
- [ ] Trang General hiển thị năm hàng đúng nhãn và mô tả wireframe, không có hàng `Start XWork when I sign in`, và bốn `Switch` đều `disabled` với giá trị lấy từ `snapshot.general`.
- [ ] `get_settings` chỉ được gọi một lần cho một lần vào khu vực Settings; chuyển qua lại giữa các mục con không phát sinh lời gọi mới.
- [ ] Ba nhánh lỗi của General được phủ test: retry được, không retry được và rejection không nhận dạng được, mỗi nhánh hiển thị đúng thông điệp và đúng sự hiện diện của nút `Try again`.
- [ ] Trang About hiển thị tên, phiên bản lấy từ `getVersion()`, hàng `Operating system` ghép nhãn nền tảng với phiên bản hệ điều hành và hàng `Architecture`; không có nút liên kết ngoài, không có `Copy diagnostics` và không có dòng ghi chú cập nhật.
- [ ] About xử lý đủ ba trạng thái đang tải, sẵn sàng, lỗi kèm `Try again`, và lỗi của About không ảnh hưởng trang General.
- [ ] `src-tauri/capabilities/main.json` chỉ thêm đúng các quyền mà About cần; không dùng quyền mặc định gộp của plugin `os`.
- [ ] Mọi function, component, hook, helper và test được thêm đều có comment ngắn đúng quy tắc project.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` và `pnpm build` pass trên Windows.
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` và `cargo test --manifest-path src-tauri/Cargo.toml` pass trên Windows.
- [ ] `pnpm tauri build` chạy được sau khi thêm plugin và quyền mới; smoke thủ công trên Windows xác nhận About hiển thị đúng phiên bản và thông tin hệ điều hành thật.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/settings/settings-route.test.tsx` | Component | Sub-nav đủ bảy mục đúng thứ tự và nhãn; mục đang chọn theo đường dẫn; sub-nav không tạo landmark `navigation` thứ hai; `load()` chỉ chạy khi store ở `idle`. |
| `src/features/settings/settings-general-route.test.tsx` | Component | Năm hàng đúng nhãn và mô tả; không có hàng autostart; `Switch` `disabled` phản ánh cả giá trị bật và tắt; trạng thái đang tải; ba nhánh lỗi và hành vi của nút `Try again`. |
| `src/features/settings/settings-about-route.test.tsx` | Component | Hiển thị phiên bản và hai hàng thông tin; ánh xạ nhãn nền tảng; trạng thái đang tải; trạng thái lỗi và retry; khẳng định không render liên kết ngoài, `Copy diagnostics` và dòng ghi chú cập nhật. |
| `src/features/settings/settings-store.test.ts` | Unit | Chuyển trạng thái `idle` sang `loading` sang `ready`; chặn gọi trùng khi đang tải; phân loại từng mã `SettingsError` và rejection không nhận dạng được; `resetSettingsStore` khôi phục mặc định. |
| `src/features/settings/use-app-info.test.ts` | Unit | Gộp kết quả của bốn lời gọi thành `AppInfo`; trạng thái lỗi khi một nguồn thất bại; `reload` gọi lại; không ghi state sau unmount. |
| `src/lib/ipc/settings.test.ts` | Unit | `getSettings` gọi đúng tên command `get_settings`, không truyền tham số, và bọc rejection thành `IpcCallError` mang payload typed. |
| `src/lib/ipc/app-info.test.ts` | Unit | Gọi đúng `getVersion`, `platform`, `version`, `arch`; trả đúng hình dạng `AppInfo`; reject khi bất kỳ nguồn nào lỗi. |
| `src/app/app-router.test.tsx` | Component | `/settings` chuyển hướng thay thế sang `/settings/general`; bảy đường dẫn con render đúng trang; breadcrumb hai cấp cho từng mục; route con vẫn gắn error element của shell. |
| `src-tauri/tests/app_builder.rs` | Integration | Composition root vẫn dựng được sau khi đăng ký plugin `os`. |

## Câu hỏi mở

Không có.
