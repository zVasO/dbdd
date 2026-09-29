//! One-time move of the app's on-disk data from before the rename to Spool,
//! when the bundle identifier was `com.vasodb.desktop`.

use std::path::{Path, PathBuf};

const LEGACY_IDENTIFIER: &str = "com.vasodb.desktop";

/// Move every per-app directory keyed by the legacy identifier to `identifier`.
///
/// Must run before `tauri::Builder`: the window declared in the config, and so
/// its webview storage (where localStorage lives), already exists when `setup`
/// runs. A directory that already exists under the new identifier is left
/// alone, so this is a no-op on fresh installs and after the first launch.
pub fn migrate_app_dirs(identifier: &str) {
    if identifier == LEGACY_IDENTIFIER {
        return;
    }
    for base in candidate_bases() {
        move_app_dir(&base, LEGACY_IDENTIFIER, identifier);
    }
}

/// The directories Tauri and the webview key by bundle identifier: app data
/// and config (the config store, `spool.db`), local data (the webview's data
/// store on Linux and Windows), cache, and WebKit's own store on macOS.
fn candidate_bases() -> Vec<PathBuf> {
    #[allow(unused_mut)]
    let mut bases: Vec<PathBuf> = [
        dirs::data_dir(),
        dirs::data_local_dir(),
        dirs::config_dir(),
        dirs::cache_dir(),
    ]
    .into_iter()
    .flatten()
    .collect();
    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        bases.push(home.join("Library").join("WebKit"));
    }
    // On macOS several of these resolve to the same directory.
    bases.sort();
    bases.dedup();
    bases
}

/// Rename `base/old` to `base/new`. Failures are logged, never fatal: the app
/// then starts with empty data rather than not at all.
fn move_app_dir(base: &Path, old: &str, new: &str) -> bool {
    let from = base.join(old);
    let to = base.join(new);
    if !from.is_dir() || to.exists() {
        return false;
    }
    match std::fs::rename(&from, &to) {
        Ok(()) => {
            tracing::info!("Migrated {} to {}", from.display(), to.display());
            true
        }
        Err(e) => {
            tracing::warn!("Could not migrate {} to {}: {e}", from.display(), to.display());
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("spool_legacy_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn moves_the_legacy_directory_with_its_content() {
        let base = base("moves");
        std::fs::create_dir_all(base.join(LEGACY_IDENTIFIER)).unwrap();
        std::fs::write(base.join(LEGACY_IDENTIFIER).join("purrql.db"), b"data").unwrap();

        assert!(move_app_dir(&base, LEGACY_IDENTIFIER, "com.spool.desktop"));
        assert_eq!(std::fs::read(base.join("com.spool.desktop/purrql.db")).unwrap(), b"data");
        assert!(!base.join(LEGACY_IDENTIFIER).exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn never_overwrites_data_under_the_new_identifier() {
        let base = base("keeps");
        std::fs::create_dir_all(base.join(LEGACY_IDENTIFIER)).unwrap();
        std::fs::create_dir_all(base.join("com.spool.desktop")).unwrap();
        std::fs::write(base.join("com.spool.desktop/spool.db"), b"new").unwrap();

        assert!(!move_app_dir(&base, LEGACY_IDENTIFIER, "com.spool.desktop"));
        assert_eq!(std::fs::read(base.join("com.spool.desktop/spool.db")).unwrap(), b"new");
        assert!(base.join(LEGACY_IDENTIFIER).exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn does_nothing_without_legacy_data() {
        let base = base("fresh");
        assert!(!move_app_dir(&base, LEGACY_IDENTIFIER, "com.spool.desktop"));
        assert!(!base.join("com.spool.desktop").exists());
        let _ = std::fs::remove_dir_all(&base);
    }
}
