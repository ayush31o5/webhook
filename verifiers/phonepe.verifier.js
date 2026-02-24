/**
 * PhonePe Webhook Verifier
 * ────────────────────────
 * PhonePe sends a form-urlencoded POST body with a `response` field
 * which is a base64-encoded JSON string.
 *
 * Header: X-VERIFY
 * Checksum format: SHA256( base64Response + "/pg/v1/callback" + saltKey ) + "###" + saltIndex
 *
 * Docs: https://developer.phonepe.com/v1/docs/pay-api
 */

const crypto = require('crypto');

/**
 * @param {string} base64Response   - req.body.response (the raw base64 string from PhonePe)
 * @param {string} xVerifyHeader    - req.headers['x-verify']
 * @param {string} saltKey          - decrypted saltKey from MerchantConfig
 * @param {string} saltIndex        - saltIndex from MerchantConfig (e.g. "1")
 * @returns {boolean}
 */
function verifyPhonePe(base64Response, xVerifyHeader, saltKey, saltIndex) {
  if (!base64Response || !xVerifyHeader || !saltKey || !saltIndex) return false;

  const callbackEndpoint = '/pg/v1/callback';
  const stringToHash     = base64Response + callbackEndpoint + saltKey;

  const sha256      = crypto.createHash('sha256').update(stringToHash).digest('hex');
  const expectedSig = `${sha256}###${saltIndex}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSig),
      Buffer.from(xVerifyHeader)
    );
  } catch {
    return false;
  }
}

/**
 * Decode the PhonePe base64 response body into a JS object.
 * @param {string} base64Response
 * @returns {object|null}
 */
function decodePhonePeResponse(base64Response) {
  try {
    const json = Buffer.from(base64Response, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

module.exports = { verifyPhonePe, decodePhonePeResponse };