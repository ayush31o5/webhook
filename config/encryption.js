/**
 * AES-256-GCM encryption for storing gateway secrets in MongoDB.
 * The ENCRYPTION_KEY env var is the only secret that must NEVER touch the DB.
 *
 * Format stored in DB:
 *   iv:authTag:ciphertext   (all hex-encoded, colon-separated)
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_HEX   = process.env.ENCRYPTION_KEY || '';

function getKey() {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('[Encryption] ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(KEY_HEX, 'hex');
}

/**
 * Encrypt a plaintext string.
 * @param {string} plaintext
 * @returns {string}  iv:authTag:ciphertext
 */
function encrypt(plaintext) {
  const key    = getKey();
  const iv     = crypto.randomBytes(12);                        // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted    += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an encrypted string produced by encrypt().
 * @param {string} stored   iv:authTag:ciphertext
 * @returns {string} plaintext
 */
function decrypt(stored) {
  const key    = getKey();
  const parts  = stored.split(':');
  if (parts.length !== 3) throw new Error('[Encryption] Invalid encrypted format');

  const [ivHex, authTagHex, encryptedHex] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted  = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted     += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };