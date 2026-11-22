//! Serialize updates against game launches and configuration changes.
use std::{io::{Read, Write}, path::{Path, PathBuf}, process::{Child, Stdio}, sync::{atomic::{AtomicBool, Ordering}, Mutex, OnceLock, RwLock, RwLockReadGuard}, time::{Duration, Instant}};
#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase { Idle, Updating, Closing }
static UPDATING: RwLock<Phase> = RwLock::new(Phase::Idle);
static EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();
pub fn initialize() {
    if let Ok(path) = crate::portable::executable() { let _ = EXECUTABLE.set(path); }
    if let Some(path) = std::env::var_os(READY_ENV).map(PathBuf::from) {
        // Consume this before Tauri starts workers or child programs.
        std::env::remove_var(READY_ENV);
        let expected_dir = path.parent().and_then(Path::file_name).and_then(|part| part.to_str())
            .and_then(|part| part.strip_prefix(REOPEN_DIR_PREFIX));
        let temp = std::fs::canonicalize(std::env::temp_dir()).ok();
        if path.is_absolute()
            && path.file_name().is_some_and(|name| name == READY_FILE)
            && path.parent().and_then(Path::parent) == temp.as_deref()
            && expected_dir.is_some_and(|nonce| nonce.len() == 32 && nonce.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            let _ = READY_PATH.set(path);
        }
    }
}
static REOPEN_ATTEMPTED: AtomicBool = AtomicBool::new(false);
static UPDATE_LEASE: Mutex<Option<std::fs::File>> = Mutex::new(None);
pub struct Activity { _local: RwLockReadGuard<'static, Phase>, _shared: std::fs::File }
pub fn activity() -> Result<Activity, String> {
    Ok(Activity { _local: activity_in(&UPDATING)?, _shared: crate::coordination::activity()? })
}
fn activity_in(state: &RwLock<Phase>) -> Result<RwLockReadGuard<'_, Phase>, String> {
    let guard = state.read().map_err(|_| "Update state unavailable")?;
    match *guard {
        Phase::Updating => return Err("An app update is in progress. Wait for GameWeave to reopen.".into()),
        Phase::Closing => return Err("GameWeave is closing. Choose Keep Open to continue working.".into()),
        Phase::Idle => {},
    }
    Ok(guard)
}
pub fn begin() -> Result<(), String> {
    begin_in(&UPDATING, || {
        let lease = crate::coordination::update()?;
        crate::windows_games::require_update_idle()?;
        crate::workflow::require_update_idle()?;
        crate::game_logging::require_update_idle()?;
        *UPDATE_LEASE.lock().map_err(|_|"Update lock unavailable")? = Some(lease);
        Ok(())
    })
}
fn begin_in(state: &RwLock<Phase>, idle: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    let mut updating = state.try_write().map_err(|_| "Finish the current operation before updating")?;
    if *updating != Phase::Idle { return Err("An app update or shutdown is already in progress".into()); }
    idle()?;
    *updating = Phase::Updating; Ok(())
}
pub fn cancel() -> Result<(), String> {
    let mut updating = UPDATING.write().map_err(|_| "Update state unavailable")?;
    if *updating == Phase::Closing { return Err("GameWeave is closing, not updating".into()); }
    UPDATE_LEASE.lock().map_err(|_|"Update lock unavailable")?.take();
    REOPEN_ATTEMPTED.store(false, Ordering::Release);
    *updating = Phase::Idle; Ok(())
}
// Reserve this process for shutdown only after its supervised work has finished.
// The same local gate excludes a new GUI operation between the check and window close.
pub fn prepare_close() -> Result<(), String> {
    close_in(&UPDATING, REOPEN_ATTEMPTED.load(Ordering::Acquire), || {
        crate::windows_games::require_update_idle()?;
        if !crate::windows_games::update_stop::active()?.is_empty() { return Err("Windows games or installers launched through GameWeave are still running.".into()); }
        crate::workflow::require_update_idle()?;
        crate::game_logging::require_update_idle()?;
        if crate::proton_manager::busy() { return Err("Wait for the Proton download to finish or cancel it first.".into()); }
        // Close the same cross-instance race as force quit. Reuse an updater's
        // lease during manual recovery rather than trying to lock it twice.
        retain_shutdown_lease(&mut *UPDATE_LEASE.lock().map_err(|_|"Shutdown lock unavailable")?, crate::coordination::update)?;
        Ok(())
    })
}
fn retain_shutdown_lease(held: &mut Option<std::fs::File>, acquire: impl FnOnce() -> Result<std::fs::File, String>) -> Result<(), String> {
    if held.is_none() { *held = Some(acquire()?); }
    Ok(())
}
fn close_in(state: &RwLock<Phase>, reopen_attempted: bool, idle: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    let mut stopping = state.try_write().map_err(|_|"Wait for the current operation to finish.")?;
    if *stopping != Phase::Idle && !(*stopping == Phase::Updating && reopen_attempted) { return Err("Wait for the app update or shutdown to finish.".into()); }
    idle()?;
    *stopping = Phase::Closing;
    Ok(())
}
// Keep launch/configuration commands out while the user reviews the force-quit
// prompt. Dropping this reservation on Cancel/error restores normal operation.
pub(crate) struct CloseReservation<'a> { state: &'a RwLock<Phase>, committed: bool }
pub(crate) fn reserve_force_close() -> Result<CloseReservation<'static>, String> {
    reserve_close_in(&UPDATING, || {
        crate::workflow::require_update_idle()?;
        crate::game_logging::require_update_idle()?;
        if crate::proton_manager::busy() { return Err("Cancel the Proton download before closing.".into()); }
        Ok(())
    })
}
fn reserve_close_in(state: &RwLock<Phase>, ready: impl FnOnce() -> Result<(), String>) -> Result<CloseReservation<'_>, String> {
    close_in(state, false, ready)?;
    Ok(CloseReservation { state, committed: false })
}
impl CloseReservation<'_> {
    pub(crate) fn finish(mut self) -> Result<(), String> {
        // All shortcuts/other GUI instances use this lease too. Acquire it only
        // after reviewed runtime supervisors have released their shared leases.
        let lease = crate::coordination::update()?;
        crate::windows_games::require_update_idle()?;
        *UPDATE_LEASE.lock().map_err(|_|"Shutdown lock unavailable")? = Some(lease);
        self.committed = true;
        Ok(())
    }
}
impl Drop for CloseReservation<'_> {
    fn drop(&mut self) {
        if !self.committed {
            if let Ok(mut phase) = self.state.write() {
                if *phase == Phase::Closing { *phase = Phase::Idle; }
            }
        }
    }
}
fn validate_version(value: &str) -> Result<(), String> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|p| p.is_empty() || p.len() > 10 || !p.bytes().all(|b| b.is_ascii_digit())) {
        return Err("Invalid installed update version".into());
    }
    Ok(())
}
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const READY_ENV: &str = "GAMEWEAVE_UPDATE_READY";
const READY_FILE: &str = "ready";
const REOPEN_DIR_PREFIX: &str = "gameweave-reopen-";
static READY_PATH: OnceLock<PathBuf> = OnceLock::new();

