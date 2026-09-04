use std::{
    collections::HashMap,
    error::Error,
    fmt::{Display, Formatter},
    sync::Mutex,
};

use zeroize::Zeroizing;

/// Names the operating-system credential service that owns every CLI profile secret.
pub const CREDENTIAL_SERVICE_NAME: &str = "com.xwork.app.cli-profile";

/// Limits opaque account identifiers to a length every backend supports.
const MAX_ACCOUNT_LENGTH: usize = 128;

/// Describes why one credential operation failed, without any backend detail.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CredentialError {
    /// The operating-system credential backend cannot be used at all.
    Unavailable,
    /// The account identifier does not satisfy the opaque-account contract.
    InvalidAccount,
    /// Writing or deleting the secret failed.
    WriteFailed,
    /// Reading the secret failed for a reason other than absence.
    ReadFailed,
    /// The credential no longer exists in the operating-system store.
    NotFound,
}

impl Display for CredentialError {
    /// Formats one stable category without the account, value, or backend text.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::Unavailable => "the operating-system credential store is unavailable",
            Self::InvalidAccount => "the credential account identifier is not valid",
            Self::WriteFailed => "the credential store rejected the write operation",
            Self::ReadFailed => "the credential store rejected the read operation",
            Self::NotFound => "the credential no longer exists",
        };
        formatter.write_str(message)
    }
}

impl Error for CredentialError {}

/// Reads, writes, and deletes opaque secrets in the operating-system store.
///
/// Every method is synchronous so callers must move the work to a blocking
/// worker explicitly rather than blocking an asynchronous runtime thread.
pub trait CredentialStore: Send + Sync {
    /// Stores one secret value under an opaque account identifier.
    fn write_secret(&self, account: &str, secret: &str) -> Result<(), CredentialError>;

    /// Reads one secret value into a buffer that zeroes itself when dropped.
    fn read_secret(&self, account: &str) -> Result<Zeroizing<String>, CredentialError>;

    /// Deletes one stored secret and reports absence as its own outcome.
    fn delete_secret(&self, account: &str) -> Result<(), CredentialError>;
}

/// Rejects account identifiers that are empty, oversized, or not opaque.
fn validate_account(account: &str) -> Result<(), CredentialError> {
    if account.is_empty() || account.len() > MAX_ACCOUNT_LENGTH {
        return Err(CredentialError::InvalidAccount);
    }
    // Opaque accounts are lowercase hexadecimal identifiers, never user-supplied text.
    if !account
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(CredentialError::InvalidAccount);
    }
    Ok(())
}

/// Stores CLI profile secrets in the native Windows or macOS credential store.
#[derive(Clone, Default)]
pub struct KeyringCredentialStore;

impl KeyringCredentialStore {
    /// Creates the production credential adapter.
    pub fn new() -> Self {
        Self
    }

    /// Opens one keyring entry without exposing the account in any error.
    fn entry(account: &str) -> Result<keyring::Entry, CredentialError> {
        validate_account(account)?;
        keyring::Entry::new(CREDENTIAL_SERVICE_NAME, account).map_err(
            // The raw backend error is discarded so no account or path can leak.
            |error| match error {
                keyring::Error::Invalid(_, _) => CredentialError::InvalidAccount,
                _ => CredentialError::Unavailable,
            },
        )
    }
}

impl CredentialStore for KeyringCredentialStore {
    /// Writes one secret through the native backend without logging its value.
    fn write_secret(&self, account: &str, secret: &str) -> Result<(), CredentialError> {
        Self::entry(account)?.set_password(secret).map_err(
            // Only the stable category survives; the backend message is dropped.
            |error| match error {
                keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_) => {
                    CredentialError::Unavailable
                }
                keyring::Error::Invalid(_, _) => CredentialError::InvalidAccount,
                _ => CredentialError::WriteFailed,
            },
        )
    }

    /// Reads one secret into a zeroizing buffer owned by the caller.
    fn read_secret(&self, account: &str) -> Result<Zeroizing<String>, CredentialError> {
        Self::entry(account)?
            .get_password()
            .map(Zeroizing::new)
            .map_err(
                // Absence is a distinct outcome so callers can ask for the secret again.
                |error| match error {
                    keyring::Error::NoEntry => CredentialError::NotFound,
                    keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_) => {
                        CredentialError::Unavailable
                    }
                    keyring::Error::Invalid(_, _) => CredentialError::InvalidAccount,
                    _ => CredentialError::ReadFailed,
                },
            )
    }

    /// Deletes one secret and reports a missing credential as its own outcome.
    fn delete_secret(&self, account: &str) -> Result<(), CredentialError> {
        Self::entry(account)?.delete_credential().map_err(
            // Cleanup callers treat absence as success, so the category must be exact.
            |error| match error {
                keyring::Error::NoEntry => CredentialError::NotFound,
                keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_) => {
                    CredentialError::Unavailable
                }
                keyring::Error::Invalid(_, _) => CredentialError::InvalidAccount,
                _ => CredentialError::WriteFailed,
            },
        )
    }
}

