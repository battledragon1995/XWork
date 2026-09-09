# BE-018 Calendar Events Implementation Plan

**Status:** Complete — Windows automated verification passed; native smoke pending

**Goal:** Deliver persistent Calendar definitions and bounded occurrence queries, with real Search and backup/reset consumers, before FE-021/FE-022 and BE-019.

**Completion Criteria:**

- Migration 0008, six main-only commands, generated Calendar bindings, typed recurrence/timezone validation and post-commit invalidation work against isolated real SQLite tests.
- Event search returns one base identity per series; backup v3 round-trips Events, preserves v1/v2 compatibility, rejects unsupported settings sections without partial mutation and resets Events atomically.
- Controlled-time tests prove DST/count/overlap/reminder identity and delete confirmation boundaries. All Windows automated gates below pass; native smoke evidence remains explicitly pending when the environment cannot control native windows.

**Architecture:** Calendar owns definitions, SQL, recurrence and consumer ports. App composition joins public Projects and Calendar interfaces for Search and Data Management. Extend the concrete typed participant structs already implemented; preserve the single maintenance gate and transaction plus no-fail post-commit publication.

**Tech Stack:** Existing Rust 1.98.0/Edition 2024, rusqlite, Tauri 2, ts-rs and Tokio; new exact Calendar dependencies below. No frontend dependency.

**Sources:**

- `AGENTS.md`, `PLANS.md`, `00-Docs/99-Template/04-Plan.md`.
- `00-Docs/98-Plan/00-Roadmap.md`, stage 20 backend portion.
- `00-Docs/00-Overview/01-TechStack.md`, `02-ProjectStructure.md`, `03-FunctionalRequirements.md` (§13.1–13.2, §14, §17.6).
- `00-Docs/03-Backend/BE-018-calendar-events.md`; public dependencies `BE-010-unified-search.md`, `BE-012-backup-and-reset.md`; BE-019 consumer ports only from `BE-019-reminder-scheduler.md`.
- `00-Docs/02-Frontend/00-Overview.md`: FE-021/022 detailed specifications do not exist yet and are the next design deliverables, not prerequisites for changing the already closed BE contract.
- `00-Docs/01-Wireframe/07-Calendar.html#month`, `#upcoming`, `#form`, `#detail`; `#missed` is deferred. Aggregation context: `03-Home.html`, `04-Projects.html`, `02-AppShell.html`.
- Source baseline: `df1c52f Implement FE020`, preceded by `54a8e34 Implement BE017`; clean working tree before this plan/design adjustment.

## Scope

**In Scope:** Calendar timed/all-day CRUD, optional project, whole-series recurrence, reminder definitions, month/day/14-day Upcoming queries, Home/project filters, read-only BE-019 ports, Event Search adapter, backup v3 Events and reset, generated contracts.

**Out of Scope:** FE-021/022 presentation and IPC wrapper implementation; FE Home/Project/Search integration; scheduler, delivery tables, Missed/snooze/dismiss, notification settings persistence and migration 0009/0010; macOS and automated desktop E2E; review work.

## Global Constraints

- “OS access, persistence, terminal processes, and business rules in Rust”; React presentation only, all runtime IPC through narrow wrappers when FE starts.
- “Generated bindings under `src/bindings/` are not edited manually.”
- “Migration đặt tại `src-tauri/migrations/`, chỉ được thêm file mới và không sửa migration đã phát hành.”
- Every function/method/callback/test/helper has a short English purpose comment; explain count, DST, commit-before-emit and maintenance lock invariants inline.
- Markdown UTF-8; plan English; project design Vietnamese; initial UI English. Windows development checks only. No real app-data, credentials or user project access in tests, no global environment mutation.

## Assumptions, Risks, and Blockers

**Assumptions:** User authorizes implementation after this planning task, commits per completed feature, and autonomous resolution of decisions in design. Native verification limits do not block independent coding stages, but must never be reported as passed.

**Risks:** Recurrence COUNT must count valid domain occurrences after DST/date rejection; old start dates must terminate bounded expansion. Backup's previous requirement to wait for notification settings conflicted with roadmap sequencing; the dated BE-012/018 staging decision resolves it. Existing tests hardcode database ceiling 7 and export version 2 and must be updated for the current binary without weakening historical compatibility cases.

