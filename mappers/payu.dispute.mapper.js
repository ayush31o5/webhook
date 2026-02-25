/**
 * PayU Chargeback (Dispute) Mapper
 * ─────────────────────────────────
 * PayU sends chargeback webhooks as form-urlencoded POST body:
 *
 * {
 *   type:        "payments",
 *   event:       "dispute",
 *   reason_code: "Fraud - Card Present Environment",
 *   created_at:  "2025-01-15T21:28:25.000+05:30",
 *   updated_at:  "2025-05-27T22:08:16.000+05:30",
 *   mid:         "QyT13U",           ← your merchant key (matches :merchantId in URL)
 *   cb_id:       1761758,            ← PayU's chargeback ID → disputeId
 *   txn_id:      "999000000000468",  ← your txn ID → orderId
 *   cb_type:     "RBI/BO",           ← chargeback type (card network / regulatory)
 *   due_date:    "2025-03-31",       ← respond-by date (YYYY-MM-DD)
 *   cb_amount:   "1.0",              ← rupees (string) → ×100 = paise
 *   cb_status:   "Bank Comm Sent"    ← see status map below
 * }
 *
 * PayU cb_status values:
 *   "Bank Comm Sent"     → bank notified merchant, response required  → open
 *   "Merchant Responded" → merchant submitted docs                    → under_review
 *   "Resolved - Won"     → decided in merchant's favour              → won
 *   "Resolved - Lost"    → decided against merchant                  → lost
 *   "Resolved"           → resolved (direction unclear)              → closed
 *   "Withdrawn"          → customer withdrew the chargeback          → closed
 *
 * Note: PayU does NOT send paymentId (mihpayid) in dispute webhook.
 *       Link to Transaction via orderId (txn_id).
 */

const STATUS_MAP = {
  'Bank Comm Sent':     'open',
  'Merchant Responded': 'under_review',
  'Resolved - Won':     'won',
  'Resolved - Lost':    'lost',
  'Resolved':           'closed',
  'Withdrawn':          'closed',
};

function mapPayUDispute(body) {
  // cb_amount in rupees (string) → paise
  const disputeAmountInPaise = body.cb_amount
    ? Math.round(parseFloat(body.cb_amount) * 100)
    : null;

  // due_date is "YYYY-MM-DD"
  const respondBy = body.due_date ? new Date(body.due_date) : null;

  const rawStatus = (body.cb_status || '').trim();

  return {
    eventType:   'payu.dispute',
    disputeId:   String(body.cb_id || ''),
    paymentId:   null,          // PayU doesn't provide this in dispute webhook
    orderId:     body.txn_id || null,

    status:      STATUS_MAP[rawStatus] || 'unknown',
    phase:       'chargeback',  // PayU only notifies for chargebacks
    disputeType: body.cb_type  || null,   // "RBI/BO" | "VISA" | "MC"

    reasonCode:        body.reason_code || null,
    reasonDescription: body.reason_code || null,

    disputeAmount:  disputeAmountInPaise,
    currency:       'INR',
    amountDeducted: 0,  // not provided in PayU webhook

    respondBy,

    // PayU doesn't send evidence state in webhook
    evidence: {},

    gatewayRemarks:   body.cb_status || null,
    actionRequiredBy: rawStatus === 'Bank Comm Sent' ? 'MERCHANT' : null,
  };
}

// Detect if a PayU webhook body is a dispute event vs payment event
function isPayUDisputeEvent(body) {
  return body?.type === 'payments' && body?.event === 'dispute';
}

module.exports = { mapPayUDispute, isPayUDisputeEvent };