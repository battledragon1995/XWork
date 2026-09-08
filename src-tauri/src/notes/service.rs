use super::{NotesError, models::*, repository as repo, search};
use crate::{shared::DataMaintenanceGate, storage::Storage};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Runtime};
pub const NOTES_CHANGED_EVENT: &str = "notes://changed";
/// Supplies independent wall and monotonic clocks for deterministic tests.
pub trait NotesClock: Send + Sync {
    /// Returns fallible Unix milliseconds.
    fn now_ms(&self) -> Result<i64, NotesError>;
    /// Returns monotonic elapsed time for confirmation expiration.
    fn elapsed(&self) -> Duration;
}
/// Uses operating-system clocks without storing user information.
pub struct SystemNotesClock {
    started: Instant,
}
impl Default for SystemNotesClock {
    /// Starts an independent monotonic epoch.
    fn default() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}
impl NotesClock for SystemNotesClock {
    /// Converts wall time without wrapping its public integer representation.
    fn now_ms(&self) -> Result<i64, NotesError> {
        i64::try_from(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(
                    // Rejects pre-epoch system time.
                    |_| NotesError::ClockFailed,
                )?
                .as_millis(),
        )
        .map_err(
            // Rejects overflow rather than inventing timestamps.
            |_| NotesError::ClockFailed,
        )
    }
    /// Returns elapsed monotonic time for pending requests.
    fn elapsed(&self) -> Duration {
        self.started.elapsed()
    }
}
/// Publishes safe post-commit invalidation events.
pub trait NotesEventSink: Send + Sync {
    /// Attempts publication without changing a committed command result.
    fn emit(&self, event: NoteChangedEventDto) -> Result<(), NotesError>;
}
/// Sends the sole Notes event exclusively to the main window.
pub struct TauriNotesEventSink<R: Runtime>(pub tauri::AppHandle<R>);
impl<R: Runtime> NotesEventSink for TauriNotesEventSink<R> {
    /// Emits the typed invalidation after a successful commit.
    fn emit(&self, event: NoteChangedEventDto) -> Result<(), NotesError> {
        self.0.emit_to("main", NOTES_CHANGED_EVENT, event).map_err(
            // Redacts event transport failures.
            |_| NotesError::PersistenceFailed,
        )
    }
}
struct Pending {
    impact: EmptyNotesTrashImpactDto,
    fingerprint: Vec<(String, String)>,
    created: Duration,
}
struct MutationState {
    sequence: u64,
    next_request: u32,
    pending: Option<Pending>,
}
struct Inner {
    storage: Storage,
    gate: DataMaintenanceGate,
    clock: Arc<dyn NotesClock>,
    events: Arc<dyn NotesEventSink>,
    state: Mutex<MutationState>,
}
/// Owns durable Notes and serializes all revision-sensitive mutations.
#[derive(Clone)]
pub struct NotesService {
    inner: Arc<Inner>,
}
enum Mutation {
    Save(Option<String>, String),
    Pin(bool),
    Project(Option<String>),
    Archive,
    RestoreArchive,
    Trash,
    RestoreTrash,
    Delete,
}
/// Validates canonical UUIDs without accepting alternate spellings.
fn canonical_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(
        // Requires the canonical lowercase hyphenated representation.
        |value| value.hyphenated().to_string() == id,
    )
}
/// Validates a note identity before touching persistence.
fn note_id(id: &str) -> Result<(), NotesError> {
    if canonical_id(id) {
        Ok(())
    } else {
        Err(NotesError::InvalidNoteId)
    }
}
/// Validates optional project identifiers independently of their availability.
fn project_id(id: &Option<String>) -> Result<(), NotesError> {
    if id.as_deref().is_none_or(canonical_id) {
        Ok(())
    } else {
        Err(NotesError::InvalidProjectId)
    }
}
/// Parses the canonical positive revision used for optimistic concurrency.
fn revision(value: &str) -> Result<i64, NotesError> {
    let parsed = value.parse::<i64>().map_err(
        // Hides invalid integer details.
        |_| NotesError::InvalidRevision,
    )?;
    if parsed < 1 || parsed.to_string() != value {
        Err(NotesError::InvalidRevision)
    } else {
        Ok(parsed)
    }
}
/// Normalizes nullable titles and validates their scalar limit.
fn title(value: Option<String>) -> Result<Option<String>, NotesError> {
    let Some(value) = value else { return Ok(None) };
    if value.chars().any(char::is_control) {
        return Err(NotesError::InvalidTitle);
    }
    let value = value.trim();
    if value.chars().count() > 255 {
        return Err(NotesError::InvalidTitle);
    }
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value.into()))
    }
}
/// Enforces the UTF-8 content byte cap while preserving all text.
fn content(value: &str) -> Result<(), NotesError> {
    if value.len() > 1048576 {
        Err(NotesError::ContentTooLarge)
    } else {
        Ok(())
    }
}
/// Allocates the next durable revision without overflow.
fn next_revision(value: &str) -> Result<String, NotesError> {
    Ok(revision(value)?
        .checked_add(1)
        .ok_or(NotesError::RevisionExhausted)?
        .to_string())
}
impl NotesService {
    /// Creates the owner using explicit isolated or production collaborators.
    pub fn with_seams(
        storage: Storage,
        gate: DataMaintenanceGate,
        clock: Arc<dyn NotesClock>,
        events: Arc<dyn NotesEventSink>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                storage,
                gate,
                clock,
                events,
                state: Mutex::new(MutationState {
                    sequence: 0,
                    next_request: 1,
                    pending: None,
                }),
            }),
        }
    }
    /// Exposes gate identity for composition contract tests.
    pub fn maintenance_gate(&self) -> DataMaintenanceGate {
        self.inner.gate.clone()
    }
    /// Executes database and text projection work off the async runtime.
    async fn blocking<T: Send + 'static>(
        &self,
        operation: impl FnOnce(Self) -> Result<T, NotesError> + Send + 'static,
    ) -> Result<T, NotesError> {
        let service = self.clone();
        tauri::async_runtime::spawn_blocking(
            // Moves owned service state into the blocking worker.
            move || operation(service),
        )
        .await
        .map_err(
            // Redacts worker failure at the command boundary.
            |_| NotesError::PersistenceFailed,
        )?
    }
    /// Validates clock output before any timestamp is persisted.
    fn now(&self) -> Result<i64, NotesError> {
        let now = self.inner.clock.now_ms()?;
        if now < 0 {
            Err(NotesError::ClockFailed)
        } else {
            Ok(now)
        }
    }
    /// Publishes one sequenced invalidation under the mutation lock.
    fn publish(&self, state: &mut MutationState, kind: NoteChangeKindDto, note: Option<&NoteDto>) {
        state.sequence = state.sequence.saturating_add(1);
        let _ = self.inner.events.emit(NoteChangedEventDto {
            sequence: state.sequence.to_string(),
            kind,
            note_id: note.map(
                // Includes identity only for individual changes.
                |note| note.id.clone(),
            ),
            revision: note.map(
                // Includes the committed revision for individual invalidations.
                |note| note.revision.clone(),
            ),
        });
    }
    /// Lists one validated page with global lifecycle counts.
    pub async fn list_notes(
        &self,
        input: ListNotesInputDto,
    ) -> Result<NoteListPageDto, NotesError> {
        if !(1..=100).contains(&input.limit) {
            return Err(NotesError::InvalidPagination);
        }
        if input.status != NoteStatusDto::Active && input.pinned_filter != NotePinnedFilterDto::Any
        {
            return Err(NotesError::InvalidFilter);
        }
        if let NoteProjectFilterDto::Project { project_id: id } = &input.project_filter {
            project_id(&Some(id.clone()))?;
        }
        let tokens = search::tokens(input.query.as_deref().unwrap_or(""))?;
        self.blocking(
            // Reads page and counts under one serialized connection snapshot.
            move |service| {
                service.inner.storage.with_connection(
                    // Delegates SQL and snippet projection to the owner repository.
                    |db| repo::list(db, &input, &tokens),
                )
            },
        )
        .await
    }
    /// Reads a complete record in any lifecycle state.
    pub async fn get_note(&self, id: String) -> Result<NoteDto, NotesError> {
        note_id(&id)?;
        self.blocking(
            // Reads the requested note on a blocking worker.
            move |service| {
                service.inner.storage.with_connection(
                    // Reads only this canonical identity.
                    |db| repo::get(db, &id),
                )
            },
        )
        .await
    }
    /// Creates an active revision-one record only after meaningful body input.
    pub async fn create_note(&self, input: CreateNoteInputDto) -> Result<NoteDto, NotesError> {
        let title = title(input.title)?;
        content(&input.content_markdown)?;
        project_id(&input.project_id)?;
        if input.content_markdown.trim().is_empty() {
            return Err(NotesError::EmptyInitialContent);
        }
        let permit = self.inner.gate.read_permit().await;
        self.blocking(
            // Keeps admission alive through commit and event publication.
            move |service| {
                let _permit = permit;
                let mut state = service.inner.state.lock().map_err(
                    // Redacts poisoned synchronization state.
                    |_| NotesError::PersistenceFailed,
                )?;
                let now = service.now()?;
                let note = NoteDto {
                    id: uuid::Uuid::new_v4().to_string(),
                    title,
                    content_markdown: input.content_markdown,
                    project_id: input.project_id,
                    is_pinned: false,
                    status: NoteStatusDto::Active,
                    trashed_from: None,
                    created_at_ms: now,
                    updated_at_ms: now,
                    archived_at_ms: None,
                    trashed_at_ms: None,
                    revision: "1".into(),
                };
                service.inner.storage.with_transaction(
                    // Atomically persists the row and derived text.
                    |tx| repo::put(tx, &note),
                )?;
                service.publish(&mut state, NoteChangeKindDto::Created, Some(&note));
                Ok(note)
            },
        )
        .await
    }
    /// Applies a revision-sensitive mutation with commit-before-publication ordering.
    async fn mutate(
        &self,
        input: NoteRevisionInputDto,
        change: Mutation,
    ) -> Result<NoteDto, NotesError> {
        note_id(&input.note_id)?;
        revision(&input.expected_revision)?;
        let permit = self.inner.gate.read_permit().await;
        self.blocking(
            // Holds the gate before the mutation lock and database transaction.
            move |service| {
                let _permit = permit;
                let mut state = service.inner.state.lock().map_err(
                    // Redacts lock poisoning.
                    |_| NotesError::PersistenceFailed,
                )?;
                let (note, kind) = service.inner.storage.with_transaction(
                    // Checks revision and writes in the same immediate transaction.
                    |tx| {
                        let mut note = repo::get(tx, &input.note_id)?;
                        if note.revision != input.expected_revision {
                            return Err(NotesError::RevisionConflict {
                                current: Box::new(note),
                            });
                        }
                        let original = note.clone();
                        let editable = matches!(
                            change,
                            Mutation::Save(..) | Mutation::Pin(..) | Mutation::Project(..)
                        );
                        if editable && note.status != NoteStatusDto::Active {
                            return Err(NotesError::NoteNotEditable {
                                status: note.status,
                            });
                        }
                        let kind = match change {
                            Mutation::Save(title, body) => {
                                if note.title == title && note.content_markdown == body {
                                    return Ok((note, None));
                                }
                                note.title = title;
                                note.content_markdown = body;
                                note.updated_at_ms = service.now()?.max(
                                    note.updated_at_ms
                                        .checked_add(1)
                                        .ok_or(NotesError::ClockFailed)?,
                                );
                                NoteChangeKindDto::Autosaved
                            }
                            Mutation::Pin(pinned) => {
                                note.is_pinned = pinned;
                                NoteChangeKindDto::PinnedChanged
                            }
                            Mutation::Project(project) => {
                                note.project_id = project;
                                NoteChangeKindDto::ProjectChanged
                            }
                            Mutation::Archive if note.status == NoteStatusDto::Active => {
                                note.status = NoteStatusDto::Archived;
                                note.archived_at_ms = Some(service.now()?.max(note.created_at_ms));
                                NoteChangeKindDto::Archived
                            }
                            Mutation::RestoreArchive if note.status == NoteStatusDto::Archived => {
                                note.status = NoteStatusDto::Active;
                                note.archived_at_ms = None;
                                NoteChangeKindDto::Restored
                            }
                            Mutation::Trash if note.status != NoteStatusDto::Trash => {
                                note.trashed_from = Some(if note.status == NoteStatusDto::Active {
                                    NotePreviousStatusDto::Active
                                } else {
                                    NotePreviousStatusDto::Archived
                                });
                                note.status = NoteStatusDto::Trash;
                                note.trashed_at_ms = Some(service.now()?.max(note.created_at_ms));
                                NoteChangeKindDto::Trashed
                            }
                            Mutation::RestoreTrash if note.status == NoteStatusDto::Trash => {
                                note.status =
                                    if note.trashed_from == Some(NotePreviousStatusDto::Archived) {
                                        NoteStatusDto::Archived
                                    } else {
                                        NoteStatusDto::Active
                                    };
                                note.trashed_from = None;
                                note.trashed_at_ms = None;
                                NoteChangeKindDto::Restored
                            }
                            Mutation::Delete if note.status == NoteStatusDto::Trash => {
                                repo::delete(tx, &note.id)?;
                                return Ok((note, Some(NoteChangeKindDto::PermanentlyDeleted)));
                            }
                            _ => {
                                return Err(NotesError::InvalidTransition {
                                    status: note.status,
                                });
                            }
                        };
                        if note == original {
                            return Ok((note, None));
                        }
                        note.revision = next_revision(&note.revision)?;
                        repo::put(tx, &note)?;
                        Ok((note, Some(kind)))
                    },
                )?;
                if let Some(kind) = kind {
                    service.publish(&mut state, kind, Some(&note));
                }
                Ok(note)
            },
        )
        .await
    }
    /// Autosaves full text without overwriting a newer revision.
    pub async fn autosave_note(&self, input: AutosaveNoteInputDto) -> Result<NoteDto, NotesError> {
        let title = title(input.title)?;
        content(&input.content_markdown)?;
        self.mutate(
            NoteRevisionInputDto {
                note_id: input.note_id,
                expected_revision: input.expected_revision,
            },
            Mutation::Save(title, input.content_markdown),
        )
        .await
    }
    /// Changes only the pin flag on active Notes.
    pub async fn set_note_pinned(
        &self,
        input: SetNotePinnedInputDto,
    ) -> Result<NoteDto, NotesError> {
        self.mutate(
            NoteRevisionInputDto {
                note_id: input.note_id,
                expected_revision: input.expected_revision,
            },
            Mutation::Pin(input.pinned),
        )
        .await
    }
    /// Changes only a canonical optional project link.
    pub async fn set_note_project(
        &self,
        input: SetNoteProjectInputDto,
    ) -> Result<NoteDto, NotesError> {
        project_id(&input.project_id)?;
        self.mutate(
            NoteRevisionInputDto {
                note_id: input.note_id,
                expected_revision: input.expected_revision,
            },
            Mutation::Project(input.project_id),
        )
        .await
    }
    /// Archives an active record while retaining its edited time.
    pub async fn archive_note(&self, input: NoteRevisionInputDto) -> Result<NoteDto, NotesError> {
        self.mutate(input, Mutation::Archive).await
    }
    /// Restores an archived record to Active.
    pub async fn restore_archived_note(
        &self,
        input: NoteRevisionInputDto,
    ) -> Result<NoteDto, NotesError> {
        self.mutate(input, Mutation::RestoreArchive).await
    }
    /// Remembers the previous lifecycle before moving a record into Trash.
    pub async fn move_note_to_trash(
        &self,
        input: NoteRevisionInputDto,
    ) -> Result<NoteDto, NotesError> {
        self.mutate(input, Mutation::Trash).await
    }
    /// Restores the persisted lifecycle of a trashed record.
    pub async fn restore_note_from_trash(
        &self,
        input: NoteRevisionInputDto,
    ) -> Result<NoteDto, NotesError> {
        self.mutate(input, Mutation::RestoreTrash).await
    }
    /// Permanently deletes exactly one revision-validated Trash row.
    pub async fn delete_note_permanently(
        &self,
        input: NoteRevisionInputDto,
    ) -> Result<DeletedNoteDto, NotesError> {
        let note = self.mutate(input, Mutation::Delete).await?;
        Ok(DeletedNoteDto { note_id: note.id })
    }
    /// Captures a complete fingerprint and ten recent display names.
    fn pending(
        &self,
        db: &rusqlite::Connection,
        state: &mut MutationState,
    ) -> Result<Pending, NotesError> {
        let mut notes = repo::all(db)?
            .into_iter()
            .filter(
                // Restricts the destructive preview to Trash.
                |note| note.status == NoteStatusDto::Trash,
            )
            .collect::<Vec<_>>();
        if notes.is_empty() {
            return Err(NotesError::TrashEmpty);
        }
        let fingerprint = notes
            .iter()
            .map(
                // Fingerprints every identity and revision in repository identity order.
                |note| (note.id.clone(), note.revision.clone()),
            )
            .collect();
        notes.sort_by(
            // Displays the most recently trashed notes with an identity tie-break.
            |a, b| {
                b.trashed_at_ms.cmp(&a.trashed_at_ms).then_with(
                    // Breaks timestamp ties with stable note identity.
                    || a.id.cmp(&b.id),
                )
            },
        );
        let request_id = state.next_request;
        state.next_request = state.next_request.wrapping_add(1).max(1);
        let impact = EmptyNotesTrashImpactDto {
            request_id,
            note_count: notes.len() as u32,
            has_more: notes.len() > 10,
            notes: notes
                .into_iter()
                .take(10)
                .map(
                    // Supplies a display fallback without persisting it.
                    |note| TrashNoteLabelDto {
                        note_id: note.id,
                        display_title: note.title.unwrap_or_else(
                            // Supplies a display-only fallback for nullable titles.
                            || "Untitled note".into(),
                        ),
                    },
                )
                .collect(),
        };
        Ok(Pending {
            impact,
            fingerprint,
            created: self.inner.clock.elapsed(),
        })
    }
    /// Prepares a replaceable five-minute Empty Trash confirmation.
    pub async fn prepare_empty_notes_trash(&self) -> Result<EmptyNotesTrashImpactDto, NotesError> {
        self.blocking(
            // Serializes preview replacement with ordinary Notes mutations.
            move |service| {
                let mut state = service.inner.state.lock().map_err(
                    // Redacts synchronization or persistence failure details.
                    |_| NotesError::PersistenceFailed,
                )?;
                let pending = service.inner.storage.with_connection(
                    // Reads all fingerprint rows without a maintenance reentry.
                    |db| service.pending(db, &mut state),
                )?;
                let impact = pending.impact.clone();
                state.pending = Some(pending);
                Ok(impact)
            },
        )
        .await
    }
    /// Confirms only the unchanged, unexpired preview and deletes atomically.
    pub async fn confirm_empty_notes_trash(
        &self,
        request_id: u32,
    ) -> Result<EmptyNotesTrashResultDto, NotesError> {
        let permit = self.inner.gate.read_permit().await;
        self.blocking(
            // Keeps shared admission through deletion and bulk publication.
            move |service| {
                let _permit = permit;
                let mut state = service.inner.state.lock().map_err(
                    // Redacts synchronization or persistence failure details.
                    |_| NotesError::PersistenceFailed,
                )?;
                let pending = state
                    .pending
                    .as_ref()
                    .ok_or(NotesError::NoPendingTrashOperation)?;
                if pending.impact.request_id != request_id
                    || service
                        .inner
                        .clock
                        .elapsed()
                        .saturating_sub(pending.created)
                        >= Duration::from_secs(300)
                {
                    return Err(NotesError::StaleTrashRequest);
                }
                let expected = pending.fingerprint.clone();
                let outcome = service.inner.storage.with_transaction(
                    // Rechecks the entire Trash before the destructive statement.
                    |tx| {
                        let current = match service.pending(tx, &mut state) {
                            Ok(value) => Some(value),
                            Err(NotesError::TrashEmpty) => None,
                            Err(error) => return Err(error),
                        };
                        if current.as_ref().map(
                            // Compares the full prepared identity and revision set.
                            |pending| &pending.fingerprint,
                        ) != Some(&expected)
                        {
                            return Ok(Err(current));
                        }
                        let count = tx.execute("DELETE FROM notes WHERE status='trash'", [])?;
                        Ok::<_, NotesError>(Ok(count as u32))
                    },
                )?;
                match outcome {
                    Ok(deleted_count) => {
                        state.pending = None;
                        service.publish(&mut state, NoteChangeKindDto::TrashEmptied, None);
                        Ok(EmptyNotesTrashResultDto { deleted_count })
                    }
                    Err(current) => {
                        let impact = current
                            .as_ref()
                            .map(
                                // Owns the replacement preview before updating pending state.
                                |value| value.impact.clone(),
                            )
                            .unwrap_or(EmptyNotesTrashImpactDto {
                                request_id: state.next_request,
                                note_count: 0,
                                notes: vec![],
                                has_more: false,
                            });
                        state.pending = current;
                        Err(NotesError::TrashChanged { impact })
                    }
                }
            },
        )
        .await
    }
    /// Cancels only the exact pending request.
    pub async fn cancel_empty_notes_trash(&self, request_id: u32) -> Result<(), NotesError> {
        self.blocking(
            // Serializes pending cancellation without acquiring a persistence permit.
            move |service| {
                let mut state = service.inner.state.lock().map_err(
                    // Redacts synchronization or persistence failure details.
                    |_| NotesError::PersistenceFailed,
                )?;
                let pending = state
                    .pending
                    .as_ref()
                    .ok_or(NotesError::NoPendingTrashOperation)?;
                if pending.impact.request_id != request_id
                    || service
                        .inner
                        .clock
                        .elapsed()
                        .saturating_sub(pending.created)
                        >= Duration::from_secs(300)
                {
                    return Err(NotesError::StaleTrashRequest);
                }
                state.pending = None;
                Ok(())
            },
        )
        .await
    }
    /// Supplies a bounded ranked Active and Archive prefix for Search.
    pub async fn search_for_unified(
        &self,
        query: &str,
        candidate_limit: u32,
    ) -> Result<NoteSearchCandidates, NotesError> {
        if !(1..=64).contains(&candidate_limit) {
            return Err(NotesError::InvalidPagination);
        }
        let tokens = search::tokens(query)?;
        let query = query.trim().to_lowercase();
        self.blocking(
            // Performs matching and snippet work entirely on a blocking worker.
            move |service| {
                service.inner.storage.with_connection(
                    // Reads one extra result to report source truncation accurately.
                    |db| {
                        let notes = repo::candidates(db, &tokens, &query, candidate_limit)?;
                        let has_more = notes.len() > candidate_limit as usize;
                        let items = notes
                            .into_iter()
                            .take(candidate_limit as usize)
                            .map(
                                // Converts owner rows to the public composition record.
                                |note| NoteSearchRecord {
                                    matching_snippet: Some(search::snippet(
                                        &note.content_markdown,
                                        &tokens,
                                    )),
                                    note_id: note.id,
                                    title: note.title,
                                    project_id: note.project_id,
                                    updated_at_ms: note.updated_at_ms,
                                },
                            )
                            .collect();
                        Ok(NoteSearchCandidates { items, has_more })
                    },
                )
            },
        )
        .await
    }
    /// Exports all lifecycle records through the coordinator's transaction.
    pub fn export_notes_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<Vec<NoteBackupRecordV1>, NotesError> {
        Ok(repo::all(tx)?
            .into_iter()
            .map(
                // Omits revision and derived search fields from backup.
                |note| NoteBackupRecordV1 {
                    id: note.id,
                    title: note.title,
                    content_markdown: note.content_markdown,
                    project_id: note.project_id,
                    is_pinned: note.is_pinned,
                    status: note.status,
                    trashed_from: note.trashed_from,
                    created_at_ms: note.created_at_ms,
                    updated_at_ms: note.updated_at_ms,
                    archived_at_ms: note.archived_at_ms,
                    trashed_at_ms: note.trashed_at_ms,
                },
            )
            .collect())
    }
    /// Validates immutable remapped input and prepares owned row operations.
    pub fn prepare_notes_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        records: &[NoteBackupRecordV1],
    ) -> Result<NotesImportPlan, NotesError> {
        let mut ids = HashSet::new();
        let mut rows = Vec::new();
        let mut counts = NotesImportCounts {
            inserts: 0,
            updates: 0,
            unchanged: 0,
        };
        for record in records {
            note_id(&record.id)?;
            if !ids.insert(&record.id) {
                return Err(NotesError::InvalidNoteId);
            }
            project_id(&record.project_id)?;
            content(&record.content_markdown)?;
            if title(record.title.clone())? != record.title {
                return Err(NotesError::InvalidTitle);
            }
            if record.created_at_ms < 0
                || record.updated_at_ms < record.created_at_ms
                || record.archived_at_ms.is_some_and(
                    // Rejects lifecycle timestamps preceding creation.
                    |time| time < record.created_at_ms,
                )
                || record.trashed_at_ms.is_some_and(
                    // Rejects lifecycle timestamps preceding creation.
                    |time| time < record.created_at_ms,
                )
            {
                return Err(NotesError::ClockFailed);
            }
            let valid = match (&record.status, &record.trashed_from) {
                (NoteStatusDto::Active, None) => {
                    record.archived_at_ms.is_none() && record.trashed_at_ms.is_none()
                }
                (NoteStatusDto::Archived, None) => {
                    record.archived_at_ms.is_some() && record.trashed_at_ms.is_none()
                }
                (NoteStatusDto::Trash, Some(previous)) => {
                    record.trashed_at_ms.is_some()
                        && (record.archived_at_ms.is_some()
                            == (*previous == NotePreviousStatusDto::Archived))
                }
                _ => false,
            };
            if !valid {
                return Err(NotesError::InvalidTransition {
                    status: record.status.clone(),
                });
            }
            let revision = match repo::get(tx, &record.id) {
                Ok(local) => {
                    counts.updates += 1;
                    next_revision(&local.revision)?
                }
                Err(NotesError::NoteNotFound) => {
                    counts.inserts += 1;
                    "1".into()
                }
                Err(error) => return Err(error),
            };
            rows.push(NoteDto {
                id: record.id.clone(),
                title: record.title.clone(),
                content_markdown: record.content_markdown.clone(),
                project_id: record.project_id.clone(),
                is_pinned: record.is_pinned,
                status: record.status.clone(),
                trashed_from: record.trashed_from.clone(),
                created_at_ms: record.created_at_ms,
                updated_at_ms: record.updated_at_ms,
                archived_at_ms: record.archived_at_ms,
                trashed_at_ms: record.trashed_at_ms,
                revision,
            });
        }
        Ok(NotesImportPlan { rows, counts })
    }
    /// Applies prepared records without nested locks, permits, or storage calls.
    pub fn apply_notes_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &NotesImportPlan,
    ) -> Result<NotesCommittedProjection, NotesError> {
        for note in &plan.rows {
            repo::put(tx, note)?;
        }
        Ok(NotesCommittedProjection {
            change: NotesMaintenanceChange::BackupImported,
            affected_count: plan.rows.len() as u32,
        })
    }
    /// Deletes all lifecycle rows inside the shared reset transaction.
    pub fn reset_notes_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<NotesCommittedProjection, NotesError> {
        let affected_count = tx.execute("DELETE FROM notes", [])? as u32;
        Ok(NotesCommittedProjection {
            change: NotesMaintenanceChange::Reset,
            affected_count,
        })
    }
    /// Consumes committed invalidation without requerying the database.
    pub fn publish_data_change(&self, projection: NotesCommittedProjection) {
        let mut state = self.inner.state.lock().unwrap_or_else(
            // Recovers synchronization state for no-fail post-commit publication.
            |poison| poison.into_inner(),
        );
        state.pending = None;
        self.publish(
            &mut state,
            match projection.change {
                NotesMaintenanceChange::BackupImported => NoteChangeKindDto::BackupImported,
                NotesMaintenanceChange::Reset => NoteChangeKindDto::Reset,
            },
            None,
        );
    }
}