**Blockers:** None. All material decisions are recorded in the current designs.

## Dependency Order

1. Dependencies, schema and Calendar DTOs/seams → durable service.
2. Validation/recurrence engine → CRUD and occurrence/consumer queries.
3. Calendar service → Search and typed backup/reset adapters.
4. Managed composition and binding generation → FE handoff and final verification.

### Task 1: Establish Calendar schema, types and deterministic seams

**Outcome:** A fresh or upgraded isolated database supports Calendar without creating Reminder delivery/settings tables.

**Depends On:** None.

**Files:** Create `src-tauri/migrations/0008_create_calendar_events.sql`, `src-tauri/src/calendar/mod.rs`, `models.rs`, `recurrence.rs`, `repository.rs`, `service.rs` within that Calendar directory. Modify `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/lib.rs`, `src-tauri/src/storage/migrations.rs`. Test `src-tauri/tests/calendar_commands.rs`, `src-tauri/tests/storage_foundation.rs`, `src-tauri/tests/notes_contract.rs` and migration module unit tests.

**Interfaces:** Exact public DTO/error/backup records in BE-018, `Storage::open`, `with_connection`, `with_transaction`; the dated `CalendarClock`, `CalendarEventSink`, `CalendarService::with_seams` and `maintenance_gate` signatures in BE-018. Tests create TempDir Storage, isolated ProjectService using existing public seams, atomic wall/monotonic clocks and recording/failing event sink. No new clock crate.

- [x] Add manifest entries exactly: `chrono = "=0.4.45"`, `chrono-tz = "=0.10.4"`, `rrule = "=0.14.0"`; replace UUID line with `uuid = { version = "=1.26.0", features = ["v4", "v5"] }`. Versions are established by Tech Stack and existing UUID manifest; retain other pins. Resolve lockfile and record Windows compilation compatibility, never silently downgrade.
- [x] Add a discoverable `calendar_commands` migration test using existing Storage first: fresh schema version is 8, required tables/indexes exist. Run `cargo test --manifest-path src-tauri/Cargo.toml --test calendar_commands`: expected red is version 7 instead of 8, before introducing missing type imports.
- [x] Add exact SQL from BE-018, register only 0008, then implement DTOs/error serde and seams. Use `number` for safe millisecond timestamps in generated TS and opaque strings for sequence/revision. Deny unknown input fields and redact raw errors.
- [x] Verify upgrade preserves previous tables; FK delete project unlinks event and event delete cascades reminders. Update active migration ceilings in Notes/Storage tests; retain v2 parser cases. Inject invalid migration SQL through the existing private migration runner unit seam; assert rollback keeps prior user_version/data and returns migration failure. Open Storage at a TempDir child that is an ordinary file; assert typed open failure, never real app paths.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --test calendar_commands --test storage_foundation --test notes_contract` and `cargo test --manifest-path src-tauri/Cargo.toml --lib`; expect all discovered assertions pass, including migration rollback.

### Task 2: Implement validated recurrence and occurrence identity

**Outcome:** All consumers derive the same bounded, DST-aware occurrences from typed event definitions.

**Depends On:** Task 1.

**Files:** Calendar `models.rs`, `recurrence.rs`, `repository.rs`, `service.rs`; create `src-tauri/tests/calendar_occurrences.rs`.

**Interfaces:** `EventInputDto`, `EventTimeInputDto`, typed recurrence/end/weekday enums, `CalendarRangeInputDto`, `CalendarOccurrenceListDto`, `CalendarError`; public service query mirrors `list_calendar_occurrences(input)` contract. No raw RRULE IPC. Return generated occurrence IDs exactly as defined by BE-018, using shared resolver across range/search/reminder/context.

- [x] Add compiling unit tests for title/description/UUID/date/clock/range/offset validation before implementing helpers; initial minimal helper bodies return typed rejection so positive-valid-input assertions fail. Use `cargo test --manifest-path src-tauri/Cargo.toml --lib`; record the actual named positive assertion failure, not zero matching tests.
- [x] Implement canonical RRULE construction/parse and bounded expansion with strict input shape, weekly start weekday membership and sorting, inclusive OnDate, AfterCount 1–10000, maximum 366-day duration and 16 unique offsets 0–525600.
- [x] Test daily/weekly/monthly/yearly, 29–31 skip, leap-day skip, timed ambiguous earliest UTC, base nonexistent rejection, future nonexistent start/end skipped before COUNT consumption, all-day floating dates and first-valid-instant at midnight gap/ambiguous/skipped whole day. Include an old DTSTART/high-count bounded query to catch runaway expansion. Never use `all_unchecked` or a library COUNT cutoff before domain validation.
- [x] Test half-open overlap (including start before query), viewer-timezone day assignment, project and onlyWithReminders filters, deterministic sorting/revision, 62-day cap and 5001-result error without truncation. Validate the 1900/9999 and checked arithmetic edges.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib --test calendar_occurrences`; expect valid-count, instant identity and all limits verified. Tests use explicit IANA zones and fixture dates, never OS local timezone or sleeps.

