pub mod cli_profiles;
pub mod commands;
mod manager;
mod models;
mod pty;
mod stream;

pub use cli_profiles::{
    BUILT_IN_CLAUDE_ID, BUILT_IN_CODEX_ID, BUILT_IN_TERMINAL_ID, CLI_PROFILES_CHANGED_EVENT,
    CliProfileAvailabilityDto, CliProfileAvailabilityStatusDto, CliProfileDto,
    CliProfileEnvironmentDto, CliProfileEnvironmentInputDto, CliProfileIdFactory,
    CliProfileInputDto, CliProfileKindDto, CliProfilesChangeKindDto, CliProfilesChangedDto,
    CliProfilesClock, CliProfilesError, CliProfilesEventSink, CliProfilesService,
    CliProfilesSnapshotDto, CliShellDto, ResolvedCliLaunchKind, ResolvedCliProfile,
    SystemCliProfilesClock, TauriCliProfilesEventSink, UuidCliProfileIdFactory,
};
pub use cli_profiles::{
    CliEnvironmentBackupRecordV1, CliProfileBackupRecordV1, CliProfileLaunchability,
    CliProfilesBackupV1, CliProfilesCommittedProjection, CliProfilesImportCounts,
    CliProfilesImportPlan,
};
pub use manager::{
    TERMINAL_STATE_CHANGED_EVENT, TerminalEventSink, TerminalManager, TerminalManagerWeak,
};
pub use models::{
    PtySizeDto, TerminalActivity, TerminalDependencies, TerminalDto, TerminalError, TerminalFuture,
    TerminalInputAckDto, TerminalPaneTarget, TerminalProcessStateDto,
    TerminalProfileUnavailableReasonDto, TerminalResizeAckDto, TerminalStateChangeKindDto,
    TerminalStateChangedDto, TerminalSubscriptionDto,
};
pub use pty::{NativePtyFactory, PtyCallbacks, PtyFactory, PtyProcess};
