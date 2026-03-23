/**
 * Razorpay → Transaction Mapper
 *
 * Razorpay webhook events and their payload structure:
 *
 * payment.captured / payment.failed / payment.authorized
 *   payload.payment.entity → full payment object
 *
 * refund.created / refund.processed
 *   payload.refund.entity  → refund object
 *   payload.payment.entity → original payment
 *
 * order.paid
 *   payload.order.entity   → order object
 *   payload.payment.entity → payment object
 *
 * payment.dispute.created / payment.dispute.won / payment.dispute.lost
 *   payload.dispute.entity → dispute object
 *   payload.payment.entity → payment object
 */

const STATUS_MAP = {
  captured:   'success',
  authorized: 'pending',
  failed:     'failed',
  refunded:   'refund',
  created:    'pending',
};

const METHOD_MAP = {
  card:       'card',
  upi:        'upi',
  netbanking: 'netbanking',
  wallet:     'wallet',
  emi:        'emi',
};

function mapRazorpay(body) {
  const event    = body.event || '';
  const payment  = body?.payload?.payment?.entity || {};
  const refund   = body?.payload?.refund?.entity  || null;
  const dispute  = body?.payload?.dispute?.entity || null;

  let rawStatus = payment.status;
  if (refund)  rawStatus = 'refunded';
  if (dispute) rawStatus = 'disputed';
  // event-level override for clarity
  if (event === 'payment.failed') rawStatus = 'failed';

  const method = METHOD_MAP[payment.method] || 'other';

  // ── Method-specific details ─────────────────────────────────────
  const upi = {};
  const card = {};
  const netbanking = {};
  const wallet = {};

  if (method === 'upi') {
    upi.vpa = payment.vpa || null;
    // UTR comes from acquirer_data
    upi.utr = payment.acquirer_data?.upi_transaction_id || null;
  }

  if (method === 'card' || method === 'emi') {
    const c = payment.card || {};
    card.network = c.network || null;   // Visa, Mastercard, RuPay, Amex
    card.last4   = c.last4   || null;
    card.type    = c.type    || null;   // credit / debit
    card.bank    = c.issuer  || null;
  }

  if (method === 'netbanking') {
    netbanking.bank     = payment.bank      || null;
    netbanking.bankCode = payment.bank_code || null;
  }

  if (method === 'wallet') {
    wallet.name = payment.wallet || null;
  }

  return {
    eventType:     event,
    orderId:       payment.order_id || body?.payload?.order?.entity?.id || null,
    paymentId:     refund ? refund.id  : (payment.id  || null),
    bankRefNumber: payment.acquirer_data?.bank_transaction_id || null,
    amount:        payment.amount    || null,   // already in paise
    currency:      payment.currency  || 'INR',
    status:        STATUS_MAP[rawStatus] || (dispute ? 'disputed' : 'unknown'),
    method,
    upi,
    card,
    netbanking,
    wallet,
    failureReason: payment.error_description || payment.error_reason || null,
    customer: {
      email: payment.email   || null,
      phone: payment.contact || null,
      name:  null,    // Razorpay doesn't send name in webhook
    },
  };
}

module.exports = { mapRazorpay };