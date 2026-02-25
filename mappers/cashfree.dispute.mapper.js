/**
 * Cashfree Dispute Mapper
 * ───────────────────────
 * Dispute events: DISPUTE_CREATED | DISPUTE_UPDATED | DISPUTE_CLOSED
 *
 * Payload structure:
 * {
 *   type: "DISPUTE_CREATED",
 *   event_time: "2023-06-15T21:16:03+05:30",
 *   data: {
 *     dispute: {
 *       dispute_id:             "433475257"
 *       dispute_type:           "CHARGEBACK" | "PRE_ARBITRATION"
 *       reason_code:            "4855"
 *       reason_description:     "Goods or Services Not Provided"
 *       dispute_amount:         4500         ← in rupees (not paise!)
 *       dispute_amount_currency: "INR"
 *       created_at:             "2023-06-15T21:16:03+05:30"
 *       updated_at:             "2023-06-15T21:16:51+05:30"
 *       respond_by:             "2023-06-18T00:00:00+05:30"
 *       resolved_at:            "2023-06-15T21:16:51+05:30"
 *       dispute_status:         "CHARGEBACK_CREATED" | "CHARGEBACK_MERCHANT_WON" |
 *                               "CHARGEBACK_MERCHANT_LOST" | "PRE_ARBITRATION_CREATED" |
 *                               "DISPUTE_CLOSED"
 *       cf_dispute_remarks:     "Chargeback won by merchant"
 *       dispute_update:         "TYPE_UPDATE" | null
 *       dispute_action_on:      "MERCHANT" | "CASHFREE"
 *     },
 *     order_details: {
 *       order_id:       "order_xxx"
 *       order_amount:   4500
 *       cf_payment_id:  885457437
 *       payment_amount: 4500
 *       payment_currency: "INR"
 *     },
 *     customer_details: {
 *       customer_name:  "..."
 *       customer_phone: "..."
 *       customer_email: "..."
 *     }
 *   }
 * }
 */

// Map Cashfree dispute_status → our normalized status
const STATUS_MAP = {
  CHARGEBACK_CREATED:              'open',
  CHARGEBACK_UNDER_REVIEW:         'under_review',
  CHARGEBACK_MERCHANT_WON:         'won',
  CHARGEBACK_MERCHANT_LOST:        'lost',
  PRE_ARBITRATION_CREATED:         'open',
  PRE_ARBITRATION_MERCHANT_WON:    'won',
  PRE_ARBITRATION_MERCHANT_LOST:   'lost',
  DISPUTE_CLOSED:                  'closed',
};

// Map Cashfree event type → our status (event is more reliable)
const EVENT_STATUS_MAP = {
  DISPUTE_CREATED: 'open',
  DISPUTE_UPDATED: 'under_review',
  DISPUTE_CLOSED:  'closed',
};

// Map Cashfree dispute_type → our phase
const PHASE_MAP = {
  CHARGEBACK:       'chargeback',
  PRE_ARBITRATION:  'pre_arbitration',
  RETRIEVAL:        'retrieval',
};

function mapCashfreeDispute(body) {
  const event    = body.type   || '';
  const dispute  = body?.data?.dispute       || {};
  const order    = body?.data?.order_details || {};

  // Cashfree sends dispute_amount in rupees → convert to paise
  const disputeAmountInPaise = dispute.dispute_amount
    ? Math.round(parseFloat(dispute.dispute_amount) * 100)
    : null;

  // Status: prefer specific status map, fall back to event-level
  const status =
    STATUS_MAP[dispute.dispute_status] ||
    EVENT_STATUS_MAP[event]            ||
    'unknown';

  return {
    eventType:   event,
    disputeId:   String(dispute.dispute_id || ''),
    paymentId:   dispute.cf_payment_id
      ? String(dispute.cf_payment_id)
      : String(order.cf_payment_id || ''),
    orderId:     order.order_id || null,

    status,
    phase:       PHASE_MAP[dispute.dispute_type] || 'unknown',
    disputeType: dispute.dispute_type || null,

    reasonCode:        dispute.reason_code        || null,
    reasonDescription: dispute.reason_description || null,

    disputeAmount:  disputeAmountInPaise,
    currency:       dispute.dispute_amount_currency || 'INR',
    amountDeducted: 0,  // Cashfree doesn't provide this in webhook

    respondBy: dispute.respond_by ? new Date(dispute.respond_by) : null,

    // Cashfree doesn't send evidence in webhook — only notifies of dispute creation
    evidence: {},

    gatewayRemarks:   dispute.cf_dispute_remarks || null,
    actionRequiredBy: dispute.dispute_action_on  || null,
  };
}

module.exports = { mapCashfreeDispute };