struct ReopenReceipt(PathBuf);

impl ReopenReceipt {
    fn new() -> std::io::Result<Self> {
        use std::os::unix::fs::DirBuilderExt;
        let mut entropy = std::fs::File::open("/dev/urandom")?;
        let temp = std::fs::canonicalize(std::env::temp_dir())?;
        for _ in 0..4 {
            let mut nonce = [0; 16];
            entropy.read_exact(&mut nonce)?;
            let dir = temp.join(format!("{REOPEN_DIR_PREFIX}{:032x}", u128::from_ne_bytes(nonce)));
            match std::fs::DirBuilder::new().mode(0o700).create(&dir) {
                Ok(()) => return Ok(Self(dir)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
        Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "could not reserve a private relaunch directory"))
    }
    fn path(&self, name: &str) -> PathBuf { self.0.join(name) }
}

impl Drop for ReopenReceipt {
    fn drop(&mut self) {
        for name in ["version", READY_FILE] {
            let _ = std::fs::remove_file(self.path(name));
        }
        let _ = std::fs::remove_dir(&self.0);
    }
}

pub fn mark_ready() {
    if let Some(path) = READY_PATH.get() {
        use std::os::unix::fs::OpenOptionsExt;
        if let Ok(mut file) = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path) {
            let _ = writeln!(file, "{}", env!("CARGO_PKG_VERSION"));
        }
    }
}

fn stop_child(mut child: Child) {
    if matches!(child.try_wait(), Ok(None)) {
        // Both spawned commands are group leaders; stop only that invocation
        // and any wrapper/helper processes it created during startup.
        unsafe { libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL); }
        // A child in uninterruptible I/O can outlive SIGKILL. Reap without
        // extending the caller’s startup deadline or retaining its receipt.
        let _ = std::thread::Builder::new().name("gameweave-relaunch-reaper".into())
            .spawn(move || { let _ = child.wait(); });
    }
}

