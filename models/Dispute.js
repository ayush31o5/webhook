/**
 * Dispute
 * ───────
 * Separate collection for ALL dispute/chargeback events.
 *
 * Why separate from Transaction?
 *   - A dispute is NOT a payment event — it's a post-payment challenge
 *   - Multiple dispute events arrive for the same dispute (created → under_review → won/lost)
 *   - We UPSERT by (gateway + disputeId) so all updates hit the same document
 *   - Evidence submission, respondBy deadlines, amountDeducted — none of these
 *     belong in a Transaction document
 *
 * ── Which gateways support dispute webhooks ──────────────────────────────────
 *
 * ✅ RAZORPAY
 *   Events: payment.dispute.created | payment.dispute.won | payment.dispute.lost
 *           payment.dispute.closed  | payment.dispute.under_review
 *           payment.dispute.action_required
 *   Key fields:
 *     dispute.entity.id            → disputeId
 *     dispute.entity.payment_id    → paymentId
 *     dispute.entity.amount        → disputeAmount (paise)
 *     dispute.entity.reason_code   → reasonCode
 *     dispute.entity.status        → open | under_review | won | lost | closed
 *     dispute.entity.phase         → chargeback | pre_arbitration | arbitration
 *     dispute.entity.respond_by    → Unix timestamp (deadline)
 *     dispute.entity.amount_deducted
 *     dispute.entity.evidence.*    → all proof document IDs
 *
 * ✅ CASHFREE
 *   Events: DISPUTE_CREATED | DISPUTE_UPDATED | DISPUTE_CLOSED
 *   Key fields:
 *     data.dispute.dispute_id      → disputeId
 *     data.dispute.dispute_type    → CHARGEBACK | PRE_ARBITRATION
 *     data.dispute.reason_code     → reasonCode  (e.g. "4855")
 *     data.dispute.reason_description
 *     data.dispute.dispute_amount  → rupees → ×100 = paise
 *     data.dispute.dispute_status  → CHARGEBACK_CREATED | CHARGEBACK_MERCHANT_WON | ...
 *     data.dispute.respond_by      → ISO datetime string
 *     data.dispute.dispute_action_on → "MERCHANT" | "CASHFREE"
 *     data.dispute.cf_dispute_remarks
 *     data.order_details.order_id  → orderId
 *     data.order_details.cf_payment_id → paymentId
 *
 * ✅ PAYU (India)
 *   Event: { type: "payments", event: "dispute" }
 *   Key fields:
 *     mid          → merchantId (matches route param)
 *     cb_id        → disputeId  (PayU's chargeback ID)
 *     txn_id       → orderId    (your txn ID)
 *     cb_amount    → rupees string → ×100 = paise
 *     cb_status    → "Bank Comm Sent" | "Merchant Responded" | "Resolved" | etc.
 *     cb_type      → "RBI/BO" | "VISA" | "MC" etc.
 *     reason_code  → reason text
 *     due_date     → "YYYY-MM-DD" (respond-by deadline)
 *
 * ❌ PHONEPE  — No dispute webhooks. Manual via PhonePe Business dashboard.
 * ❌ CCAVENUE — No dispute webhooks. Handled via CCAvenue ODR portal.
 */

const mongoose = require('mongoose');

// ── Evidence schema (Razorpay-normalized, works for all gateways) ──────────
const EvidenceSchema = new mongoose.Schema(
  {
    // Text summary of the dispute defense
    summary: { type: String },

    // Each of these can be an array of document IDs (Razorpay) or URLs (others)
    shippingProof:           { type: [String], default: [] },
    billingProof:            { type: [String], default: [] },
    cancellationProof:       { type: [String], default: [] },
    customerCommunication:   { type: [String], default: [] },
    proofOfService:          { type: [String], default: [] },
    explanationLetter:       { type: [String], default: [] },
    refundConfirmation:      { type: [String], default: [] },
    accessActivityLog:       { type: [String], default: [] },
    refundCancellationPolicy:{ type: [String], default: [] },
    termsAndConditions:      { type: [String], default: [] },

    // Catch-all for anything not in the above categories
    others: { type: mongoose.Schema.Types.Mixed },

    // When evidence was submitted to the gateway
    submittedAt: { type: Date },
  },
  { _id: false }
);

