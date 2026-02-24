/**
 * CCAvenue Webhook Verifier / Decryptor
 * ──────────────────────────────────────
 * CCAvenue does NOT use HMAC. Instead, the entire response body
 * is AES-128-CBC encrypted using the Working Key.
 *
 * The body arrives as: { encResp: "<hex-encoded-ciphertext>" }
 *
 * Decryption steps (per official CCAvenue docs):
 *   1. key  = MD5( workingKey )              → 16 bytes
 *   2. iv   = 0x000102030405060708090a0b0c0d0e0f   → 16 bytes
 *   3. AES-128-CBC decrypt the hex-encoded ciphertext
 *   4. Parse the resulting query-string format into an object
 *
 * Verification: If decryption succeeds and merchant_id in the
 * decrypted payload matches the configured MerchantConfig.merchantId,
 * we consider it verified (CCAvenue has no separate signature).
 *
 * Docs: https://www.ccavenue.com/download/integration-kit.jsp
 */

const crypto = require('crypto');

const IV = Buffer.from([
  0x00, 0x01, 0x02, 0x03,
  0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b,
  0x0c, 0x0d, 0x0e, 0x0f,
]);

/**
 * Decrypt CCAvenue's encResp field.
 *
 * @param {string} encResp      - hex-encoded ciphertext from CCAvenue
 * @param {string} workingKey   - decrypted workingKey from MerchantConfig (plaintext)
 * @returns {object|null}       - parsed response fields, or null on failure
 */
function decryptCCAvenue(encResp, workingKey) {
  if (!encResp || !workingKey) return null;

  try {
    const key = crypto.createHash('md5').update(workingKey).digest();    // 16-byte key
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, IV);
    decipher.setAutoPadding(true);

    let decrypted  = decipher.update(encResp, 'hex', 'utf8');
    decrypted     += decipher.final('utf8');

    // CCAvenue returns a query-string encoded response
    // e.g. "order_id=123&tracking_id=456&order_status=Success&..."
    const parsed = Object.fromEntries(new URLSearchParams(decrypted));
    return parsed;
  } catch (err) {
    console.error('[CCAvenue] Decryption failed:', err.message);
    return null;
  }
}

/**
 * "Verify" CCAvenue: decrypt + check that merchant_id matches our config.
 *
 * @param {string} encResp
 * @param {string} workingKey
 * @param {string} expectedMerchantId   - MerchantConfig.merchantId
 * @returns {{ isVerified: boolean, decrypted: object|null }}
 */
function verifyCCAvenue(encResp, workingKey, expectedMerchantId) {
  const decrypted = decryptCCAvenue(encResp, workingKey);
  if (!decrypted) return { isVerified: false, decrypted: null };

  // CCAvenue includes merchant_id in the decrypted payload
  const isVerified = decrypted.merchant_id === String(expectedMerchantId);
  return { isVerified, decrypted };
}

module.exports = { verifyCCAvenue, decryptCCAvenue };