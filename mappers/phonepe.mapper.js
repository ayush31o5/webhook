/**
 * PhonePe → Universal Key Mapper
 * ─────────────────────────────────
 * PhonePe sends a form-urlencoded POST body with a `response` field.
 * The `response` field is base64-encoded JSON. After decoding:
 *
 * {
 *   success: true,
 *   code: "PAYMENT_SUCCESS",
 *   message: "Payment Successful",
 *   data: {
 *     merchantId: "MERCHANTID",
 *     merchantTransactionId: "TXN12345",   ← your txn ID → orderId
 *     transactionId: "T2306071639149....",  ← PhonePe's txn ID → paymentId
 *     amount: 10000,                        ← already in paise
 *     state: "COMPLETED",
 *     responseCode: "SUCCESS",
 *     paymentInstrument: {
 *       type: "UPI_INTENT",
 *       utr: "308012345678"
 *     }
 *   }
 * }
 */

const STATUS_MAP = {
  COMPLETED:            'success',
  PAYMENT_SUCCESS:      'success',
  PAYMENT_PENDING:      'pending',
  PAYMENT_ERROR:        'failed',
  PAYMENT_DECLINED:     'failed',
  TIMED_OUT:            'failed',
  PAYMENT_CANCELLED:    'failed',
};

function resolveMethod(instrument = {}) {
  const type = (instrument.type || '').toUpperCase();
  if (type.includes('UPI'))         return 'upi';
  if (type.includes('CARD'))        return 'card';
  if (type.includes('NETBANKING'))  return 'netbanking';
  if (type.includes('WALLET'))      return 'wallet';
  return 'other';
}

/**
 * @param {object} decoded - decoded PhonePe response JSON
 * @returns {object} normalized fields
 */
function mapPhonePe(decoded) {
  const data       = decoded?.data || {};
  const instrument = data.paymentInstrument || {};

  // PhonePe state is nested in data.state for callbacks
  const state = data.state || decoded.code || '';

  return {
    eventType:     decoded.code         || 'PHONEPE_CALLBACK',
    orderId:       data.merchantTransactionId || null,
    paymentId:     data.transactionId         || null,
    bankRefNumber: instrument.utr             || null,
    amount:        data.amount                || null,  // already in paise
    currency:      'INR',
    status:        STATUS_MAP[state] || STATUS_MAP[decoded.code] || 'unknown',
    method:        resolveMethod(instrument),
    customerEmail: null,   // PhonePe doesn't send customer details in callback
    customerPhone: null,
    customerName:  null,
  };
}

module.exports = { mapPhonePe };