const DisputeSchema = new mongoose.Schema(
  {
    // ── Ownership / Routing ──────────────────────────────────────────────────
    companyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
    companySlug: { type: String, index: true },
    gateway: {
      type:  String,
      enum:  ['razorpay', 'cashfree', 'payu'],   // only gateways with dispute webhooks
      index: true,
    },
    merchantId:  { type: String, index: true },

    // ── Gateway Identifiers ──────────────────────────────────────────────────
    /**
     * disputeId — the gateway's own dispute/chargeback reference.
     * We upsert on (gateway + disputeId) so repeated events update same doc.
     *
     * Razorpay  → dispute.entity.id          e.g. "disp_EsIAlDcoUr8CaQ"
     * Cashfree  → data.dispute.dispute_id     e.g. "433475257"
     * PayU      → cb_id                       e.g. 1761758
     */
    disputeId:  { type: String, required: true },

    /**
     * paymentId — the gateway's txn reference for the ORIGINAL payment.
     * Used to link back to the Transaction document.
     *
     * Razorpay  → dispute.entity.payment_id   "pay_xxx"
     * Cashfree  → data.order_details.cf_payment_id
     * PayU      → (not provided in dispute webhook — linked via orderId)
     */
    paymentId:  { type: String, index: true },

    /**
     * orderId — YOUR order reference (links to Transaction.orderId)
     *
     * Razorpay  → payload.payment.entity.order_id
     * Cashfree  → data.order_details.order_id
     * PayU      → txn_id (your txn ID)
     */
    orderId:    { type: String, index: true },

    // ── Dispute Details ──────────────────────────────────────────────────────
    /**
     * status — normalized across all gateways:
     *   open            → dispute created, awaiting merchant response
     *   under_review    → merchant responded, bank reviewing
     *   action_required → deadline approaching, merchant must respond now
     *   won             → decided in merchant's favour
     *   lost            → decided against merchant, amount deducted
     *   closed          → closed without clear win/loss (withdrawn etc.)
     */
    status: {
      type:  String,
      enum:  ['open', 'under_review', 'action_required', 'won', 'lost', 'closed', 'unknown'],
      default: 'unknown',
      index: true,
    },

    /**
     * phase — stage in the dispute lifecycle:
     *   retrieval       → pre-chargeback info request (bank wants docs)
     *   chargeback      → formal chargeback raised
     *   pre_arbitration → merchant appealing after losing chargeback
     *   arbitration     → final stage, card network decides
     */
    phase: {
      type: String,
      enum: ['retrieval', 'chargeback', 'pre_arbitration', 'arbitration', 'unknown'],
      default: 'unknown',
    },

    // Dispute type (gateway-specific raw value)
    // Razorpay: "chargeback" | Cashfree: "CHARGEBACK" | PayU: "RBI/BO" / "VISA"
    disputeType: { type: String },

    reasonCode:        { type: String },   // e.g. "4855", "processed_invalid_expired_card"
    reasonDescription: { type: String },   // human-readable reason

    // Dispute amount in paise (may differ from original payment amount — partial dispute)
    disputeAmount:   { type: Number },
    currency:        { type: String, default: 'INR' },

    // How much was actually deducted from merchant's account
    amountDeducted:  { type: Number, default: 0 },

    // Deadline by which merchant must respond with evidence
    respondBy: { type: Date, index: true },

    // ── Evidence ─────────────────────────────────────────────────────────────
    /**
     * evidence — merchant's defense documents.
     *
     * For Razorpay: document IDs (doc_xxx) returned by Razorpay file upload API
     * For Cashfree: URLs or document references submitted via Cashfree dispute API
     * For PayU: submitted directly via PayU Dashboard / Chargeback API
     *
     * Platform can store evidence metadata here before forwarding to gateway.
     */
    evidence: { type: EvidenceSchema, default: () => ({}) },

    // Gateway-specific remarks / notes on the dispute
    gatewayRemarks: { type: String },

    // Which party needs to take action right now (Cashfree provides this explicitly)
    actionRequiredBy: {
      type: String,
      enum: ['MERCHANT', 'GATEWAY', 'BANK', null],
      default: null,
    },

    // Raw event type exactly as received from gateway
    eventType: { type: String },

    // Signature verification result
    isVerified: { type: Boolean, default: false },

    // Full raw payload for audit
    rawPayload: { type: mongoose.Schema.Types.Mixed, select: false },

    receivedAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps:  true,
    collection:  'disputes',
  }
);

// ── Unique: one dispute doc per gateway+disputeId (updates come to same doc) ─
DisputeSchema.index({ gateway: 1, disputeId: 1 }, { unique: true });
DisputeSchema.index({ companyId: 1, status: 1, respondBy: 1 });  // urgent disputes
DisputeSchema.index({ companyId: 1, gateway: 1, receivedAt: -1 });
DisputeSchema.index({ orderId: 1, gateway: 1 });

module.exports = mongoose.model('Dispute', DisputeSchema);