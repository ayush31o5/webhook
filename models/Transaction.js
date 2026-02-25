/**
 * Transaction
 * ───────────
 * One document per payment event received via webhook.
 * This is the "business data" — normalized across all gateways.
 *
 * ── What each gateway gives us ──────────────────────────────────────────
 *
 * RAZORPAY
 *   event types  : payment.captured, payment.failed, payment.authorized,
 *                  refund.created, order.paid, payment.dispute.created
 *   orderId      : payload.payment.entity.order_id
 *   paymentId    : payload.payment.entity.id          (pay_xxx)
 *   amount       : payload.payment.entity.amount      (paise — already)
 *   status       : payload.payment.entity.status      → captured/failed/refunded
 *   method       : payload.payment.entity.method      → upi/card/netbanking/wallet/emi
 *   vpa          : payload.payment.entity.vpa         (UPI VPA if method=upi)
 *   bank         : payload.payment.entity.bank        (bank code for netbanking)
 *   card network : payload.payment.entity.card.network (Visa/Mastercard etc)
 *   email        : payload.payment.entity.email
 *   contact      : payload.payment.entity.contact
 *
 * CASHFREE
 *   event types  : PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK,
 *                  PAYMENT_USER_DROPPED_WEBHOOK, REFUND_STATUS_WEBHOOK
 *   orderId      : data.order.order_id
 *   paymentId    : data.payment.cf_payment_id
 *   amount       : data.payment.payment_amount        (rupees → ×100 for paise)
 *   status       : data.payment.payment_status        → SUCCESS/FAILED/PENDING
 *   method       : data.payment.payment_method.*      → upi/card/netbanking
 *   upiId        : data.payment.payment_method.upi.upi_id
 *   bankName     : data.payment.payment_method.netbanking.channel
 *   email        : data.customer_details.customer_email
 *   phone        : data.customer_details.customer_phone
 *
 * PAYU
 *   (form-urlencoded POST)
 *   orderId      : txnid                              (your txn ID)
 *   paymentId    : mihpayid                           (PayU's txn ID)
 *   amount       : amount                             (rupees string → ×100)
 *   status       : status                             → success/failure/pending
 *   method       : mode                               → UPI/CC/DC/NB/CASH/EMI
 *   bankCode     : bank_code
 *   bankRefNum   : bank_ref_num
 *   cardType     : card_type                          (visa/mastercard etc)
 *   upiVar       : udf1..udf5 (custom — varies per integration)
 *   email        : email
 *   phone        : phone
 *
 * PHONEPE
 *   (base64-encoded JSON body in `response` field)
 *   orderId      : data.merchantTransactionId         (your txn ID)
 *   paymentId    : data.transactionId                 (PhonePe's txn ID)
 *   amount       : data.amount                        (paise — already)
 *   status       : data.state                         → COMPLETED/FAILED/PENDING
 *   method       : data.paymentInstrument.type        → UPI_INTENT/UPI_COLLECT/CARD/NETBANKING
 *   utr          : data.paymentInstrument.utr         (UPI ref number)
 *   bankId       : data.paymentInstrument.bankId      (for netbanking)
 *
 * CCAVENUE
 *   (AES-128-CBC encrypted encResp, decrypts to query string)
 *   orderId      : order_id
 *   paymentId    : tracking_id                        (CCAvenue's ref)
 *   amount       : amount                             (rupees string → ×100)
 *   status       : order_status                       → Success/Failure/Aborted/Invalid
 *   method       : payment_mode                       → Net Banking/Credit Card/UPI/Wallet
 *   bankRefNo    : bank_ref_no
 *   cardName     : card_name
 *   failReason   : failure_message
 *   billingName  : billing_name
 *   billingEmail : billing_email
 *   billingTel   : billing_tel
 */

const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema(
  {
    // ── Routing / Ownership ────────────────────────────────────────────────
    companyId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   'Company',
      index: true,
    },

    companySlug: { type: String, index: true },

    gateway: {
      type:  String,
      enum:  ['razorpay', 'cashfree', 'payu', 'phonepe', 'ccavenue'],
      index: true,
    },

    // The gateway's own identifier for this merchant account
    merchantId: { type: String, index: true },

    // ── Universal Keys ─────────────────────────────────────────────────────
    /**
     * orderId — YOUR order ID (the one you created before the payment).
     *           This is what you use to reconcile with your own DB.
     */
    orderId: { type: String, index: true },

    /**
     * paymentId — The gateway's own transaction reference.
     *             Use this when raising a dispute or refund with the gateway.
     */
    paymentId: { type: String, index: true },

    bankRefNumber: { type: String },

    // Amount always stored in PAISE (smallest unit) as an integer
    amount:   { type: Number },
    currency: { type: String, default: 'INR' },

    status: {
      type:  String,
      enum:  ['success', 'failed', 'pending', 'refund', 'disputed', 'unknown'],
      index: true,
    },

    method: {
      type:  String,
      enum:  ['upi', 'card', 'netbanking', 'wallet', 'emi', 'cash', 'other'],
    },

    // ── Method-specific Details ────────────────────────────────────────────
    upi: {
      vpa:     { type: String },   // UPI VPA / UPI ID  e.g. user@ybl
      utr:     { type: String },   // Bank UTR reference
    },

    card: {
      network: { type: String },   // Visa / Mastercard / RuPay / Amex
      last4:   { type: String },   // last 4 digits (Razorpay provides this)
      type:    { type: String },   // credit / debit
      bank:    { type: String },   // issuing bank
    },

    netbanking: {
      bank:     { type: String },  // bank name / code
      bankCode: { type: String },
    },

    wallet: {
      name: { type: String },      // Paytm / PhonePe wallet / Amazon Pay etc
    },

    // ── Customer ───────────────────────────────────────────────────────────
    customer: {
      name:  { type: String },
      email: { type: String },
      phone: { type: String },
    },

    // ── Gateway Event ──────────────────────────────────────────────────────
    eventType: { type: String },   // e.g. "payment.captured", "PAYMENT_SUCCESS_WEBHOOK"

    // Error / failure reason (if status=failed)
    failureReason: { type: String },

    // ── Webhook integrity ──────────────────────────────────────────────────
    isVerified: { type: Boolean, default: false },

    // ── Raw payload (full fidelity, for audit / reprocessing) ─────────────
    rawPayload: {
      type:   mongoose.Schema.Types.Mixed,
      select: false,   // not returned by default
    },

    receivedAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps:  true,
    collection:  'transactions',
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────
TransactionSchema.index({ companyId: 1, status: 1, receivedAt: -1 });
TransactionSchema.index({ gateway: 1, merchantId: 1, receivedAt: -1 });
TransactionSchema.index({ orderId: 1, gateway: 1 });
TransactionSchema.index({ companySlug: 1, receivedAt: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);