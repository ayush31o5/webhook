/**
 * Cashfree → Universal Key Mapper
 * ─────────────────────────────────
 * Sample payload (PAYMENT_SUCCESS_WEBHOOK):
 * {
 *   type: "PAYMENT_SUCCESS_WEBHOOK",
 *   data: {
 *     order: {
 *       order_id: "order_xxx",
 *       order_amount: 500.00,    ← rupees (float)
 *       order_currency: "INR",
 *       order_status: "PAID",
 *       cf_order_id: 123456
 *     },
 *     payment: {
 *       cf_payment_id: 789,
 *       payment_status: "SUCCESS",
 *       payment_amount: 500.00,
 *       payment_currency: "INR",
 *       payment_message: "Payment Success",
 *       payment_time: "2023-...",
 *       bank_reference: "xxx",
 *       payment_method: {
 *         upi: { upi_id: "xxx@ybl", channel: "collect" }
 *       }
 *     },
 *     customer_details: {
 *       customer_id: "xxx",
 *       customer_name: "Test User",
 *       customer_email: "test@example.com",
 *       customer_phone: "9999999999"
 *     }
 *   }
 * }
 */

const STATUS_MAP = {
  SUCCESS:    'success',
  FAILED:     'failed',
  PENDING:    'pending',
  CANCELLED:  'failed',
  USER_DROPPED: 'failed',
  FLAGGED:    'pending',
  VOID:       'refund',
};

function resolveMethod(paymentMethod = {}) {
  if (paymentMethod.upi)        return 'upi';
  if (paymentMethod.card)       return 'card';
  if (paymentMethod.netbanking) return 'netbanking';
  if (paymentMethod.wallet)     return 'wallet';
  if (paymentMethod.emi)        return 'emi';
  return 'other';
}

/**
 * @param {object} body - parsed JSON body
 * @returns {object} normalized fields
 */
function mapCashfree(body) {
  const order    = body?.data?.order    || {};
  const payment  = body?.data?.payment  || {};
  const customer = body?.data?.customer_details || {};

  // Cashfree sends amount in rupees (float) — convert to paise
  const amountInPaise = payment.payment_amount != null
    ? Math.round(parseFloat(payment.payment_amount) * 100)
    : null;

  return {
    eventType:     body.type,
    orderId:       order.order_id           || null,
    paymentId:     String(payment.cf_payment_id || ''),
    bankRefNumber: payment.bank_reference   || null,
    amount:        amountInPaise,
    currency:      payment.payment_currency || 'INR',
    status:        STATUS_MAP[payment.payment_status] || 'unknown',
    method:        resolveMethod(payment.payment_method),
    customerEmail: customer.customer_email  || null,
    customerPhone: customer.customer_phone  || null,
    customerName:  customer.customer_name   || null,
  };
}

module.exports = { mapCashfree };