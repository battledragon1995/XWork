use super::{reminder_models::*, reminder_repository as repo, reminder_service::*};
use crate::notifications::{ReminderNotificationInput, ReminderNotificationKind};
use rusqlite::params;
use std::sync::{Weak, atomic::Ordering};

/// Runs the single signal-driven worker without retaining an idle ownership cycle.
pub(crate) async fn worker(
    weak: Weak<Inner>,
    mut settings: tokio::sync::watch::Receiver<crate::settings::SettingsSnapshot>,
) {
    loop {
        let Some(inner) = weak.upgrade() else {
            return;
        };
        if inner.stopped.load(Ordering::Acquire) {
            return;
        }
        let service = ReminderService { inner };
        let deadline = if service.inner.paused.load(Ordering::Acquire) {
            service.inner.clock.now_ms().saturating_add(21600000)
        } else {
            match service.process_once().await {
                Ok(deadline) => deadline,
                Err(_) => service.inner.clock.now_ms().saturating_add(1000),
            }
        };
        if service.inner.stopped.load(Ordering::Acquire) {
            return;
        }
        let timer = service.inner.clock.sleep_until(deadline);
        let wake = service.inner.wake.notified();
        let changed = settings.changed();
        tokio::pin!(timer, wake, changed);
        // Polls the three cancellation-safe signals without adding a macro dependency.
        let settings_closed = std::future::poll_fn(|cx| {
            use std::future::Future;
            use std::task::Poll;
            if let Poll::Ready(result) = changed.as_mut().poll(cx) {
                return Poll::Ready(result.is_err());
            }
            if wake.as_mut().poll(cx).is_ready() || timer.as_mut().poll(cx).is_ready() {
                return Poll::Ready(false);
            }
            Poll::Pending
        })
        .await;
        if settings_closed {
            return;
        }
    }
}
impl ReminderService {
    /// Cancels a dependency wait when reset owns the maintenance writer or true Quit begins.
    async fn dependency<T>(
        &self,
        mut future: ReminderFuture<'_, Result<T, ReminderError>>,
    ) -> Result<T, ReminderError> {
        let stopped = self.inner.stop_signal.notified();
        tokio::pin!(stopped);
        stopped.as_mut().enable();
        if self.inner.paused.load(Ordering::Acquire) || self.inner.stopped.load(Ordering::Acquire) {
            return Err(ReminderError::Unavailable);
        }
        // Dropping the owner future releases a queued maintenance read instead of deadlocking reset.
        std::future::poll_fn(|cx| {
            use std::future::Future;
            if stopped.as_mut().poll(cx).is_ready() {
                return std::task::Poll::Ready(Err(ReminderError::Unavailable));
            }
            future.as_mut().poll(cx)
        })
        .await
    }

