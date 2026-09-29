use std::path::Path;

use aes_gcm::{
    aead::Aead,
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use tracing::{debug, info};

use spool_core::error::{SpoolError, Result};

const KEYRING_SERVICE: &str = "spool";
const KEYRING_USER: &str = "master-key";
const KEY_FILE: &str = "spool.key";

/// Where the master key lived before the app was renamed to Spool (it was
/// PurrQL then). Read once to adopt the existing key; never written or deleted.
const LEGACY_KEYRING_SERVICE: &str = "purrql";
const LEGACY_KEY_FILE: &str = "purrql.key";

/// The OS keyring, behind a trait so the key resolution order can be tested
/// without a real keychain.
trait KeyVault {
    fn load(&self, service: &str) -> Result<[u8; 32]>;
    fn store(&self, service: &str, key: &[u8; 32]) -> Result<()>;
}

struct OsKeyring;

impl KeyVault for OsKeyring {
    fn load(&self, service: &str) -> Result<[u8; 32]> {
        let entry = keyring::Entry::new(service, KEYRING_USER)
            .map_err(|e| SpoolError::Config(format!("Keyring init error: {e}")))?;
        let encoded = entry
            .get_password()
            .map_err(|e| SpoolError::Config(format!("Keyring read error: {e}")))?;
        decode_key(&encoded)
    }

    fn store(&self, service: &str, key: &[u8; 32]) -> Result<()> {
        let entry = keyring::Entry::new(service, KEYRING_USER)
            .map_err(|e| SpoolError::Config(format!("Keyring init error: {e}")))?;
        entry
            .set_password(&B64.encode(key))
            .map_err(|e| SpoolError::Config(format!("Keyring write error: {e}")))
    }
}

/// Load or generate a 256-bit encryption key.
///
/// Read preference: OS keyring, then a base64 key file in the app data dir.
/// The key file is ALWAYS kept as a reliable fallback and is NEVER deleted: the
/// OS keyring can be unavailable or non-persistent across launches (notably
/// unsigned / `tauri dev` builds on macOS, where the Keychain ACL is tied to the
/// binary), and losing the master key makes every stored password
/// undecryptable (`aead::Error`). Removing the file in favour of a keyring-only
/// key caused exactly that regression.
///
/// Before generating a new key, the key stored under the pre-rename names
/// (`purrql.key`, keyring service `purrql`) is adopted: generating a fresh one
/// there would orphan every password saved before the rename.
///
/// The at-rest hardening (not persisting the key in plaintext next to the
/// ciphertext) is tracked as a follow-up and must wrap the key with a
/// passphrase-derived key rather than simply deleting this fallback.
pub fn load_or_create_key(app_data_dir: &Path) -> Result<[u8; 32]> {
    resolve_key(app_data_dir, &OsKeyring)
}

fn resolve_key(app_data_dir: &Path, vault: &dyn KeyVault) -> Result<[u8; 32]> {
    let key_path = app_data_dir.join(KEY_FILE);

    // Prefer the OS keyring for reads; keep a file backup so a later keyring
    // failure can't orphan the key.
    if let Ok(key) = vault.load(KEYRING_SERVICE) {
        debug!("Encryption key loaded from OS keyring");
        if !key_path.exists() {
            if let Err(e) = store_key_to_file(&key_path, &key) {
                debug!("Could not write key file backup: {e}");
            }
        }
        return Ok(key);
    }

    // Fallback: an existing key file. Best-effort re-seed the keyring, but never
    // delete the file — it is the only reliable persistence when the keyring is not.
    if key_path.exists() {
        let key = load_key_from_file(&key_path)?;
        let _ = vault.store(KEYRING_SERVICE, &key);
        return Ok(key);
    }

    // Upgrade from before the rename: adopt the legacy key under the new names.
    // The file is read first so the upgrade doesn't depend on (or prompt for)
    // the old keychain entry; the legacy copies are left untouched.
    let legacy_path = app_data_dir.join(LEGACY_KEY_FILE);
    let legacy = if legacy_path.exists() {
        Some(load_key_from_file(&legacy_path)?)
    } else {
        vault.load(LEGACY_KEYRING_SERVICE).ok()
    };
    if let Some(key) = legacy {
        info!("Adopting the encryption key stored before the rename to Spool");
        store_key_to_file(&key_path, &key)?;
        let _ = vault.store(KEYRING_SERVICE, &key);
        return Ok(key);
    }

    // First run: generate, persist to the file (reliable) and the keyring (best effort).
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    store_key_to_file(&key_path, &key)?;
    if let Err(e) = vault.store(KEYRING_SERVICE, &key) {
        debug!("OS keyring unavailable: {e}. Using file-based key storage.");
    }
    Ok(key)
}

fn load_key_from_file(key_path: &Path) -> Result<[u8; 32]> {
    let encoded = std::fs::read_to_string(key_path)
        .map_err(|e| SpoolError::Config(format!("Failed to read encryption key: {e}")))?;
    decode_key(encoded.trim())
}

fn store_key_to_file(key_path: &Path, key: &[u8; 32]) -> Result<()> {
    let encoded = B64.encode(key);
    std::fs::write(key_path, &encoded)
        .map_err(|e| SpoolError::Config(format!("Failed to write encryption key: {e}")))?;

    // Set restrictive file permissions (owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(key_path, perms)
            .map_err(|e| SpoolError::Config(format!("Failed to set key file permissions: {e}")))?;
    }

    Ok(())
}

