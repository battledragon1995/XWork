# BE-010 Unified Search — Stage 12 Implementation Plan

**Status:** Backend implementation complete; ready for parent commit and FE-009 design handoff.

**Goal:** Expose one read-only `search_unified` command backed by real Projects, Sessions and Keyboard Shortcuts public queries, with deterministic ranked results and partial source failures.

**Completion Criteria:**

- Main-window IPC validates input, returns real Phase 1 targets and current shortcuts, and preserves successful results when another source fails.
- Ranking, Unicode highlights, caps, isolated adapter integration, generated bindings and production command registration have passing tests.
- Windows frontend gates, Rust all-target/all-feature gates and Tauri build pass with one Cargo build job.
- Backend completion is distinct from stage completion: FE-009 integration and targeted native Windows smoke must subsequently pass. Pending smoke is never marked passed.

**Architecture:** Search owns consumer ports, DTOs, ranking and request orchestration. Composition adapters consume public owner services; Search never owns storage, session internals or OS resources. No search persistence, cache, event or command execution is introduced.

**Tech Stack:** Existing Rust 1.98.0 / Edition 2024, Tauri 2.11.5, Tokio 1.53.1, serde, ts-rs and existing Windows toolchain. No new library or version upgrade.

**Sources:**

- `AGENTS.md`, `PLANS.md`, `00-Docs/99-Template/04-Plan.md`.
- `00-Docs/98-Plan/00-Roadmap.md`, stage 12.
- `00-Docs/00-Overview/01-TechStack.md`, `02-ProjectStructure.md`, `03-FunctionalRequirements.md` (§14, §18).
- `00-Docs/03-Backend/BE-010-unified-search.md`, including stage-12 decisions; its open questions are None.
- `00-Docs/02-Frontend/00-Overview.md`, FE-009 row; `FE-001-application-shell.md` for shell boundary.
- `00-Docs/01-Wireframe/02-AppShell.html#palette`: the `pty` example includes later-phase rows, which are excluded here.
- Current public contracts: `src-tauri/src/projects/service.rs`, `projects/models.rs`, `sessions/manager.rs`, `sessions/models.rs`, `settings/keyboard_shortcuts.rs`.
- Current composition/test patterns: `src-tauri/src/app/mod.rs`, `src-tauri/tests/app_builder.rs`, `sessions_runtime.rs`, `export_bindings.rs`; `src/lib/utils/session-status.ts` for established English status labels.
- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `rust-toolchain.toml`, `package.json` establish actual pinned versions and scripts.

FE-009 detailed design does not exist yet. This is not permission to implement its UI: BE-010 already specifies the backend boundary; the next FE design must consume that generated contract.

## Scope

**In Scope:** Phase 1 source ports/adapters, validation, ranking/highlighting, static/current-shortcut catalog, source deadlines/partial responses, composition registration, generated binding and isolated tests.

**Out of Scope:** FE-009 UI/IPC wrapper and FE-001 entry integration; Files/Notes/Events variants, source adapters and fixtures; search history/index/cache; action execution; migrations; permissions/plugins; backup/reset changes; macOS; automated desktop end-to-end tests; commits in this plan-only task. Historical plans remain unchanged.

## Global Constraints

- "Write code, identifiers, and code comments in English."
- "The initial UI language is English."
- "Generated bindings under `src/bindings/` are not edited manually."
- "Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state."
- Every function, method, callback, test and helper needs its short purpose comment; prefer `///`.
- Keep capability boundaries and narrowly scoped IPC. No runtime mock data for product behavior.
- Use UTF-8 Markdown. Only Windows verification; no automated desktop E2E.

## Assumptions, Risks, and Blockers

**Assumptions:** Stage 11 BE-011/FE-010 implementation and automated checks were completed and committed according to parent handoff. Native smoke remains pending; this plan does not assert stage 11 complete. Existing `list_projects(None)`, `list_sessions(None)` and `KeyboardShortcutsService::snapshot()` are sufficient; owner internals need no changes.

**Risks:**

