/**
 * CCAvenue → Universal Key Mapper
 * ─────────────────────────────────
 * After AES-128-CBC decryption of encResp, CCAvenue gives a query-string
 * which parses to an object like:
 *
 * {
 *   order_id:       "9840661",        ← your order ID → orderId
 *   tracking_id:    "308005007091",   ← CCAvenue's txn ID → paymentId
 *   bank_ref_no:    "1555842850653",
 *   order_status:   "Success",        ← "Success" | "Failure" | "Aborted" | "Invalid"
 *   failure_message:"",
 *   payment_mode:   "Net Banking",
 *   card_name:      "AvenuesTest",
 *   amount:         "1000.00",        ← rupees (string)
 *   currency:       "INR",
 *   billing_name:   "Test User",
 *   billing_tel:    "9999999999",
 *   billing_email:  "test@example.com",
 *   merchant_id:    "12345678",
 *   ...
 * }
 */

const STATUS_MAP = {
  Success:  'success',
  Failure:  'failed',
  Aborted:  'failed',
  Invalid:  'failed',
};

const METHOD_MAP = {
  'Net Banking':    'netbanking',
  'Credit Card':    'card',
  'Debit Card':     'card',
  'UPI':            'upi',
  'Wallet':         'wallet',
  'EMI':            'emi',
  'Prepaid Card':   'card',
};

/**
 * @param {object} decrypted - parsed CCAvenue decrypted response
 * @returns {object} normalized fields
 */
function mapCCAvenue(decrypted) {
  // CCAvenue sends amount in rupees (string) — convert to paise
  const amountInPaise = decrypted.amount
    ? Math.round(parseFloat(decrypted.amount) * 100)
    : null;

  return {
    eventType:     `ccavenue.payment.${(decrypted.order_status || 'unknown').toLowerCase()}`,
    orderId:       decrypted.order_id    || null,
    paymentId:     decrypted.tracking_id || null,
    bankRefNumber: decrypted.bank_ref_no || null,
    amount:        amountInPaise,
    currency:      decrypted.currency    || 'INR',
    status:        STATUS_MAP[decrypted.order_status] || 'unknown',
    method:        METHOD_MAP[decrypted.payment_mode] || 'other',
    customerEmail: decrypted.billing_email || null,
    customerPhone: decrypted.billing_tel   || null,
    customerName:  decrypted.billing_name  || null,
  };
}

module.exports = { mapCCAvenue };