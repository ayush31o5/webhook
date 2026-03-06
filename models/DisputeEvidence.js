/**
 * DisputeEvidence
 * ───────────────
 * One document per uploaded file for a dispute.
 * Tracks the full lifecycle: uploaded to us → uploaded to gateway → submitted.
 *
 * ── Per-gateway file upload flow ──────────────────────────────────────────
 *
 * RAZORPAY
 *   Step 1: POST https://api.razorpay.com/v1/documents
 *           multipart/form-data { file: <binary>, purpose: "dispute_evidence" }
 *           → Response: { id: "doc_EsyWjHrfzb59Re", mime_type, size, created_at }
 *
 *   Step 2: PATCH https://api.razorpay.com/v1/disputes/:disputeId/contest
 *           { action: "submit", summary: "...", shipping_proof: ["doc_xxx", "doc_yyy"], ... }
 *
 *   Accepted formats: image/jpeg, image/png, application/pdf
 *   Max size: 10MB per file
 *   Evidence fields: shipping_proof | billing_proof | cancellation_proof |
 *                    customer_communication | proof_of_service | explanation_letter |
 *                    refund_confirmation | access_activity_log |
 *                    refund_cancellation_policy | term_and_conditions | others
 *
 * CASHFREE
 *   Step 1: POST https://api.cashfree.com/pg/disputes/:disputeId/documents
 *           multipart/form-data { file: <binary>, document_type: "DeliveryProof" }
 *           → Response: { document_id: 18150, document_name, document_type }
 *
 *   Step 2: POST https://api.cashfree.com/pg/disputes/:disputeId/submit
 *           (no body needed — submits all attached documents)
 *
 *   Accepted document_type values:
 *     DeliveryProof | BillingProof | CancellationProof | CustomerCommunication |
 *     ProofOfService | ExplanationLetter | RefundConfirmation |
 *     AccessActivityLog | RefundCancellationPolicy | TermsAndConditions
 *   Accepted formats: image/jpeg, image/png, application/pdf
 *   Max size: 5MB per file
 *
 * PAYU
 *   No programmatic API for evidence submission.
 *   Files stored in our DB only.
 *   Merchant must submit via PayU Dashboard → Chargeback section manually.
 *   We store files and provide a download link + instructions.
 *
 * PHONEPE / CCAVENUE
 *   No dispute webhooks, no dispute API.
 *   Out of scope for this system.
 */

const mongoose = require('mongoose');

// Evidence type → maps to the correct field in Razorpay / Cashfree
const EVIDENCE_TYPES = [
  'shipping_proof',            // Proof of delivery / shipment tracking
  'billing_proof',             // Invoice / order confirmation / receipt
  'cancellation_proof',        // Cancellation policy / confirmation of cancellation
  'customer_communication',    // Email/chat showing customer acknowledged receipt
  'proof_of_service',          // Screenshot / log showing service was rendered
  'explanation_letter',        // Written explanation of why dispute is invalid
  'refund_confirmation',        // Proof refund was already processed
  'access_activity_log',       // Server logs / login activity (digital goods)
  'refund_cancellation_policy',// Published refund/cancellation policy
  'term_and_conditions',       // Terms & conditions accepted by customer
  'others',                    // Anything else
];

const DisputeEvidenceSchema = new mongoose.Schema(
  {
    // ── Ownership ──────────────────────────────────────────────────────────
    companyId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    disputeId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Dispute', required: true, index: true },

    // Gateway's own dispute identifier (e.g. "disp_xxx" for Razorpay)
    gatewayDisputeId: { type: String, required: true },
    gateway:          { type: String, enum: ['razorpay', 'cashfree', 'payu'], required: true },
    merchantId:       { type: String, required: true },

    // ── File info ──────────────────────────────────────────────────────────
    /**
     * evidenceType — what kind of proof this document is.
     * Maps directly to Razorpay evidence object field names.
     * For Cashfree, we map to their document_type values before uploading.
     */
    evidenceType: {
      type:     String,
      enum:     EVIDENCE_TYPES,
      required: true,
    },

    originalName: { type: String, required: true },  // original filename from upload
    mimeType: {
      type:  String,
      enum:  ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'],
      required: true,
    },
    sizeBytes: { type: Number },

    // ── Storage ────────────────────────────────────────────────────────────
    // Local path on disk (before gateway upload, or for PayU where we keep it)
    localPath: { type: String, select: false },  // internal — never returned in API

    // S3 / cloud storage URL (if configured)
    storageUrl: { type: String },

    // ── Gateway upload status ──────────────────────────────────────────────
    /**
     * gatewayDocId — the document ID returned by the gateway after upload.
     *
     * Razorpay : "doc_EsyWjHrfzb59Re"   (from POST /v1/documents)
     * Cashfree  : "18150"                (from POST /pg/disputes/:id/documents)
     * PayU      : null                   (no API — store locally only)
     */
    gatewayDocId: { type: String, default: null },

    /**
     * uploadStatus — lifecycle of this evidence file:
     *   pending        → uploaded to our server, not yet sent to gateway
     *   gateway_uploaded → successfully uploaded to gateway, has gatewayDocId
     *   gateway_failed → upload to gateway failed (see uploadError)
     *   submitted      → included in a contest/submit call to the gateway
     */
    uploadStatus: {
      type:    String,
      enum:    ['pending', 'gateway_uploaded', 'gateway_failed', 'submitted'],
      default: 'pending',
      index:   true,
    },

    uploadError: { type: String, default: null },  // error message if gateway_failed

    // When this file was submitted to the gateway as part of a contest
    submittedAt: { type: Date, default: null },

    // Optional text note about this specific file
    note: { type: String, maxlength: 500 },
  },
  {
    timestamps:  true,
    collection:  'dispute_evidences',
  }
);

DisputeEvidenceSchema.index({ disputeId: 1, uploadStatus: 1 });
DisputeEvidenceSchema.index({ gatewayDisputeId: 1, gateway: 1 });

// Cashfree uses different field name for evidence type
DisputeEvidenceSchema.statics.toCashfreeDocType = function (evidenceType) {
  const map = {
    shipping_proof:             'DeliveryProof',
    billing_proof:              'BillingProof',
    cancellation_proof:         'CancellationProof',
    customer_communication:     'CustomerCommunication',
    proof_of_service:           'ProofOfService',
    explanation_letter:         'ExplanationLetter',
    refund_confirmation:        'RefundConfirmation',
    access_activity_log:        'AccessActivityLog',
    refund_cancellation_policy: 'RefundCancellationPolicy',
    term_and_conditions:        'TermsAndConditions',
    others:                     'Others',
  };
  return map[evidenceType] || 'Others';
};

module.exports = mongoose.model('DisputeEvidence', DisputeEvidenceSchema);
module.exports.EVIDENCE_TYPES = EVIDENCE_TYPES;