- Sessions' public list itself consults project ordering; real owner failure can therefore legitimately fail both sources. A successful independent session snapshot must still survive a failed project enrichment snapshot.
- Tokio deadlines bound asynchronous waiting, not preemption of the synchronous shortcut snapshot or CPU ranking. Measure performance separately; do not claim a hard real-time guarantee.
- Binding tests regenerate stale output then fail once by design; rerun and record both outcomes.
- Known prior intermittent failure: `real_terminal_producer_reaches_notifications_without_frontend_listener` failed once on timing, then passed focused and full reruns. Record any recurrence, full command/output and subsequent evidence. Do not hide a failed run or automatically label it unrelated; investigate before claiming clean final verification. Do not weaken that test or change BE-011 opportunistically.

**Blockers:** None for BE implementation. FE design/integration and native smoke remain subsequent stage-completion obligations.

## Dependency Order

1. Phase 1 DTOs and pure ranking → service input/output contract.
2. Catalog and source orchestration → fake-port behavior verification.
3. Real adapters and production composition → actual owner/IPC integration.
4. Generated binding and full gates → handoff to FE design and implementation.

### Task 1: Establish the Phase 1 contract and deterministic ranking

**Outcome:** Validated input and Unicode-safe matching implement the BE-010 scoring table exactly.

**Depends On:** None.

**Files:** Create `src-tauri/src/search/mod.rs`, `src-tauri/src/search/ranking.rs`; modify `src-tauri/src/lib.rs`. Unit tests live in those modules.

**Interfaces:** Consume no owner internals. Produce Phase 1 `UnifiedSearchInputDto`, `SearchTextRangeDto`, `SearchResultKindDto`, `SearchShortcutDto`, `SearchTargetDto`, `SearchResultDto`, `SearchGroupDto`, `SearchSourceDto`, `SearchSourceFailureReasonDto`, `SearchSourceFailureDto`, `UnifiedSearchResponseDto`, `UnifiedSearchError` as specified. Only Project/Session/Command variants exist now. Struct and target variant fields are camelCase; discriminator literals snake_case. Internal ranking helpers remain private.

- [x] Add module declarations, minimal compilable types and test-discoverable helper signatures before red assertions. Test trim/128 versus 129 scalars, internal control characters, canonical lowercase hyphenated context UUID, all-token matching, exact/prefix/substring scores and bonuses, tie ordering, keyword-only matches and no accent folding.
- [x] Test lowercase expansion (`İ`), Vietnamese text, emoji before a highlight, adjacent/overlapping matches, whitespace collapse, title/context truncation including ellipsis, and no out-of-bounds or empty highlight ranges.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --lib search::`. Confirm nonzero discovered tests. Red must demonstrate a specific missing score, invalid-input rejection or scalar range, not missing modules or unrelated compile errors.
- [x] Implement only the documented normalization/projection algorithm; keep target identities unmodified. Commands with keyword-only matches return empty display highlights.
- [x] Rerun the same command; all discovered search unit tests pass. Later tasks add their unit tests under the same module filter.

### Task 2: Build catalog and independent source orchestration

**Outcome:** Empty-query suggestions, nonempty grouped search and partial failures behave deterministically.

**Depends On:** Task 1.

**Files:** Create `src-tauri/src/search/service.rs`; modify `src-tauri/src/search/mod.rs`, `src-tauri/Cargo.toml`; allow Cargo-generated `src-tauri/Cargo.lock` change only if needed.

**Interfaces:** Produce `SearchService` constructed with `Arc<dyn ProjectSearchSource>`, `Arc<dyn SessionSearchSource>` and `Arc<dyn ShortcutCatalogSource>`. Expose a fallible constructor and request method accepting validated input; constructor collision maps to `UnifiedSearchError::Unavailable`. Port signatures/documents are the Phase 1 subset in BE-010. These ports are the exact test seam: immutable fixture vectors, call counters, explicit errors and pending futures replace all external services. No File/Note/Event port or generic phase registry is required now.

Dependency change is limited to adding this complete entry under `[dev-dependencies]`:

```toml
tokio = { version = "=1.53.1", features = ["rt", "time", "test-util"] }
```

Keep existing production entry unchanged:

```toml
tokio = { version = "=1.53.1", features = ["sync", "time"] }
```

Version is already pinned in the repository; no version choice is delegated. Validate added features against the pinned toolchain with `cargo check --manifest-path src-tauri/Cargo.toml -j 1 --all-targets --all-features` during implementation, not during planning. Use a current-thread Tokio test runtime with controlled time; macros are not necessary.

- [ ] Add compilable service skeleton and fake ports, then red assertions: empty input must return static suggestions; unavailable source must preserve another matching group; 9 matches must return 8 with `hasMore`; conflicting shortcut must remain in the catalog.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --lib search::`; verify actual failures on those assertions and nonzero test count.
- [x] Implement seven static commands, dynamic current-context session creation, shortcut snapshot mapping and palette-action exclusion. Read current snapshot per request; conflict flag derives from nonempty `conflicts_with`, not `is_dispatchable` filtering.
- [x] Test catalog collision at construction by injecting a shortcut action whose ID is `navigation.open_home`: constructor fails with `Unavailable`; no managed service is published. Snapshot unavailable permits degraded construction and static responses with Commands failure; later recovery is visible without restart. Recheck collision per query.
- [x] Poll project/session futures concurrently. Use controlled Tokio time and explicit pending/ready synchronization to prove both entered before either completes; 400 ms source timeout and overall 500 ms wait bound preserve completed results. No wall-clock sleep or process-global clock/environment mutation.
- [x] Validate duplicate identity as a whole-source failure, stable group/failure order, unavailable contextual project omission, query-empty source call counts, session enrichment fallback, snapshot errors and concurrent request independence. Query errors call no source.
- [x] Rank complete Phase 1 lists before cap, not first 64 input rows; test a match beyond row 64. Phase 1 response cap is 24, per-group cap 8. All split flags false; no future-phase group/failure/type appears.
- [x] Rerun the search unit command and all-target/all-feature check; all pass.

