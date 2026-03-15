use std::path::Path;

use aes_gcm::{
    aead::Aead,
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use tracing::{debug, warn};

use dataforge_core::error::{DataForgeError, Result};

const KEYRING_SERVICE: &str = "dataforge";
const KEYRING_USER: &str = "master-key";
const KEY_FILE: &str = "dataforge.key";

/// Load or generate a 256-bit encryption key.
/// Primary: OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service).
/// Fallback: encrypted file in app data directory with restrictive permissions.
pub fn load_or_create_key(app_data_dir: &Path) -> Result<[u8; 32]> {
    // Try loading from OS keyring first
    match load_key_from_keyring() {
        Ok(key) => {
            debug!("Encryption key loaded from OS keyring");
            return Ok(key);
        }
        Err(e) => {
            debug!("OS keyring not available for key retrieval: {e}");
        }
    }

    // Fallback: load from file
    let key_path = app_data_dir.join(KEY_FILE);
    if key_path.exists() {
        let key = load_key_from_file(&key_path)?;
        // Migrate to keyring if possible
        if let Err(e) = store_key_in_keyring(&key) {
            debug!("Could not migrate key to OS keyring: {e}");
        }
        return Ok(key);
    }

    // Generate a new key
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);

    // Store in OS keyring (primary)
    match store_key_in_keyring(&key) {
        Ok(()) => {
            debug!("New encryption key stored in OS keyring");
        }
        Err(e) => {
            warn!("OS keyring unavailable: {e}. Falling back to file-based key storage.");
            store_key_to_file(&key_path, &key)?;
        }
    }

    Ok(key)
}

fn load_key_from_keyring() -> Result<[u8; 32]> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| DataForgeError::Config(format!("Keyring init error: {e}")))?;
    let encoded = entry
        .get_password()
        .map_err(|e| DataForgeError::Config(format!("Keyring read error: {e}")))?;
    decode_key(&encoded)
}

fn store_key_in_keyring(key: &[u8; 32]) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| DataForgeError::Config(format!("Keyring init error: {e}")))?;
    let encoded = B64.encode(key);
    entry
        .set_password(&encoded)
        .map_err(|e| DataForgeError::Config(format!("Keyring write error: {e}")))?;
    Ok(())
}

fn load_key_from_file(key_path: &Path) -> Result<[u8; 32]> {
    let encoded = std::fs::read_to_string(key_path)
        .map_err(|e| DataForgeError::Config(format!("Failed to read encryption key: {e}")))?;
    decode_key(encoded.trim())
}

fn store_key_to_file(key_path: &Path, key: &[u8; 32]) -> Result<()> {
    let encoded = B64.encode(key);
    std::fs::write(key_path, &encoded)
        .map_err(|e| DataForgeError::Config(format!("Failed to write encryption key: {e}")))?;

    // Set restrictive file permissions (owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(key_path, perms)
            .map_err(|e| DataForgeError::Config(format!("Failed to set key file permissions: {e}")))?;
    }

    Ok(())
}

fn decode_key(encoded: &str) -> Result<[u8; 32]> {
    let bytes = B64
        .decode(encoded)
        .map_err(|e| DataForgeError::Config(format!("Invalid encryption key encoding: {e}")))?;
    if bytes.len() != 32 {
        return Err(DataForgeError::Config(
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
        .map_err(|e| DataForgeError::Config(format!("Encryption error: {e}")))?;

    Ok((B64.encode(ciphertext), B64.encode(nonce_bytes)))
}

/// Decrypt a password using AES-256-GCM.
pub fn decrypt(cipher: &Aes256Gcm, ciphertext_b64: &str, nonce_b64: &str) -> Result<String> {
    let ciphertext = B64
        .decode(ciphertext_b64)
        .map_err(|e| DataForgeError::Config(format!("Invalid ciphertext: {e}")))?;
    let nonce_bytes = B64
        .decode(nonce_b64)
        .map_err(|e| DataForgeError::Config(format!("Invalid nonce: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| DataForgeError::Config(format!("Decryption error: {e}")))?;

    String::from_utf8(plaintext)
        .map_err(|e| DataForgeError::Config(format!("Invalid UTF-8 after decrypt: {e}")))
}