### Task 3: Deliver atomic CRUD and read-only downstream ports

**Outcome:** Definitions persist with optimistic concurrency and main-only command access; committed mutations invalidate exactly once.

**Depends On:** Tasks 1–2.

**Files:** Create `src-tauri/src/calendar/commands.rs`, `src-tauri/tests/calendar_consumers.rs`; modify Calendar service/repository/models/mod and `src-tauri/tests/calendar_commands.rs`.

**Interfaces:** Six BE-018 commands: `list_calendar_occurrences`, `get_calendar_event`, `create_calendar_event`, `update_calendar_event`, `prepare_delete_calendar_event`, `confirm_delete_calendar_event`, with exact input/output signatures in design. Public `search_for_unified(&str,u32)`, `reminder_occurrences(i64,i64,u32)`, `get_notification_context(&str,&str)` return the design's owned types. `calendar://changed` uses `CalendarChangedEventDto`.

- [x] Add discoverable CRUD tests against minimal compiling service methods returning typed errors; expected red is successful create/round-trip rejected, stale-write protection absent, or missing emit as explicitly asserted. Run `cargo test --manifest-path src-tauri/Cargo.toml --test calendar_commands`.
- [x] Implement blocking work with maintenance → mutation → Storage lock order; perform public ProjectService lookup before mutation locks and rely on FK for deletion races. Preserve reminder IDs for unchanged offsets; replace removed/new offsets atomically. Timed/all-day edit affects whole series and recomputes UTC/search derived fields; update timestamp monotonic even under wall clock rollback.
- [x] Implement prepare/confirm memory preview, nonzero request ID, 60-second monotonic TTL and transactional fingerprint check. Test replaced preview, exact expiry, event edit/delete between preview and confirm, stale revision, and repeat confirmation. Command authorization uses mock Tauri runtime labels `main` and `quick-note`, exercising actual command boundary rather than only helpers.
- [x] Add rollback injection via SQLite trigger in isolated Storage that aborts a reminder insert after base insert; assert no base/reminder partial rows, no revision increment or event. Failing sink after commit must leave successful command and durable data. Record sink queries only after commit, never under owner locks.
- [x] Implement downstream ports: one base search candidate/event (limit+1, cap64); reminder due half-open range ≤31 days and ≤5000 entries with checked offset; valid notification context only for an exact current occurrence instant. Test identity changes after timezone edit, removed definition and forged/stale occurrence. Query sqlite_master and row counts to prove these ports create no delivery tables/rows and emit nothing.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --test calendar_commands --test calendar_consumers --test calendar_occurrences`; expect all behavior, failure and caller assertions pass.

### Task 4: Add real Event unified search

**Outcome:** Search exposes Calendar definitions through public source ownership and preserves all existing groups.

**Depends On:** Task 3.

**Files:** `src-tauri/src/search/mod.rs`, `service.rs`, `src-tauri/src/app/search_sources.rs`, `src-tauri/tests/unified_search_contract.rs`, `src-tauri/tests/calendar_consumers.rs`.

**Interfaces:** BE-010 `EventSearchDocument`, `EventSearchSource::search_events(&str,u32) -> SearchFuture<Result<SearchCandidates<EventSearchDocument>,SearchSourceError>>`, Event search kind/source/target variants. `AppEventSearchSource` joins Calendar `search_for_unified` and Projects `list_projects(None)` only. Constructor gains the real Event source alongside existing Notes source.

- [x] Extend compiling source fixtures and add expected Event group result test; initial source returns empty candidates, making the expected event assertion red. Run `cargo test --manifest-path src-tauri/Cargo.toml --test unified_search_contract`.
- [x] Add Event source orchestration under existing 400ms/source and 500ms total timeouts, cap64 candidates/8 group items, source failure redaction and no split opening. Score per existing BE-010 rules and tie-break starts_at_ms then event_id; description matches and optional current project names use public records.
- [x] Test one recurring base result, timed/all-day start mapping, search after edit/delete/import, source unavailable/timeout without losing other groups, unicode highlighting and nonempty has_more. Do not add a Calendar navigation command until FE supplies a real handler.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --test unified_search_contract --test calendar_consumers`; expect new Event results and existing Project/Session/File/Note/Command regressions pass.

