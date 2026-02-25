/**
 * Razorpay Dispute Mapper
 * ───────────────────────
 * Dispute events: payment.dispute.created | payment.dispute.won |
 *                 payment.dispute.lost    | payment.dispute.closed |
 *                 payment.dispute.under_review | payment.dispute.action_required
 *
 * Payload structure:
 * {
 *   event: "payment.dispute.created",
 *   payload: {
 *     payment: { entity: { id, order_id, amount, ... } },
 *     dispute: {
 *       entity: {
 *         id:             "disp_EsIAlDcoUr8CaQ"
 *         payment_id:     "pay_EFtmUsbwpXwBHI"
 *         amount:         39000           ← dispute amount in paise
 *         currency:       "INR"
 *         reason_code:    "processed_invalid_expired_card"
 *         respond_by:     1590431400      ← Unix timestamp
 *         status:         "open" | "under_review" | "won" | "lost" | "closed"
 *         phase:          "chargeback" | "pre_arbitration" | "arbitration"
 *         amount_deducted: 0
 *         evidence: {
 *           summary:                  null
 *           shipping_proof:           null | [doc_id, ...]
 *           billing_proof:            null | [doc_id, ...]
 *           cancellation_proof:       null
 *           customer_communication:   null
 *           proof_of_service:         null
 *           explanation_letter:       null
 *           refund_confirmation:      null
 *           access_activity_log:      null
 *           refund_cancellation_policy: null
 *           term_and_conditions:      null
 *           others:                   null | [{type, document_ids}]
 *           submitted_at:             null | timestamp
 *         }
 *         created_at: 1589907957
 *       }
 *     }
 *   }
 * }
 */

const DISPUTE_STATUS_MAP = {
  open:             'open',
  under_review:     'under_review',
  won:              'won',
  lost:             'lost',
  closed:           'closed',
};

// Razorpay event name → our status (event is more reliable than entity.status sometimes)
const EVENT_STATUS_MAP = {
  'payment.dispute.created':        'open',
  'payment.dispute.under_review':   'under_review',
  'payment.dispute.action_required':'action_required',
  'payment.dispute.won':            'won',
  'payment.dispute.lost':           'lost',
  'payment.dispute.closed':         'closed',
};

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function mapRazorpayDispute(body) {
  const event    = body.event || '';
  const payment  = body?.payload?.payment?.entity || {};
  const disp     = body?.payload?.dispute?.entity  || {};
  const evidence = disp.evidence || {};

  return {
    eventType:   event,
    disputeId:   disp.id           || null,
    paymentId:   disp.payment_id   || payment.id   || null,
    orderId:     payment.order_id  || null,

    status:      EVENT_STATUS_MAP[event] || DISPUTE_STATUS_MAP[disp.status] || 'unknown',
    phase:       disp.phase        || 'unknown',
    disputeType: disp.phase        || null,   // Razorpay phase = dispute type

    reasonCode:        disp.reason_code   || null,
    reasonDescription: disp.reason_code   || null,  // Razorpay uses code only

    disputeAmount:  disp.amount           || null,  // already in paise
    currency:       disp.currency         || 'INR',
    amountDeducted: disp.amount_deducted  || 0,

    respondBy: disp.respond_by
      ? new Date(disp.respond_by * 1000)    // Unix timestamp → Date
      : null,

    evidence: {
      summary:                   evidence.summary              || null,
      shippingProof:             toArray(evidence.shipping_proof),
      billingProof:              toArray(evidence.billing_proof),
      cancellationProof:         toArray(evidence.cancellation_proof),
      customerCommunication:     toArray(evidence.customer_communication),
      proofOfService:            toArray(evidence.proof_of_service),
      explanationLetter:         toArray(evidence.explanation_letter),
      refundConfirmation:        toArray(evidence.refund_confirmation),
      accessActivityLog:         toArray(evidence.access_activity_log),
      refundCancellationPolicy:  toArray(evidence.refund_cancellation_policy),
      termsAndConditions:        toArray(evidence.term_and_conditions),
      others:                    evidence.others || null,
      submittedAt:               evidence.submitted_at
        ? new Date(evidence.submitted_at * 1000)
        : null,
    },

    gatewayRemarks:   null,
    actionRequiredBy: event === 'payment.dispute.action_required' ? 'MERCHANT' : null,
  };
}

module.exports = { mapRazorpayDispute };