/// Records one injected failure and how many operations it still affects.
#[derive(Clone, Copy, Debug)]
struct InjectedFailure {
    error: CredentialError,
    remaining: Option<u32>,
}

/// Holds the mutable fixture state of the in-memory credential store.
#[derive(Default)]
struct FakeState {
    secrets: HashMap<String, String>,
    write_failure: Option<InjectedFailure>,
    read_failure: Option<InjectedFailure>,
    delete_failure: Option<InjectedFailure>,
    write_calls: u32,
    read_calls: u32,
    delete_calls: u32,
}

impl FakeState {
    /// Consumes one injected failure and reports whether it applies now.
    fn take(failure: &mut Option<InjectedFailure>) -> Option<CredentialError> {
        let injected = (*failure)?;
        match injected.remaining {
            None => Some(injected.error),
            Some(0) => {
                *failure = None;
                None
            }
            Some(count) => {
                *failure = Some(InjectedFailure {
                    error: injected.error,
                    remaining: Some(count - 1),
                });
                Some(injected.error)
            }
        }
    }
}

/// Stores secrets in memory so tests never touch a real credential store.
#[doc(hidden)]
#[derive(Default)]
pub struct InMemoryCredentialStore {
    state: Mutex<FakeState>,
}

impl InMemoryCredentialStore {
    /// Creates an empty in-memory credential store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Locks the fixture state and rejects a poisoned fixture loudly.
    fn state(&self) -> std::sync::MutexGuard<'_, FakeState> {
        self.state
            .lock()
            .expect("the fixture credential lock should be available")
    }

    /// Fails every future write with the supplied category.
    pub fn fail_writes(&self, error: CredentialError) {
        self.state().write_failure = Some(InjectedFailure {
            error,
            remaining: None,
        });
    }

    /// Fails every future read with the supplied category.
    pub fn fail_reads(&self, error: CredentialError) {
        self.state().read_failure = Some(InjectedFailure {
            error,
            remaining: None,
        });
    }

    /// Fails every future delete with the supplied category.
    pub fn fail_deletes(&self, error: CredentialError) {
        self.state().delete_failure = Some(InjectedFailure {
            error,
            remaining: None,
        });
    }

    /// Fails exactly the next `count` deletes and then succeeds again.
    pub fn fail_next_deletes(&self, error: CredentialError, count: u32) {
        self.state().delete_failure = Some(InjectedFailure {
            error,
            remaining: Some(count),
        });
    }

    /// Clears every injected failure without touching stored secrets.
    pub fn clear_failures(&self) {
        let mut state = self.state();
        state.write_failure = None;
        state.read_failure = None;
        state.delete_failure = None;
    }

    /// Seeds one stored secret without counting a write call.
    pub fn seed(&self, account: &str, secret: &str) {
        self.state()
            .secrets
            .insert(account.to_owned(), secret.to_owned());
    }

    /// Returns every stored account in sorted order.
    pub fn accounts(&self) -> Vec<String> {
        let mut accounts = self.state().secrets.keys().cloned().collect::<Vec<_>>();
        accounts.sort();
        accounts
    }

    /// Returns the stored secret of one account for fixture assertions.
    pub fn stored_secret(&self, account: &str) -> Option<String> {
        self.state().secrets.get(account).cloned()
    }

    /// Returns the write, read, and delete call counts in that order.
    pub fn call_counts(&self) -> (u32, u32, u32) {
        let state = self.state();
        (state.write_calls, state.read_calls, state.delete_calls)
    }
}

impl CredentialStore for InMemoryCredentialStore {
    /// Records the write and applies any injected write failure first.
    fn write_secret(&self, account: &str, secret: &str) -> Result<(), CredentialError> {
        validate_account(account)?;
        let mut state = self.state();
        state.write_calls += 1;
        if let Some(error) = FakeState::take(&mut state.write_failure) {
            return Err(error);
        }
        state.secrets.insert(account.to_owned(), secret.to_owned());
        Ok(())
    }

    /// Records the read and applies any injected read failure first.
    fn read_secret(&self, account: &str) -> Result<Zeroizing<String>, CredentialError> {
        validate_account(account)?;
        let mut state = self.state();
        state.read_calls += 1;
        if let Some(error) = FakeState::take(&mut state.read_failure) {
            return Err(error);
        }
        state
            .secrets
            .get(account)
            .map(|secret| Zeroizing::new(secret.clone()))
            .ok_or(CredentialError::NotFound)
    }