### Task 5: Extend typed backup v3 and atomic reset

**Outcome:** Stage 20 exports/imports Event definitions without silently losing a future settings section.

**Depends On:** Task 3.

**Files:** Create `src-tauri/src/calendar/backup.rs`; modify Calendar models/repository/service/mod, `src-tauri/src/app/data_participants.rs`, `src-tauri/src/settings/data.rs`, `data_participant.rs`, `src-tauri/tests/data_management_contract.rs`. Update constructor fixtures affected by the required Events participant in existing Rust tests.

**Interfaces:** BE-018 `EventBackupRecordV1`, `PreparedEventMerge`, `CalendarMaintenanceProjection`, `export_events_in`, `prepare_event_merge_in`, `apply_event_merge_in`, `reset_events_in`, `publish_event_maintenance`. Add `EventsDataParticipant` and concrete Events fields to existing `DataParticipants`, `PreparedImportPlans`, `ImportCommittedProjections`, `ResetCommittedProjections`. `BackupDataV3` stage-20 shape has required events and no notificationSettings field; parsed data keeps `events: Option<Vec<EventBackupRecordV1>>` to distinguish old versions.

- [x] Add a minimal valid stage-20 v3 fixture through existing `parse_backup`; `cargo test --manifest-path src-tauri/Cargo.toml --test data_management_contract` initially rejects version3 (the intended red). Keep v1/v2 fixtures unchanged; move unsupported-future-version assertions to4.
- [x] Implement v3 strict parser/export/counts/byte and record limits. Before typed decoding, reject any `notificationSettings` key including null with `DomainValidationFailed { domain: Settings }`; no preview, writes or event, never fake defaults. Other unknown keys remain invalid. Stage21 accepts absent field preserving local settings, and exports actual settings only after owner exists.
- [x] Clone incoming event records in app adapter and resolve optional project links through `ProjectImportMap::resolve`. Validate all typed fields/duplicate IDs before apply, keep original parsed package immutable and owner free of map/internal Project repository dependencies.
- [x] Apply incoming-wins event merge while retaining local-only events; recompute UTC/RRULE/search/revision, preserve unchanged reminder semantic IDs, deterministic UUID v5 remap on semantic collision using BE-018's namespace/name/attempt exactly. Test local/source/dangling project links and repeat prepare stability, malformed fields, duplicate reminder IDs and cross-event/offset conflicts.
- [x] Export deterministic event/reminder order; reject missing events in v3; v1/v2 skip Events participant. Apply Events after Projects/Notes; reset Events before Notes/Projects with cascade reminders. Prepared projection stays private/owned; publish once only after shared commit, no database requery or Result.
- [x] Reuse `DataManagementService::with_seams`/`with_files_seams`, fake DataPlatform/DataRuntimeControl/DataClock/DataEventSink and temp project/credential adapters from existing integration fixture. Inject late apply failure using an isolated SQLite abort trigger and assert ALL domains rollback plus zero Calendar/data emits; reset rollback preserves definitions. Scan exported serialized bytes for forbidden delivery/projection/raw RRULE/cache/revision and secret canaries.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --test data_management_contract --test calendar_consumers --lib`; expect golden round-trip, reject-without-mutation, counts, remap, reset and rollback assertions pass.

### Task 6: Wire composition, generate bindings and hand off to FE

**Outcome:** The real Tauri app manages the same Calendar service/gate for commands, search and backup and publishes the generated contract.

**Depends On:** Tasks 1–5.

**Files:** `src-tauri/src/app/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/tests/app_builder.rs`, `src-tauri/tests/export_bindings.rs`; generated `src/bindings/calendar.ts`, `src/bindings/search.ts`, and `src/bindings/data-management.ts` when output changes. Existing Rust tests using SearchService/DataParticipants constructors receive real isolated source fixtures. No new export binary: the spec's earlier binary path was stale and is corrected.

**Interfaces:** Managed CalendarService, shared DataMaintenanceGate, main-targeted event sink; actual six registered commands; generated BE-018 DTO/error/event types plus BE-010 Event target/source variants. No public backup/reminder helper commands and no new ACL permission.

- [x] Extend mock app tests to assert required state, six command registrations and main-only authorization. Use existing mock builder test seam; inject the isolated Storage construction failure from Task1 before service creation and assert startup fails without partially managed Calendar. Do not read production app-data.
- [x] Compose after migration0008 and Projects, before Search/Data participants. Use real owner adapters, no placeholder Reminder service. A sink can be injected for later BE019 fan-out; stage20 only emits to main.
- [x] Add ts-rs generation through current export_bindings test helper; run `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings`. First run may regenerate then intentionally fail; rerun must pass with no changed binding. Assert numeric timestamps/string revisions and no internal backup/clock/SQL types exported.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder --test export_bindings`, then every final gate below. Compare command registration list against exact six names and inspect capability diff to verify no widened permission; no runtime introspection API is assumed for ACL absence.
- [x] Record evidence and limitations in this active plan. Root commits completed BE feature as `Implement BE018`; no separate historical plan edit or review step.