### Task 3: Connect real public services and the production command boundary

**Outcome:** Main-window invoke reaches real owner queries through composition adapters with no search writes.

**Depends On:** Task 2.

**Files:** Create `src-tauri/src/app/search_sources.rs`, `src-tauri/tests/unified_search_contract.rs`; modify `src-tauri/src/app/mod.rs`, `src-tauri/src/search/mod.rs`; extend `src-tauri/tests/app_builder.rs`.

**Interfaces:** Adapters consume `ProjectService::list_projects(None)`, `SessionManager::list_sessions(None)`, `KeyboardShortcutsService::snapshot()` and project their public DTOs in returned order. Produce `search_unified(window, input, state) -> Result<UnifiedSearchResponseDto, UnifiedSearchError>` with a generic Tauri runtime parameter if needed to use existing MockRuntime tests. Register it exactly once in `app_invoke_handler`; manage Search after all three source services exist. No startup domain enumeration or native action is needed beyond the catalog check.

Test seams: add `configure_with_search_for_tests(builder, app_data_dir, project_collaborators, cli_profile_collaborators)` in `app/mod.rs`, following `configure_with_cli_profiles_for_tests` but accepting both existing collaborator tuples. Delegate to the same private `configure_app`, disable native CLI hydration, tray and native terminal interactions, and use initial visible state. Inject fixture Projects picker/rejecting opener, fake credential/command/environment collaborators and recording event sinks. Exercise production composition in an owned `TempDir` with disposable project folders. Do not reuse `configure_with_projects_for_tests` unchanged: it enables native CLI collaborators and hydration. Do not launch PTY, resolve credentials or use the real app-data resolver. For pure service fault cases use Task 2 ports. Use existing `SessionManager::with_seams` with fake `ProjectSessionAccess`, `CliProfileLookup`, `PaneContentRuntime` and event sink when a standalone runtime fixture is needed; do not introduce a second service locator.

