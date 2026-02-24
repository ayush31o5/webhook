/**
 * Webhook
 * ───────
 * Single collection for ALL gateway webhook events.
 *
 * Every document has:
 *   1. Routing info   — gateway, merchantId, clientId
 *   2. Universal keys — normalized fields that map across all gateways
 *   3. Raw payload    — original body exactly as received (for auditing / reprocessing)
 *   4. Security info  — whether signature was verified
 */

const mongoose = require('mongoose');

const WebhookSchema = new mongoose.Schema(
  {
    // ── Routing ───────────────────────────────────────────────────────────
    gateway: {
      type:     String,
      required: true,
      enum:     ['razorpay', 'cashfree', 'payu', 'phonepe', 'ccavenue'],
      index:    true,
    },

    /**
     * merchantId — comes from the URL param :merchantId
     * Matches exactly what is stored in MerchantConfig.merchantId
     */
    merchantId: {
      type:     String,
      required: true,
      index:    true,
    },

    // Your internal client identifier (denormalised from MerchantConfig for fast querying)
    clientId: {
      type:  String,
      index: true,
    },

    // ── Universal Normalised Keys ─────────────────────────────────────────
    /**
     * Key mapping across gateways:
     *
     * orderId:
     *   Razorpay  → payload.payment.entity.order_id
     *   Cashfree  → data.order.order_id
     *   PayU      → txnid
     *   PhonePe   → merchantTransactionId  (decoded from base64 response)
     *   CCAvenue  → order_id               (decrypted from encResp)
     *
     * paymentId:
     *   Razorpay  → payload.payment.entity.id
     *   Cashfree  → data.payment.cf_payment_id
     *   PayU      → mihpayid
     *   PhonePe   → transactionId          (PhonePe's own txn ID)
     *   CCAvenue  → tracking_id
     *
     * amount:   always in the smallest currency unit (paise) as a number
     *           PayU sends in rupees → we multiply by 100
     *           PhonePe sends in paise already
     *
     * status:   normalised to: "success" | "failed" | "pending" | "refund"
     *
     * method:   normalised to: "upi" | "card" | "netbanking" | "wallet" | "emi" | "other"
     */

    orderId:       { type: String, index: true },
    paymentId:     { type: String, index: true },
    bankRefNumber: { type: String },

    // Amount in smallest unit (paise / cents)
    amount:   { type: Number },
    currency: { type: String, default: 'INR' },

    status: {
      type: String,
      enum: ['success', 'failed', 'pending', 'refund', 'unknown'],
      default: 'unknown',
      index: true,
    },

    method: {
      type: String,
      enum: ['upi', 'card', 'netbanking', 'wallet', 'emi', 'cash', 'other'],
      default: 'other',
    },

    // Customer info
    customerEmail: { type: String },
    customerPhone: { type: String },
    customerName:  { type: String },

    // Gateway event type as-is
    eventType: { type: String },

    // ── Security ──────────────────────────────────────────────────────────
    isVerified: {
      type:    Boolean,
      default: false,
      index:   true,
    },

    // Signature received (for audit trail, not re-use)
    receivedSignature: { type: String, select: false },

    // ── Raw Payload ───────────────────────────────────────────────────────
    // Stored as Mixed so we keep 100% fidelity of the original body
    rawPayload: {
      type:   mongoose.Schema.Types.Mixed,
      select: false,   // not returned by default — prevents accidental leakage
    },

    // Timestamps (receivedAt = when we got it, not when the payment happened)
    receivedAt: {
      type:    Date,
      default: Date.now,
      index:   true,
    },
  },
  {
    timestamps: true,
    collection: 'webhooks',
  }
);

// Compound indexes for common query patterns
WebhookSchema.index({ gateway: 1, merchantId: 1, receivedAt: -1 });
WebhookSchema.index({ clientId: 1, status: 1, receivedAt: -1 });
WebhookSchema.index({ orderId: 1, gateway: 1 });

module.exports = mongoose.model('Webhook', WebhookSchema);