fn read_version(path: &Path, version: &str) -> std::io::Result<bool> {
    let mut output = Vec::new();
    std::fs::File::open(path)?.take(128).read_to_end(&mut output)?;
    Ok(output == format!("{version}\n").as_bytes())
}

fn verify_installed(path: &Path, version: &str, receipt: &ReopenReceipt, timeout: Duration) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    validate_version(version)?;
    let probe = receipt.path("version");
    let output = std::fs::File::create(&probe).map_err(|e| format!("Could not prepare the version check: {e}"))?;
    let mut child = crate::font_runtime::child_command(path).arg("--proton-medic-version")
        .stdin(Stdio::null()).stdout(output).stderr(Stdio::null()).process_group(0).spawn()
        .map_err(|e| format!("Could not open the updated program: {e}"))?;
    let deadline = Instant::now() + timeout;
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break read_version(&probe, version)
                .map_err(|e| format!("Could not read the installed version: {e}"))
                .and_then(|matches| if matches { Ok(()) } else { Err("The installed program does not match the downloaded version.".into()) }),
            Ok(Some(status)) => break Err(format!("The updated program could not report its version ({status}).")),
            Ok(None) if Instant::now() >= deadline => break Err("The updated program did not respond to its version check in time.".into()),
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(e) => break Err(format!("Could not check whether the updated program opened: {e}")),
        }
    };
    if result.is_err() { stop_child(child); }
    result
}