- [ ] Add discoverable integration target and assertions before command implementation. Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test unified_search_contract`; expected red is unregistered `search_unified` invocation or wrong typed response, not zero tests.
- [x] Implement adapters and thin caller/input validation. Map raw owner errors to source Unavailable without content/path logging. Register Search in shared production/test setup without changing prior lifecycle order or migration registry.
- [x] Test real add/rename/pin/unavailable project projection; create/rename/delete session projection; shortcut override/conflict snapshot visibility. Query must not mutate owner snapshots, emit domain changes, spawn content or update last-opened timestamps. Record event counters before search; compare public snapshots and isolated database state before/after search. Initialization writes are excluded from that comparison.
- [x] Invoke through the existing production handler with main and non-main MockRuntime windows: main succeeds; non-main returns unauthorized; malformed inputs fail before fake source counters change. Verify camelCase target keys, discriminator/target/group consistency and typed errors in JSON.
- [x] Test removed context ID is omitted from contextual commands; stale result selection remains owner responsibility and search performs no activation. A follow-up query reflects completed deletion.
- [x] Extend `app_builder` to assert managed Search and exercise the registered command on isolated owner fixtures. Constructor collision failure is covered in Task 2; no hypothetical new storage startup mode is introduced.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test unified_search_contract` and `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test app_builder`; expect all tests pass with nonzero counts.
- [x] Inspect implementation diff/imports to establish no Search Storage/repository/OS dependencies, new migration, permission/plugin or search event. Registration cardinality is checked in the source diff; do not invent a Tauri runtime command-enumeration API.

### Task 4: Generate the binding and establish handoff evidence

**Outcome:** FE implementer receives the actual Rust-derived Phase 1 contract and accurate verification status.

**Depends On:** Task 3.

**Files:** Modify `src-tauri/tests/export_bindings.rs`; generate `src/bindings/search.ts`; update this active plan with execution evidence. No standalone export binary.

**Interfaces:** Generate all Task 1 public types/errors with the existing `ts-rs` aggregate pattern. Source ports, runtime internals and future-phase variants must not leak into output.

- [x] Add aggregate export and `search_binding_matches_rust_contract` test using `assert_binding_is_current`. Assert target fields `projectId`, `sessionId`, `actionId`; reject snake_case target fields and future-phase variants.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test export_bindings`. Expected first red: `bindings were regenerated; rerun the test to verify a clean output`. Rerun to establish clean pass; do not manually rewrite generated TypeScript.
- [x] Execute final gates sequentially, capture exit codes/counts and record failures honestly. Fix failures attributable to this work and rerun affected gates. Do not automatically retry until green without diagnosis.
- [x] Hand off generated input/response/error types, target semantics, current-shortcut conflict behavior, empty/partial response examples and scalar highlight interpretation to FE-009 design. UI debounce/sequence/focus/dispatch are FE responsibilities.

## Final Verification

Run from repository root on Windows. Set `$env:CARGO_BUILD_JOBS = '1'` for this execution shell, including the Tauri build; explicit Cargo commands also use `-j 1`. This build setting is not a test-isolation mechanism.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | Pass |
| Frontend lint | `pnpm lint` | Pass |
| Types | `pnpm typecheck` | Generated contract accepted |
| Frontend regression | `pnpm test` | All tests pass |
| Frontend build | `pnpm build` | Pass |
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No diff |
| Rust lint | `cargo clippy --manifest-path src-tauri/Cargo.toml -j 1 --all-targets --all-features -- -D warnings` | No warnings |
| Rust regression | `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --all-targets --all-features` | All targets pass; retain timing-failure history |
| Windows bundling | `pnpm tauri build` | Build succeeds; required now because invoke registration changed |
| Document whitespace | `git diff --check` | Pass |

Focused integration commands above explicitly select every planned integration target. Final test flags intentionally exceed `pnpm test:rust`, which lacks all-target/all-feature flags. Do not run concurrent Cargo builds.

Targeted Windows smoke is pending until an isolated environment is available. After FE integration, verify opening palette by pill/current shortcut, actual project/session navigation, contextual session creation, settings commands, conflict handling and Unicode highlights against disposable data; confirm terminal continuity and shell notification entry still work. Measure Phase 1 p95 below 150 ms on a recorded supported Windows machine with uncontended real sources and a documented disposable dataset. Report sample count/dataset/timing method; deterministic timer tests are not performance evidence. No automated desktop E2E or real-user app-data testing.

## Execution Evidence

Implementation completed against `46bf878` without a commit. Search now owns Phase 1 DTOs, validation, ranking, source ports, static/current shortcut catalog and partial-response orchestration. Composition adapters call only `ProjectService::list_projects(None)`, `SessionManager::list_sessions(None)` and `KeyboardShortcutsService::snapshot()`. The production handler registers one `search_unified` command and manages one `SearchService` after all source owners are ready.

Changed paths:

- `00-Docs/03-Backend/BE-010-unified-search.md`
- `00-Docs/98-Plan/20260906-be-010-unified-search.md`
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/src/search/mod.rs`
- `src-tauri/src/search/ranking.rs`
- `src-tauri/src/search/service.rs`
- `src-tauri/src/app/mod.rs`
- `src-tauri/src/app/search_sources.rs`
- `src-tauri/tests/unified_search_contract.rs`
- `src-tauri/tests/app_builder.rs`
- `src-tauri/tests/export_bindings.rs`
- `src/bindings/search.ts`

