/**
 * Cashfree Webhook Verifier
 * ─────────────────────────
 * Headers : x-webhook-signature, x-webhook-timestamp
 * Algorithm: Base64( HMAC-SHA256( timestamp + rawBody, clientSecret ) )
 *
 * Docs: https://www.cashfree.com/docs/payments/online/webhooks/signature-verification
 */

const crypto = require('crypto');

/**
 * @param {string} rawBody          - req.rawBody (raw string)
 * @param {string} receivedSig      - req.headers['x-webhook-signature']
 * @param {string} timestamp        - req.headers['x-webhook-timestamp']
 * @param {string} clientSecret     - decrypted clientSecret from MerchantConfig
 * @returns {boolean}
 */
function verifyCashfree(rawBody, receivedSig, timestamp, clientSecret) {
  if (!rawBody || !receivedSig || !timestamp || !clientSecret) return false;

  // signedPayload = timestamp + rawBody (no separator)
  const signedPayload = timestamp + rawBody;

  const expectedSig = crypto
    .createHmac('sha256', clientSecret)
    .update(signedPayload)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSig),
      Buffer.from(receivedSig)
    );
  } catch {
    return false;
  }
}

module.exports = { verifyCashfree };