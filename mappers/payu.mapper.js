/**
 * PayU → Universal Key Mapper
 * ─────────────────────────────
 * PayU sends a form-urlencoded POST body. Sample fields:
 *
 *   mihpayid       = "403993715528735905"   ← PayU's own txn ID
 *   txnid          = "e41097ba86bffc0eb67f" ← Your txn ID (maps to orderId)
 *   amount         = "10.00"                ← rupees (string)
 *   status         = "success"
 *   mode           = "UPI" | "CC" | "DC" | "NB" | "CASH"
 *   key            = "QyT13U"               ← merchant key
 *   firstname      = "Test User"
 *   email          = "test@example.com"
 *   phone          = "9999999999"
 *   bank_ref_num   = "xxx"
 *   unmappedstatus = "captured"
 */

const STATUS_MAP = {
  success: 'success',
  failure: 'failed',
  pending: 'pending',
};

const METHOD_MAP = {
  UPI:   'upi',
  CC:    'card',
  DC:    'card',
  NB:    'netbanking',
  CASH:  'cash',
  EMI:   'emi',
  WALLET:'wallet',
};

/**
 * @param {object} body - parsed form-urlencoded body
 * @returns {object} normalized fields
 */
function mapPayU(body) {
  // PayU sends amount in rupees (string) — convert to paise
  const amountInPaise = body.amount
    ? Math.round(parseFloat(body.amount) * 100)
    : null;

  return {
    eventType:     `payu.payment.${body.status || 'unknown'}`,
    orderId:       body.txnid          || null,   // your txn id
    paymentId:     body.mihpayid       || null,   // PayU's txn id
    bankRefNumber: body.bank_ref_num   || body.bank_ref_no || null,
    amount:        amountInPaise,
    currency:      'INR',
    status:        STATUS_MAP[body.status?.toLowerCase()] || 'unknown',
    method:        METHOD_MAP[body.mode?.toUpperCase()]   || 'other',
    customerEmail: body.email          || null,
    customerPhone: body.phone          || null,
    customerName:  body.firstname
      ? `${body.firstname} ${body.lastname || ''}`.trim()
      : null,
  };
}

module.exports = { mapPayU };