fn wait_for_ready(child: &mut Child, ready: &Path, version: &str, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Err(format!("The updated program closed before its interface was ready ({status}).")),
            Err(e) => return Err(format!("Could not check the updated program: {e}")),
            Ok(None) => {},
        }
        // The child writes the receipt only once the frontend has committed the
        // real interface. An empty/partly written receipt is not a ready signal.
        if read_version(ready, version).unwrap_or(false) { return Ok(()); }
        if Instant::now() >= deadline { return Err("The updated program did not finish opening in time.".into()); }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn launch_installed(path: &Path, version: &str, probe_timeout: Duration, ready_timeout: Duration) -> Result<Child, String> {
    use std::os::unix::process::CommandExt;
    let receipt = ReopenReceipt::new().map_err(|e| format!("Could not prepare the update relaunch: {e}"))?;
    verify_installed(path, version, &receipt, probe_timeout)?;
    let ready = receipt.path(READY_FILE);
    let mut child = crate::font_runtime::child_command(path).env(READY_ENV, &ready)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).process_group(0).spawn()
        .map_err(|e| format!("Update installed, but relaunch failed: {e}"))?;
    if let Err(e) = wait_for_ready(&mut child, &ready, version, ready_timeout) {
        stop_child(child);
        return Err(e);
    }
    Ok(child)
}
pub fn restart(app: tauri::AppHandle, version: String) -> Result<(), String> {
    let updating = UPDATING.read().map_err(|_| "Update state unavailable")?;
    if *updating != Phase::Updating { return Err("No app update is awaiting relaunch".into()); }
    let result = EXECUTABLE.get().ok_or_else(|| "Installed program path unavailable".to_string())
        .and_then(|path| launch_installed(path, &version, PROBE_TIMEOUT, READY_TIMEOUT));
    REOPEN_ATTEMPTED.store(true, Ordering::Release);
    result?;
    app.exit(0); Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test] fn close_waits_for_work_and_reserves_shutdown_without_blocking_manual_update_recovery() {
        let state=RwLock::new(Phase::Idle);let work=activity_in(&state).unwrap();
        assert!(close_in(&state,false,||Ok(())).is_err());drop(work);
        assert!(close_in(&state,false,||Err("Game is running".into())).is_err());assert!(activity_in(&state).is_ok());
        close_in(&state,false,||Ok(())).unwrap();assert!(activity_in(&state).is_err());
        assert!(close_in(&state,false,||Ok(())).is_err());
        assert!(close_in(&state,true,||Ok(())).is_err());
        *state.write().unwrap()=Phase::Updating;
        assert!(close_in(&state,true,||Ok(())).is_ok());
    }
    #[test] fn cancelling_or_failing_force_close_releases_gate_but_commit_retains_it() {
        let state=RwLock::new(Phase::Idle);
        let reservation=reserve_close_in(&state,||Ok(())).unwrap();
        assert!(activity_in(&state).is_err());
        assert!(begin_in(&state,||Ok(())).is_err());
        assert!(reserve_close_in(&state,||Ok(())).is_err());
        drop(reservation);
        assert!(activity_in(&state).is_ok());
        assert!(reserve_close_in(&state,||Err("Repair is active".into())).is_err());
        assert!(activity_in(&state).is_ok());
        let mut reservation=reserve_close_in(&state,||Ok(())).unwrap();
        reservation.committed=true; drop(reservation);
        assert!(activity_in(&state).is_err());
    }
    #[test] fn normal_close_retains_cross_instance_lease_and_reuses_update_recovery_lease() {
        let mut held=None;
        assert!(retain_shutdown_lease(&mut held,||Err("Shortcut started".into())).is_err());
        assert!(held.is_none());
        retain_shutdown_lease(&mut held,||Ok(std::fs::File::open("/dev/null").unwrap())).unwrap();
        assert!(held.is_some());
        retain_shutdown_lease(&mut held,||panic!("must reuse updater lease")).unwrap();
    }
    #[test] fn rejects_invalid_versions() {
        for v in ["", "1.2", "1.2.3.4", "1.2.3;sh", "../1", "1.2.-3"] { assert!(validate_version(v).is_err()); }
        assert!(validate_version("0.6.11").is_ok());
    }
    #[test] fn installed_version_probe_checks_exit_and_exact_version() {
        let dir=ReopenReceipt::new().unwrap();
        let path=dir.path("exec");
        std::fs::write(&path, "#!/bin/sh\n[ \"$1\" = --proton-medic-version ] || exit 2\nprintf '0.6.11\\n'\n").unwrap();
        std::fs::set_permissions(&path,std::fs::Permissions::from_mode(0o700)).unwrap();
        let timeout=Duration::from_secs(2);
        assert!(verify_installed(&path,"0.6.11",&dir,timeout).is_ok());
        assert!(verify_installed(&path,"0.6.12",&dir,timeout).is_err());
        std::fs::remove_file(&path).unwrap();
        assert!(verify_installed(&path,"0.6.11",&dir,timeout).is_err());
    }

    #[test] fn relaunch_waits_for_matching_startup_receipt() {
        let dir=ReopenReceipt::new().unwrap();
        let path=dir.path("exec");
        std::fs::write(&path, "#!/bin/sh\nif [ \"$1\" = --proton-medic-version ]; then printf '0.6.12\\n'; else printf '0.6.12\\n' > \"$GAMEWEAVE_UPDATE_READY\"; exec sleep 60; fi\n").unwrap();
        std::fs::set_permissions(&path,std::fs::Permissions::from_mode(0o700)).unwrap();
        let timeout=Duration::from_secs(2);
        assert!(launch_installed(&path,"0.6.11",timeout,timeout).is_err());
        let mut child=launch_installed(&path,"0.6.12",timeout,timeout).unwrap();
        assert!(child.try_wait().unwrap().is_none());
        stop_child(child);
        std::fs::remove_file(path).unwrap();
    }

    #[test] fn relaunch_handles_a_failed_start_and_bounds_unresponsive_children() {
        let dir=ReopenReceipt::new().unwrap();
        let path=dir.path("exec");
        let timeout=Duration::from_secs(2);
        let short=Duration::from_millis(80);
        for (source, expected) in [
            ("#!/bin/sh\nexec sleep 60\n","version check in time"),
            ("#!/bin/sh\nif [ \"$1\" = --proton-medic-version ]; then printf '0.6.12\\n'; else exit 1; fi\n","closed before its interface was ready"),
            ("#!/bin/sh\nif [ \"$1\" = --proton-medic-version ]; then printf '0.6.12\\n'; else exec sleep 60; fi\n","did not finish opening in time"),
        ] {
            std::fs::write(&path,source).unwrap();
            std::fs::set_permissions(&path,std::fs::Permissions::from_mode(0o700)).unwrap();
            let err=launch_installed(&path,"0.6.12",if expected=="version check in time"{short}else{timeout},short).unwrap_err();
            assert!(err.contains(expected),"{err}");
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test] fn update_lease_blocks_new_work_and_requires_running_work_to_finish() {
        let state=RwLock::new(Phase::Idle);let work=activity_in(&state).unwrap();
        assert!(begin_in(&state,||Ok(())).is_err());drop(work);
        assert!(begin_in(&state,||Err("Installer running".into())).is_err());
        assert!(activity_in(&state).is_ok());
        begin_in(&state,||Ok(())).unwrap();assert!(activity_in(&state).is_err());
        assert!(begin_in(&state,||Ok(())).is_err());
        *state.write().unwrap()=Phase::Idle;assert!(activity_in(&state).is_ok());
    }

}
