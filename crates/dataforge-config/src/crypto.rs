use std::path::Path;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;

use dataforge_core::error::{DataForgeError, Result};

const KEY_FILE: &str = "dataforge.key";

/// Load or generate a 256-bit encryption key stored in the app data directory.
pub fn load_or_create_key(app_data_dir: &Path) -> Result<[u8; 32]> {
    let key_path = app_data_dir.join(KEY_FILE);
    if key_path.exists() {
        let encoded = std::fs::read_to_string(&key_path)
            .map_err(|e| DataForgeError::Config(format!("Failed to read encryption key: {e}")))?;
        let bytes = B64
            .decode(encoded.trim())
            .map_err(|e| DataForgeError::Config(format!("Invalid encryption key: {e}")))?;
        if bytes.len() != 32 {
            return Err(DataForgeError::Config(
                "Encryption key has invalid length".into(),
            ));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        Ok(key)
    } else {
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        let encoded = B64.encode(key);
        std::fs::write(&key_path, &encoded)
            .map_err(|e| DataForgeError::Config(format!("Failed to write encryption key: {e}")))?;
        Ok(key)
    }
}

/// Encrypt a password using AES-256-GCM. Returns (ciphertext_b64, nonce_b64).
pub fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<(String, String)> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| DataForgeError::Config(format!("Cipher init error: {e}")))?;

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| DataForgeError::Config(format!("Encryption error: {e}")))?;

    Ok((B64.encode(ciphertext), B64.encode(nonce_bytes)))
}

/// Decrypt a password using AES-256-GCM.
pub fn decrypt(key: &[u8; 32], ciphertext_b64: &str, nonce_b64: &str) -> Result<String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| DataForgeError::Config(format!("Cipher init error: {e}")))?;

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
