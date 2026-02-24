/**
 * PayU Webhook Verifier
 * ──────────────────────
 * PayU sends a form-urlencoded POST body.
 * Verification uses "reverse hashing" (SHA-512).
 *
 * Reverse hash string format:
 *   additional_charges|SALT|status|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
 *
 * If additional_charges is not present, the format is:
 *   SALT|status|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
 *
 * Docs: https://docs.payu.in/docs/generate-hash-merchant-hosted (reverse section)
 */

const crypto = require('crypto');

/**
 * @param {object} body     - req.body (parsed form-urlencoded)
 * @param {string} salt     - decrypted salt from MerchantConfig
 * @returns {boolean}
 */
function verifyPayU(body, salt) {
  if (!body || !salt) return false;

  const {
    key, txnid, amount, productinfo, firstname, email,
    udf1 = '', udf2 = '', udf3 = '', udf4 = '', udf5 = '',
    status,
    additional_charges,
    hash: receivedHash,
  } = body;

  if (!key || !txnid || !amount || !productinfo || !firstname ||
      !email || !status || !receivedHash) {
    return false;
  }

  // Build the reverse hash string
  let hashString;
  if (additional_charges) {
    hashString = `${additional_charges}|${salt}|${status}|${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  } else {
    hashString = `${salt}|${status}|${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  }

  const expectedHash = crypto
    .createHash('sha512')
    .update(hashString)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedHash),
      Buffer.from(receivedHash)
    );
  } catch {
    return false;
  }
}

module.exports = { verifyPayU };