Verification evidence on Windows with `CARGO_BUILD_JOBS=1`:

- Focused Search unit suite: 22 passed; covers scalar validation/highlights, exact scoring tiers, whitespace normalization, matching/ranking, caps/ties, duplicates, degraded recovery, source failures, concurrent requests and controlled concurrent deadlines.
- `unified_search_contract`: 2 passed using disposable project/app-data directories and real owner commands/queries; covers main-window authorization, typed JSON/camelCase targets, project and session lifecycle projection, current shortcut conflicts, unavailable/removed context and read-only snapshots.
- `app_builder`: 14 passed; Search managed state and command routing are present in shared composition.
- `export_bindings`: first run regenerated `src/bindings/search.ts` and failed with the expected drift message; clean rerun passed 9/9.
- Frontend gates: format checked 248 files; lint checked 248 files; typecheck passed; 97 test files and 1,770 tests passed; production build passed with the pre-existing chunk-size advisory.
- Rustfmt passed. Clippy passed for all targets/features with warnings denied.
- Final Rust regression passed with `--all-targets --all-features -- --test-threads=1`: 269 library tests and every integration/Windows target passed, 471 tests total. `real_terminal_producer_reaches_notifications_without_frontend_listener` passed; the known BE-011 timing failure did not recur.
- The first parallel-harness full Rust run was interrupted after 260/261 library tests when existing test `shutdown_during_owner_resolution_prevents_spawn` made no progress for several minutes. That exact test then passed alone immediately. The complete single-thread harness rerun passed, preserving all required Cargo flags and avoiding test-harness contention.
- `pnpm tauri build` passed and produced `src-tauri/target/release/xwork.exe`; it retained the existing `.app` bundle-identifier and frontend chunk-size advisories.
- `git diff --check` passed. Source inspection found no Search import of Storage, repository, filesystem/OS access, migration, permission/plugin or event publication.

Native Command Palette smoke and the Phase 1 p95 measurement remain pending because FE-009 is not implemented and no isolated interactive Windows smoke environment was available. They are stage-level follow-up work and are not reported as passed.

## Deviations and Decisions

- Authorized autonomous ambiguity resolution is recorded in BE-010, not left to unanswered questions.
- Stage 12 excludes future source/type scaffolding; complete Phase 1 metadata is ranked before group caps.
- Existing test-based binding generation replaces the spec's previously proposed export binary.
- Session results survive missing project enrichment; status text follows current UI labels.
- Added dev-only Tokio features retain the existing exact version and passed all-target/all-feature check, test and Clippy gates on Rust 1.98.0.
- Source futures use a small local two-future poller because the pinned production Tokio feature set does not include macros. Per-source 400 ms timeouts are nested under the 500 ms request wait and are verified with paused Tokio time.
- The planned red-first chronology was not reconstructed for four checklist steps: the first focused compile failed on Tokio macro availability, keyword iteration and mutability before behavior assertions could run, and the integration target was added after command registration. Those historical sequencing boxes remain unchecked; final behavior, contract and regression coverage all pass and there is no remaining backend scope gap.
- Coordinator does not review source; implementation agent owns verification and records evidence. This plan self-check is document verification, not an implementation review.

## Outcome

BE-010 Phase 1 backend implementation and automated verification are complete. The generated contract is ready for FE-009 detailed design and integration. Parent owns commit `Implement BE010`; this task intentionally did not commit. Stage 12 remains open until FE-009 and the targeted native Windows smoke/performance evidence are complete.

