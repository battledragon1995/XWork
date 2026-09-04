//! Process-local session, tab, and pane runtime ownership.

// The public confirmation variant intentionally carries its complete impact DTO.
#![allow(clippy::result_large_err)]

pub mod commands;
mod error;
mod manager;
mod models;

pub use error::SessionsError;
pub use manager::{SESSION_RUNTIME_CHANGED_EVENT, SessionEventSink, SessionManager};
pub use models::{
    CliProfileLookup, CloseImpactDto, CloseResultDto, CloseRetention, CloseTargetDto,
    LaunchableProfile, PaneActivitySnapshot, PaneCloseImpact, PaneContentDto, PaneContentOwner,
    PaneContentRef, PaneContentRuntime, PaneDto, PaneLayoutNodeDto, PaneRuntimeFuture,
    ProjectSessionAccess, ProjectSessionAvailability, ProjectSessionsImpact, ReopenHandle,
    SessionAttentionSnapshot, SessionChangeKindDto, SessionDetailDto, SessionNotificationContext,
    SessionRuntimeEventDto, SessionStatusDto, SessionSummaryDto, ShutdownImpact, SplitAxisDto,
    SplitDirectionDto, TabDto,
};