    /// Records the delete and applies any injected delete failure first.
    fn delete_secret(&self, account: &str) -> Result<(), CredentialError> {
        validate_account(account)?;
        let mut state = self.state();
        state.delete_calls += 1;
        if let Some(error) = FakeState::take(&mut state.delete_failure) {
            return Err(error);
        }
        if state.secrets.remove(account).is_some() {
            Ok(())
        } else {
            Err(CredentialError::NotFound)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CREDENTIAL_SERVICE_NAME, CredentialError, CredentialStore, InMemoryCredentialStore,
        validate_account,
    };

    /// Returns one canonical opaque production account identifier.
    fn account() -> String {
        uuid::Uuid::new_v4().hyphenated().to_string()
    }

    /// Verifies that the credential service name is a stable public contract.
    #[test]
    fn credential_service_name_is_fixed() {
        assert_eq!(CREDENTIAL_SERVICE_NAME, "com.xwork.app.cli-profile");
    }

    /// Verifies that only opaque lowercase identifiers are accepted as accounts.
    #[test]
    fn account_validation_accepts_only_opaque_identifiers() {
        assert_eq!(validate_account(&account()), Ok(()));
        assert_eq!(validate_account("test-0000-1111"), Ok(()));
        for rejected in [
            "",
            "PROFILE",
            "profile name",
            "profile/../escape",
            "TOKEN_VALUE",
            "profile\u{0}",
        ] {
            assert_eq!(
                validate_account(rejected),
                Err(CredentialError::InvalidAccount),
                "account {rejected:?} should be rejected"
            );
        }
        assert_eq!(
            validate_account(&"a".repeat(129)),
            Err(CredentialError::InvalidAccount)
        );
    }

    /// Verifies the in-memory store round-trips, deletes, and reports absence.
    #[test]
    fn fake_store_round_trips_and_reports_absence() {
        let store = InMemoryCredentialStore::new();
        let account = account();

        store
            .write_secret(&account, "canary")
            .expect("the fake write should succeed");
        assert_eq!(store.accounts(), vec![account.clone()]);
        assert_eq!(
            store
                .read_secret(&account)
                .expect("the fake read should succeed")
                .as_str(),
            "canary"
        );

        store
            .delete_secret(&account)
            .expect("the fake delete should succeed");
        assert!(matches!(
            store.read_secret(&account),
            Err(CredentialError::NotFound)
        ));
        assert!(matches!(
            store.delete_secret(&account),
            Err(CredentialError::NotFound)
        ));
        assert_eq!(store.call_counts(), (1, 2, 2));
    }

    /// Verifies that each injected failure category reaches exactly its operation.
    #[test]
    fn fake_store_injects_every_failure_category() {
        let store = InMemoryCredentialStore::new();
        let account = account();

        store.fail_writes(CredentialError::Unavailable);
        assert_eq!(
            store.write_secret(&account, "canary"),
            Err(CredentialError::Unavailable)
        );
        assert!(store.accounts().is_empty());

        store.clear_failures();
        store
            .write_secret(&account, "canary")
            .expect("the cleared fixture should write");

        store.fail_reads(CredentialError::ReadFailed);
        assert!(matches!(
            store.read_secret(&account),
            Err(CredentialError::ReadFailed)
        ));

        store.clear_failures();
        store.fail_deletes(CredentialError::WriteFailed);
        assert_eq!(
            store.delete_secret(&account),
            Err(CredentialError::WriteFailed)
        );
        // The failed delete must leave the stored secret untouched.
        assert_eq!(store.stored_secret(&account).as_deref(), Some("canary"));
    }

    /// Verifies that a bounded delete failure stops after its configured count.
    #[test]
    fn fake_store_stops_failing_after_the_configured_count() {
        let store = InMemoryCredentialStore::new();
        let account = account();
        store
            .write_secret(&account, "canary")
            .expect("the fixture write should succeed");
        store.fail_next_deletes(CredentialError::Unavailable, 1);

        assert_eq!(
            store.delete_secret(&account),
            Err(CredentialError::Unavailable)
        );
        store
            .delete_secret(&account)
            .expect("the retry should succeed once the injection is exhausted");
        assert!(store.accounts().is_empty());
    }

    /// Verifies that error text never repeats an account or secret value.
    #[test]
    fn error_text_excludes_account_and_value() {
        for error in [
            CredentialError::Unavailable,
            CredentialError::InvalidAccount,
            CredentialError::WriteFailed,
            CredentialError::ReadFailed,
            CredentialError::NotFound,
        ] {
            let text = error.to_string();
            assert!(!text.contains("canary"));
            assert!(!text.contains(CREDENTIAL_SERVICE_NAME));
        }
    }
}