    /// Acquires reset-cancellable admission without starving a held maintenance write gate.
    async fn admit(&self) -> Result<crate::shared::DataReadPermit, ReminderError> {
        loop {
            if self.inner.paused.load(Ordering::Acquire)
                || self.inner.stopped.load(Ordering::Acquire)
            {
                return Err(ReminderError::Unavailable);
            }
            if let Ok(permit) = tokio::time::timeout(
                std::time::Duration::from_millis(25),
                self.inner.maintenance.read_permit(),
            )
            .await
            {
                return Ok(permit);
            }
        }
    }
    /// Performs one deterministic scheduling cycle and returns the next absolute wake instant.
    pub async fn process_once(&self) -> Result<i64, ReminderError> {
        let _running = self.inner.running.lock().await;
        if self.inner.paused.load(Ordering::Acquire) || self.inner.stopped.load(Ordering::Acquire) {
            return Err(ReminderError::Unavailable);
        }
        let now = self.inner.clock.now_ms();
        if now < 0 || now == i64::MAX {
            return Err(ReminderError::ClockOutOfRange);
        }
        let checkpoint = {
            let _permit = self.admit().await?;
            self.inner
                .storage
                .with_connection(repo::checkpoint)?
                .ok_or_else(
                    // The constructor is the sole owner of first-run baseline initialization.
                    || repo::corrupt("checkpoint"),
                )?
        };
        let mut from = checkpoint;
        let boundary = if !self.inner.ready.load(Ordering::Acquire) {
            self.inner.startup_boundary
        } else {
            now + 1
        };
        while from < boundary {
            let mut through = from.saturating_add(31 * 86400000).min(boundary);
            let candidates = loop {
                let candidates = self
                    .dependency(self.inner.dependencies.occurrences(from, through))
                    .await?;
                if candidates.len() < 5000 {
                    break candidates;
                }
                if through - from <= 1 {
                    return Err(ReminderError::DependencyUnavailable);
                }
                through = from + (through - from) / 2;
            };
            for candidate in &candidates {
                if !reminder_uuid(&candidate.reminder_id)
                    || event_ids(&candidate.event_id, &candidate.occurrence_id).is_err()
                    || candidate.due_at_ms < from
                    || candidate.due_at_ms >= through
                    || candidate.starts_at_ms < 0
                    || candidate.minutes_before > 525600
                    || candidate.time_zone_id.parse::<chrono_tz::Tz>().is_err()
                    || candidate
                        .starts_at_ms
                        .checked_sub(i64::from(candidate.minutes_before) * 60000)
                        != Some(candidate.due_at_ms)
                {
                    return Err(ReminderError::DependencyUnavailable);
                }
            }
            let enabled = self.inner.dependencies.enabled()?;
            let missed = !self.inner.ready.load(Ordering::Acquire);
            let _permit = self.admit().await?;
            let _gate = self.inner.gate.lock().await;
            let changed=self.inner.storage.with_transaction::<_,ReminderError>(
                // Atomically commits the classified half-open interval and its durable outbox.
                |tx|{let mut changed=0;for c in candidates {
                    // A duplicate identity must carry the same reminder semantics; metadata can reconcile later.
                    if let Some(existing)=repo::list(tx,"WHERE reminder_id=?1 AND occurrence_id=?2",params![c.reminder_id,c.occurrence_id])?.pop() {
                        if existing.dto.event_id!=c.event_id || existing.dto.starts_at_ms!=c.starts_at_ms.to_string() || existing.dto.original_due_at_ms!=c.due_at_ms.to_string() || existing.dto.minutes_before!=c.minutes_before {return Err(repo::corrupt("identity"));}
                        continue;
                    }
                    let status=if missed{"missed"}else if enabled{"active"}else{"suppressed"};
                    changed+=tx.execute("INSERT INTO reminder_deliveries(id,reminder_id,event_id,occurrence_id,project_id,title_snapshot,starts_at_ms,original_due_at_ms,time_zone_id,minutes_before,status,next_fire_at_ms,generation,version,notification_sync,notification_retry_at_ms,notification_retry_count,os_state,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL,1,1,?12,?13,0,?14,?15,?15) ON CONFLICT(reminder_id,occurrence_id) DO NOTHING",params![format!("reminder-delivery-{}",uuid::Uuid::new_v4()),c.reminder_id,c.event_id,c.occurrence_id,c.project_id,normalize(&c.title,200),c.starts_at_ms,c.due_at_ms,c.time_zone_id,c.minutes_before,status,if enabled{"upsert_pending"}else{"none"},if enabled{Some(now)}else{None},if !missed&&enabled{"pending"}else{"none"},now])?;
                }tx.execute("UPDATE reminder_scheduler_state SET scan_through_ms=max(scan_through_ms,?1),updated_at_ms=max(updated_at_ms,?2)",params![through,now])?;Ok(changed)})?;
            self.changed(changed)?;
            from = through;
        }
        if !self.inner.ready.load(Ordering::Acquire) {
            let _permit = self.admit().await?;
            let _gate = self.inner.gate.lock().await;
            let enabled = self.inner.dependencies.enabled()?;
            let affected=self.inner.storage.with_transaction::<_,ReminderError>(
                // A snooze expiring during process downtime becomes Missed without OS delivery.
                |tx|Ok(tx.execute("UPDATE reminder_deliveries SET status='missed',next_fire_at_ms=NULL,generation=generation+1,version=version+1,notification_sync=?1,notification_retry_at_ms=?2,notification_retry_count=0,os_state='none',updated_at_ms=max(updated_at_ms,?3) WHERE status='snoozed' AND next_fire_at_ms<?4",params![if enabled{"upsert_pending"}else{"none"},if enabled{Some(now)}else{None},now,self.inner.startup_boundary])?))?;
            self.changed(affected)?;
            self.inner.ready.store(true, Ordering::Release);
            drop(_gate);
            drop(_permit);
            // A startup boundary is exclusive; due exactly at startup is live on this same cycle.
            drop(_running);
            return Box::pin(self.process_once()).await;
        }
        self.reconcile(now).await?;
        self.sync_outbox(now).await?;
        let local_deadline = {
            let _permit = self.admit().await?;
            self.inner.storage.with_connection::<_,ReminderError>(
            // Selects both durable snooze and notification retry deadlines without retaining rows.
            |db|Ok(db.query_row("SELECT min(deadline) FROM (SELECT next_fire_at_ms AS deadline FROM reminder_deliveries WHERE status='snoozed' UNION ALL SELECT notification_retry_at_ms FROM reminder_deliveries WHERE notification_sync IN ('upsert_pending','delete_pending'))",[],
                // Decodes a nullable empty-queue minimum.
                |r|r.get::<_,Option<i64>>(0))?))?
        };
        let horizon = now.saturating_add(31 * 86400000);
        let future = self
            .dependency(self.inner.dependencies.occurrences(now + 1, horizon))
            .await?;
        let calendar_deadline = future
            .iter()
            .map(
                // Selects the earliest current reminder without materializing future delivery rows.
                |c| c.due_at_ms,
            )
            .min();
        Ok(local_deadline
            .into_iter()
            .chain(calendar_deadline)
            .fold(now.saturating_add(21600000), i64::min)
            .max(now + 1))
    }
    /// Reconciles materialized live identities against owned current Calendar contexts.
    async fn reconcile(&self, now: i64) -> Result<(), ReminderError> {
        let rows = {
            let _permit = self.admit().await?;
            self.inner.storage.with_connection(
                // Retains suppressed and dismissed identities durably for deduplication.
                |db| repo::list(db, "WHERE status IN ('active','missed','snoozed')", []),
            )?
        };
        for row in rows {
            let context = match self.dependency(Box::pin(self.context_for(&row))).await {
                Ok(c) => Some(c),
                Err(ReminderError::TargetUnavailable) => None,
                Err(e) => return Err(e),
            };
            let enabled = self.inner.dependencies.enabled()?;
            let _permit = self.admit().await?;
            let _gate = self.inner.gate.lock().await;
            let changed=self.inner.storage.with_transaction::<_,ReminderError>(
                // The optimistic version protects concurrent Snooze/Dismiss while owner reads await.
                |tx|{
                    let version=decimal(&row.dto.version).ok_or_else(||repo::corrupt("version"))?;
                    let Some(c)=context else {return Ok(tx.execute("UPDATE reminder_deliveries SET status='cancelled',next_fire_at_ms=NULL,version=version+1,notification_sync='delete_pending',notification_retry_at_ms=?1,notification_retry_count=0,os_state='none',updated_at_ms=max(updated_at_ms,?1) WHERE id=?2 AND version=?3",params![now,row.dto.id,version])?);};
                    if row.dto.status==ReminderDeliveryStatusDto::Snoozed && row.dto.snoozed_until_ms.as_deref().and_then(decimal).is_some_and(
                        // Resume in the same process reactivates overdue snoozes immediately.
                        |due|due<=now){
                        return Ok(tx.execute("UPDATE reminder_deliveries SET status=?1,next_fire_at_ms=NULL,generation=generation+1,version=version+1,notification_sync=?2,notification_retry_at_ms=?3,notification_retry_count=0,os_state=?4,title_snapshot=?5,project_id=?6,updated_at_ms=max(updated_at_ms,?7) WHERE id=?8 AND version=?9",params![if enabled{"active"}else{"suppressed"},if enabled{"upsert_pending"}else{"delete_pending"},now,if enabled{"pending"}else{"none"},normalize(&c.title,200),c.project_id,now,row.dto.id,version])?);
                    }
                    let title=normalize(&c.title,200);
                    if title!=row.dto.title||c.project_id!=row.dto.project_id||c.time_zone_id!=row.dto.time_zone_id {
                        return Ok(tx.execute("UPDATE reminder_deliveries SET title_snapshot=?1,project_id=?2,time_zone_id=?6,version=version+1,notification_sync=CASE WHEN notification_sync='synced' THEN 'upsert_pending' ELSE notification_sync END,notification_retry_at_ms=CASE WHEN notification_sync='synced' THEN ?3 ELSE notification_retry_at_ms END,updated_at_ms=max(updated_at_ms,?3) WHERE id=?4 AND version=?5",params![title,c.project_id,now,row.dto.id,version,c.time_zone_id])?);
                    }Ok(0)
                })?;
            self.changed(changed)?;
        }
        Ok(())
    }
    /// Retries only the durable bell outbox and persists each OS decision before dispatch.
    async fn sync_outbox(&self, now: i64) -> Result<(), ReminderError> {
        let rows = {
            let _permit = self.admit().await?;
            self.inner.storage.with_connection(
            // Includes OS pending rows left after an inbox commit and process crash.
            |db|repo::list(db,"WHERE notification_retry_at_ms<=?1 OR (os_state='pending' AND notification_sync='synced')",[now]))?
        };
        for row in rows {
            let enabled = self.inner.dependencies.enabled()?;
            let (title, context) = notification_text(&row)?;
            let deleting = row.sync == "delete_pending" || !enabled;
            let result = if row.sync == "synced" {
                Ok(())
            } else if deleting {
                self.dependency(self.inner.dependencies.remove(&row.dto.id))
                    .await
            } else {
                self.dependency(self.inner.dependencies.upsert(ReminderNotificationInput {
                    delivery_id: row.dto.id.clone(),
                    delivery_version: decimal(&row.dto.version).ok_or_else(
                        // A validated stored version must fit the consumer's integer contract.
                        || repo::corrupt("version"),
                    )? as u64,
                    kind: if row.dto.status == ReminderDeliveryStatusDto::Missed {
                        ReminderNotificationKind::Missed
                    } else {
                        ReminderNotificationKind::Due
                    },
                    title: title.clone(),
                    context: context.clone(),
                    project_id: row.dto.project_id.clone(),
                    event_id: row.dto.event_id.clone(),
                    occurrence_id: row.dto.occurrence_id.clone(),
                    created_at_ms: now,
                }))
                .await
            };
            let _permit = self.admit().await?;
            let _gate = self.inner.gate.lock().await;
            if result.is_err() {
                let delay = 1000i64
                    .saturating_mul(1i64.checked_shl(row.retries.min(20)).unwrap_or(i64::MAX))
                    .min(300000);
                self.inner.storage.with_transaction::<_,ReminderError>(
                    // Inbox failure schedules an exponential retry without changing the public generation.
                    |tx|{tx.execute("UPDATE reminder_deliveries SET notification_retry_count=notification_retry_count+1,notification_retry_at_ms=?1 WHERE id=?2 AND version=?3 AND notification_sync IN ('upsert_pending','delete_pending')",params![now.saturating_add(delay),row.dto.id,decimal(&row.dto.version)])?;Ok(())})?;
                continue;
            }
            let visible = self.inner.visible.lock().map_err(
                // Keeps synchronization failures sanitized.
                |_| ReminderError::Unavailable,
            )?;
            let exact = visible.0
                && visible.1.as_ref().is_some_and(
                    // Event detail suppresses its event, including base detail without an occurrence.
                    |v| v.1 == row.dto.event_id,
                );
            let attempt = row.os == "pending" && enabled && !deleting && !exact;
            let os = if row.os == "pending" {
                if attempt {
                    "attempted"
                } else if exact && enabled {
                    "suppressed_visible"
                } else {
                    "none"
                }
            } else {
                row.os.as_str()
            };
            let changed=self.inner.storage.with_transaction::<_,ReminderError>(
                // Records at-most-once OS intent before calling the external adapter.
                |tx|Ok(tx.execute("UPDATE reminder_deliveries SET notification_sync=?1,notification_retry_at_ms=NULL,notification_retry_count=0,os_state=?2,status=CASE WHEN ?7 THEN 'suppressed' ELSE status END,version=version+CASE WHEN ?7 THEN 1 ELSE 0 END WHERE id=?3 AND version=?4 AND notification_sync=?5 AND os_state=?6",params![if deleting{"none"}else{"synced"},os,row.dto.id,decimal(&row.dto.version),row.sync,row.os,!enabled&&row.dto.status==ReminderDeliveryStatusDto::Active&&row.sync=="upsert_pending"])?))?;
            if changed > 0
                && !enabled
                && row.dto.status == ReminderDeliveryStatusDto::Active
                && row.sync == "upsert_pending"
            {
                self.changed(1)?;
            }
            drop(visible);
            drop(_gate);
            drop(_permit);
            if changed > 0 && attempt && !self.inner.stopped.load(Ordering::Acquire) {
                let _ = self.inner.os.show(&title, &context);
            }
        }
        Ok(())
    }
}
/// Normalizes user-authored text to the notification owner's scalar and whitespace limits.
fn normalize(text: &str, limit: usize) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(
            // Removes non-whitespace control characters without leaking terminal sequences.
            |c| !c.is_control(),
        )
        .take(limit)
        .collect()
}
/// Builds stable English reminder copy in the event's IANA timezone.
fn notification_text(row: &repo::Delivery) -> Result<(String, String), ReminderError> {
    let minutes = row.dto.minutes_before;
    let (n, unit) = if minutes > 0 && minutes.is_multiple_of(1440) {
        (minutes / 1440, "day")
    } else if minutes > 0 && minutes.is_multiple_of(60) {
        (minutes / 60, "hour")
    } else {
        (minutes, "minute")
    };
    let offset = format!("{n} {unit}{}", if n == 1 { "" } else { "s" });
    let title = if row.dto.status == ReminderDeliveryStatusDto::Missed {
        format!("{} reminder was missed", row.dto.title)
    } else if minutes == 0 {
        format!("{} starts now", row.dto.title)
    } else {
        format!("{} starts in {offset}", row.dto.title)
    };
    let zone: chrono_tz::Tz = row.dto.time_zone_id.parse().map_err(
        // Rejects stored timezone corruption before rendering notification copy.
        |_| repo::corrupt("time_zone_id"),
    )?;
    let starts =
        chrono::DateTime::from_timestamp_millis(decimal(&row.dto.starts_at_ms).ok_or_else(
            // Rejects timestamp corruption before conversion.
            || repo::corrupt("starts_at_ms"),
        )?)
        .ok_or_else(
            // Chrono range must be valid even for SQLite-representable integers.
            || repo::corrupt("starts_at_ms"),
        )?;
    Ok((
        normalize(&title, 120),
        normalize(
            &format!(
                "{} ({}) · reminder {offset}",
                starts.with_timezone(&zone).format("%Y-%m-%d %H:%M"),
                row.dto.time_zone_id
            ),
            240,
        ),
    ))
}
