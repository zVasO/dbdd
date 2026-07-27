use std::path::Path;

use aes_gcm::{
    aead::Aead,
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use tracing::debug;

use purrql_core::error::{PurrqlError, Result};

const KEYRING_SERVICE: &str = "purrql";
const KEYRING_USER: &str = "master-key";
const KEY_FILE: &str = "purrql.key";

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
/// The at-rest hardening (not persisting the key in plaintext next to the
/// ciphertext) is tracked as a follow-up and must wrap the key with a
/// passphrase-derived key rather than simply deleting this fallback.
pub fn load_or_create_key(app_data_dir: &Path) -> Result<[u8; 32]> {
    let key_path = app_data_dir.join(KEY_FILE);

    // Prefer the OS keyring for reads; keep a file backup so a later keyring
    // failure can't orphan the key.
    if let Ok(key) = load_key_from_keyring() {
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
        let _ = store_key_in_keyring(&key);
        return Ok(key);
    }

    // First run: generate, persist to the file (reliable) and the keyring (best effort).
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    store_key_to_file(&key_path, &key)?;
    if let Err(e) = store_key_in_keyring(&key) {
        debug!("OS keyring unavailable: {e}. Using file-based key storage.");
    }
    Ok(key)
}

fn load_key_from_keyring() -> Result<[u8; 32]> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| PurrqlError::Config(format!("Keyring init error: {e}")))?;
    let encoded = entry
        .get_password()
        .map_err(|e| PurrqlError::Config(format!("Keyring read error: {e}")))?;
    decode_key(&encoded)
}

fn store_key_in_keyring(key: &[u8; 32]) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| PurrqlError::Config(format!("Keyring init error: {e}")))?;
    let encoded = B64.encode(key);
    entry
        .set_password(&encoded)
        .map_err(|e| PurrqlError::Config(format!("Keyring write error: {e}")))?;
    Ok(())
}

fn load_key_from_file(key_path: &Path) -> Result<[u8; 32]> {
    let encoded = std::fs::read_to_string(key_path)
        .map_err(|e| PurrqlError::Config(format!("Failed to read encryption key: {e}")))?;
    decode_key(encoded.trim())
}

fn store_key_to_file(key_path: &Path, key: &[u8; 32]) -> Result<()> {
    let encoded = B64.encode(key);
    std::fs::write(key_path, &encoded)
        .map_err(|e| PurrqlError::Config(format!("Failed to write encryption key: {e}")))?;

    // Set restrictive file permissions (owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(key_path, perms)
            .map_err(|e| PurrqlError::Config(format!("Failed to set key file permissions: {e}")))?;
    }

    Ok(())
}

fn decode_key(encoded: &str) -> Result<[u8; 32]> {
    let bytes = B64
        .decode(encoded)
        .map_err(|e| PurrqlError::Config(format!("Invalid encryption key encoding: {e}")))?;
    if bytes.len() != 32 {
        return Err(PurrqlError::Config(
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
        .map_err(|e| PurrqlError::Config(format!("Encryption error: {e}")))?;

    Ok((B64.encode(ciphertext), B64.encode(nonce_bytes)))
}

/// Decrypt a password using AES-256-GCM.
pub fn decrypt(cipher: &Aes256Gcm, ciphertext_b64: &str, nonce_b64: &str) -> Result<String> {
    let ciphertext = B64
        .decode(ciphertext_b64)
        .map_err(|e| PurrqlError::Config(format!("Invalid ciphertext: {e}")))?;
    let nonce_bytes = B64
        .decode(nonce_b64)
        .map_err(|e| PurrqlError::Config(format!("Invalid nonce: {e}")))?;
    if nonce_bytes.len() != 12 {
        return Err(PurrqlError::Config(format!(
            "Invalid nonce length: expected 12 bytes, got {}",
            nonce_bytes.len()
        )));
    }
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| PurrqlError::Config(format!("Decryption error: {e}")))?;

    String::from_utf8(plaintext)
        .map_err(|e| PurrqlError::Config(format!("Invalid UTF-8 after decrypt: {e}")))
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
        let dir = std::env::temp_dir().join("purrql_crypto_keyfile_test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.key");
        let _ = std::fs::remove_file(&path);

        let key = [42u8; 32];
        store_key_to_file(&path, &key).unwrap();
        assert!(path.exists(), "key file fallback must exist after write");
        assert_eq!(load_key_from_file(&path).unwrap(), key);

        let _ = std::fs::remove_file(&path);
    }
}