fn decode_key(encoded: &str) -> Result<[u8; 32]> {
    let bytes = B64
        .decode(encoded)
        .map_err(|e| SpoolError::Config(format!("Invalid encryption key encoding: {e}")))?;
    if bytes.len() != 32 {
        return Err(SpoolError::Config(
            "Encryption key has invalid length".into(),
        ));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// Encrypt a password using AES-256-GCM. Returns (ciphertext_b64, nonce_b64).
pub fn encrypt(cipher: &Aes256Gcm, plaintext: &str) -> Result<(String, String)> {
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| SpoolError::Config(format!("Encryption error: {e}")))?;

    Ok((B64.encode(ciphertext), B64.encode(nonce_bytes)))
}

/// Decrypt a password using AES-256-GCM.
pub fn decrypt(cipher: &Aes256Gcm, ciphertext_b64: &str, nonce_b64: &str) -> Result<String> {
    let ciphertext = B64
        .decode(ciphertext_b64)
        .map_err(|e| SpoolError::Config(format!("Invalid ciphertext: {e}")))?;
    let nonce_bytes = B64
        .decode(nonce_b64)
        .map_err(|e| SpoolError::Config(format!("Invalid nonce: {e}")))?;
    if nonce_bytes.len() != 12 {
        return Err(SpoolError::Config(format!(
            "Invalid nonce length: expected 12 bytes, got {}",
            nonce_bytes.len()
        )));
    }
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| SpoolError::Config(format!("Decryption error: {e}")))?;

    String::from_utf8(plaintext)
        .map_err(|e| SpoolError::Config(format!("Invalid UTF-8 after decrypt: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::{aead::KeyInit, Aes256Gcm};

    #[test]
    fn encrypt_decrypt_round_trip() {
        let cipher = Aes256Gcm::new_from_slice(&[7u8; 32]).unwrap();
        let (ct, nonce) = encrypt(&cipher, "s3cr3t-p@ss").unwrap();
        assert_eq!(decrypt(&cipher, &ct, &nonce).unwrap(), "s3cr3t-p@ss");
    }

    #[test]
    fn decrypt_with_a_different_key_errors_not_panics() {
        // The user-facing symptom of a lost/rotated master key: wrong key ->
        // aead error, which must surface as an Err (never a panic).
        let cipher_a = Aes256Gcm::new_from_slice(&[1u8; 32]).unwrap();
        let cipher_b = Aes256Gcm::new_from_slice(&[2u8; 32]).unwrap();
        let (ct, nonce) = encrypt(&cipher_a, "pw").unwrap();
        assert!(decrypt(&cipher_b, &ct, &nonce).is_err());
    }

    #[test]
    fn key_file_round_trips_and_persists() {
        let dir = std::env::temp_dir().join("spool_crypto_keyfile_test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.key");
        let _ = std::fs::remove_file(&path);

        let key = [42u8; 32];
        store_key_to_file(&path, &key).unwrap();
        assert!(path.exists(), "key file fallback must exist after write");
        assert_eq!(load_key_from_file(&path).unwrap(), key);

        let _ = std::fs::remove_file(&path);
    }

    /// In-memory keyring for the resolution-order tests.
    #[derive(Default)]
    struct FakeVault(std::cell::RefCell<std::collections::HashMap<String, [u8; 32]>>);

    impl KeyVault for FakeVault {
        fn load(&self, service: &str) -> Result<[u8; 32]> {
            self.0.borrow().get(service).copied().ok_or_else(|| SpoolError::Config("no entry".into()))
        }
        fn store(&self, service: &str, key: &[u8; 32]) -> Result<()> {
            self.0.borrow_mut().insert(service.to_string(), *key);
            Ok(())
        }
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("spool_crypto_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn legacy_key_file_is_adopted_not_replaced() {
        let dir = temp_dir("legacy_file");
        let legacy = [9u8; 32];
        store_key_to_file(&dir.join(LEGACY_KEY_FILE), &legacy).unwrap();
        let vault = FakeVault::default();

        assert_eq!(resolve_key(&dir, &vault).unwrap(), legacy);
        assert_eq!(load_key_from_file(&dir.join(KEY_FILE)).unwrap(), legacy);
        assert_eq!(vault.load(KEYRING_SERVICE).unwrap(), legacy);
        assert!(dir.join(LEGACY_KEY_FILE).exists(), "legacy file must be kept");
        // Second launch reads the adopted key, still the same one.
        assert_eq!(resolve_key(&dir, &vault).unwrap(), legacy);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_keyring_entry_is_adopted_when_no_file_exists() {
        let dir = temp_dir("legacy_keyring");
        let legacy = [5u8; 32];
        let vault = FakeVault::default();
        vault.store(LEGACY_KEYRING_SERVICE, &legacy).unwrap();

        assert_eq!(resolve_key(&dir, &vault).unwrap(), legacy);
        assert_eq!(load_key_from_file(&dir.join(KEY_FILE)).unwrap(), legacy);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn current_key_wins_over_legacy_one() {
        let dir = temp_dir("current_wins");
        store_key_to_file(&dir.join(KEY_FILE), &[1u8; 32]).unwrap();
        store_key_to_file(&dir.join(LEGACY_KEY_FILE), &[2u8; 32]).unwrap();

        assert_eq!(resolve_key(&dir, &FakeVault::default()).unwrap(), [1u8; 32]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fresh_install_generates_and_persists_a_key() {
        let dir = temp_dir("fresh");
        let vault = FakeVault::default();
        let key = resolve_key(&dir, &vault).unwrap();

        assert_eq!(load_key_from_file(&dir.join(KEY_FILE)).unwrap(), key);
        assert_eq!(resolve_key(&dir, &vault).unwrap(), key);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