## Final Verification

Run from repository root on Windows. The current pnpm scripts have been inspected for equivalent flags.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | No format errors |
| Frontend lint | `pnpm lint` | No lint errors |
| Type check | `pnpm typecheck` | Generated contract consumers compile |
| Frontend tests | `pnpm test` | All current unit/component tests pass |
| Frontend production | `pnpm build` | Production assets build |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | No warnings |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` | All unit/integration/contract tests pass, bindings stable |
| Windows desktop build | `pnpm tauri build` | Windows desktop bundle succeeds |
| Patch whitespace | `git diff --check` | No whitespace errors |

Native Windows smoke checklist for subsequent FE integration: create/edit/reopen timed and all-day recurring events, pick Calendar month/day/Upcoming, invoke detail from Search/Home/Project, round-trip a temp-data backup, and verify Quick Note stays unable to call Calendar commands. Stage20 BE does not add a temporary UI just for smoke. Native automation is disabled in this environment; keep any unexecuted items pending and carry them forward, never equate mock-runtime/build success with native smoke. macOS is deferred to release preparation.

## Deviations and Decisions

- 2026-09-09: User-authorized staging rule recorded in BE-012 and BE-018: v3 starts with Events, optional notificationSettings extension is supported later; old binary rejects present unsupported settings before mutation.
- Use current concrete participant structures and test-based binding exporter instead of speculative trait-registry refactor/new binary. Public typed maintenance semantics remain unchanged.
- Do not update completed historical plans. Any further contract-affecting decisions must be appended to active design and this plan while implementation runs.

## FE and BE-019 Handoff

- FE-021 detailed design then plan then implement; FE-022 detail/form design then plan then implement, following root's sequential per-feature commits. Both consume generated Calendar contract with real `src/lib/ipc/` wrappers and subscribe-before-fetch invalidation.
- FE can use ≤62-day month range, 14-day Upcoming, project filter and onlyWithReminders Home filter. All-day end is exclusive; timed DTO retains event timezone and resolved instants. Revision/occurrence/sequence are opaque; never expand recurrence in React.
- FE-022 must expose whole-series edit/delete, exact recurrence/end enums, ≤16 distinct offsets, conflict/reload handling and prepare/confirm delete TTL. FE-021 cannot present working Missed until BE019.
- FE aggregate extensions add event routes/results on Home, Project Overview and Search once actual detail handler exists; no cross-feature implementation imports. Search Event variants may require exhaustive frontend mapping adjustments only for compilation during BE; actual Event navigation is FE ownership.
- BE019 can consume read-only due/context ports and post-commit sink, add migrations0009/0010 and settings owner, read v3 backups missing notificationSettings without overwriting local values, and export real notificationSettings afterward.

## Outcome

Implementation is complete across Tasks 1–6; all required Windows automated gates passed. Calendar recurrence/model unit tests, focused CRUD/occurrence/consumer tests, the 36-test Data Management target, the 16-test app-builder target (including actual authorization for all six routes), Event Search tests, and the 14-test binding exporter have passed.

Execution adjustments: the migration red test failed at version 7 versus expected 8 before adding migration 0008. Strict enum deserialization also had an observed red test: serde accepted unknown fields on unit variants; private empty-struct wire variants now reject them. Other intermediate error-only scaffolds were replaced by direct implementation plus discovered focused behavioral targets; no zero-test command is counted as red evidence.

The reusable isolated fixture lives in `src-tauri/tests/calendar_support/mod.rs`. Minimal frontend exhaustive handling touches `src/app/search-entry.tsx` and `src/features/search/search-error-copy.ts`; real Event activation remains the next FE feature's responsibility. No capability permission was added.

The first fully parallel Rust build exhausted Windows linker memory (LNK1102); retry uses `cargo test -j 1` and Clippy `-j 1` with unchanged targets and warning flags. The first frontend suite had one pre-existing Markdown Preview timeout while Rust was linking (2566/2567 passed); retry uses `pnpm test --maxWorkers=2`. These resource-related attempts are recorded separately from final passing evidence and do not justify unrelated test/source changes.

Native Windows smoke is pending because native automation is disabled; macOS is deferred. Neither mock IPC tests nor desktop bundle creation substitutes for native smoke.

### Final verification evidence — 2026-09-09

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`: passed.
- `pnpm test --maxWorkers=2`: 149 test files and 2,567 tests passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 1 -- -D warnings`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --no-fail-fast -- --test-threads=1`: 590 passed, 1 pre-existing ignored test, across 30 reported targets including bin/doc targets with no tests. The Calendar targets executed 6 CRUD/migration tests, 3 occurrence tests and 1 consumer test; app-builder executed all six actual command routes with main/Quick Note authorization. The binding exporter passed all 14 contracts without regenerating output.
- `CARGO_BUILD_JOBS=1 pnpm tauri build`: passed; produced `src-tauri/target/release/xwork.exe` using the repository's existing bundling configuration (release compilation 7m27s).
- `git diff --check`: passed. No capability permissions changed.

Final logs are outside the repository under `%TEMP%`: `xwork-be018-rust-final.log`, `xwork-be018-clippy-pass.log`, `xwork-be018-rustfmt-final.log`, `xwork-be018-fe-format-check.log`, `xwork-be018-fe-lint.log`, `xwork-be018-fe-typecheck.log`, `xwork-be018-fe-test-final.log`, `xwork-be018-fe-build.log`, `xwork-be018-tauri-build.log`, and `xwork-be018-diff-check.log`.

Additional verification adjustments: current-schema assertions and complete table/index lists in pre-existing app/lifecycle/CLI/files/keyboard/notification/project/settings tests now include migration 0008. Historical migration SQL and v1/v2 backup compatibility fixtures are preserved. A parallel full Rust run stalled in the existing terminal cancellation test; serial test threads completed it. A later run observed the existing Project update-event timing assertion (three events versus four); the unchanged test passed in the final full retry after compilation ended. Avoid concurrent heavy linking and frontend tests in subsequent stages; use build jobs 1 and Rust test threads 1 in this Windows environment.

Native smoke remains pending as stated above. The root coordinator can commit this completed backend feature as `Implement BE018` and continue FE021 then FE022.
