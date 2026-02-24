/**
 * Razorpay Webhook Verifier
 * ─────────────────────────
 * Header : X-Razorpay-Signature
 * Algorithm: HMAC-SHA256(rawBody, webhookSecret) → hex
 *
 * Docs: https://razorpay.com/docs/webhooks/validate-test/
 *
 * IMPORTANT: Must use req.rawBody (raw bytes), NOT JSON.stringify(req.body)
 */

const crypto = require('crypto');

/**
 * @param {string} rawBody          - req.rawBody (raw string)
 * @param {string} receivedSig      - req.headers['x-razorpay-signature']
 * @param {string} webhookSecret    - decrypted webhookSecret from MerchantConfig
 * @returns {boolean}
 */
function verifyRazorpay(rawBody, receivedSig, webhookSecret) {
  if (!rawBody || !receivedSig || !webhookSecret) return false;

  const expectedSig = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSig, 'hex'),
      Buffer.from(receivedSig, 'hex')
    );
  } catch {
    return false;
  }
}

module.exports = { verifyRazorpay };