/**
 * MerchantConfig
 * ──────────────
 * One document per (company + gateway + merchantId).
 *
 * Callback URL: /webhook/:gateway/:companySlug/:merchantId
 *
 * ── Credentials stored per gateway (all AES-256-GCM encrypted) ──────────────
 *
 * RAZORPAY
 *   webhookSecret  → platform-generated, company pastes in dashboard
 *   keyId          → company's Razorpay Key ID       (rzp_live_xxx)
 *   keySecret      → company's Razorpay Key Secret   (needed for Documents API + Contest API)
 *
 *   Why keyId + keySecret?
 *   The webhookSecret is only for HMAC verification of incoming webhooks.
 *   To UPLOAD evidence files and SUBMIT a dispute contest, you need the API key pair.
 *   Company provides these from: Razorpay Dashboard → Settings → API Keys
 *
 * CASHFREE
 *   clientId       → Cashfree App ID     (CF_APP_xxx) — also the :merchantId in URL
 *   clientSecret   → Cashfree API secret (used for webhook HMAC + Disputes API)
 *
 * PAYU
 *   salt           → PayU salt for reverse-hash verification
 *   (No dispute API — disputes handled via PayU dashboard)
 *
 * PHONEPE
 *   saltKey        → encrypted
 *   saltIndex      → plain (not secret)
 *
 * CCAVENUE
 *   workingKey     → AES-128 key for encResp decryption
 *   accessCode     → access code
 */

const mongoose = require('mongoose');

const CredentialSchema = new mongoose.Schema(
  {
    // Razorpay
    webhookSecret: { type: String },  // platform-generated (AES encrypted)
    keyId:         { type: String },  // rzp_live_xxx (AES encrypted)
    keySecret:     { type: String },  // API key secret (AES encrypted)

    // Cashfree
    clientId:     { type: String },  // CF_APP_xxx (AES encrypted)
    clientSecret: { type: String },  // API secret (AES encrypted)

    // PayU
    salt: { type: String },          // (AES encrypted)

    // PhonePe
    saltKey:   { type: String },     // (AES encrypted)
    saltIndex: { type: String },     // plain — not secret

    // CCAvenue
    workingKey: { type: String },    // (AES encrypted)
    accessCode: { type: String },    // (AES encrypted)
  },
  { _id: false }
);

const MerchantConfigSchema = new mongoose.Schema(
  {
    companyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    companySlug: { type: String, required: true, index: true },

    gateway: {
      type:      String,
      required:  true,
      enum:      ['razorpay', 'cashfree', 'payu', 'phonepe', 'ccavenue'],
      lowercase: true,
    },

    merchantId: { type: String, required: true, trim: true },
    label:      { type: String, trim: true },

    credentials: {
      type:     CredentialSchema,
      required: true,
      select:   false,
    },

    callbackUrl: { type: String },
    isActive:    { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'merchant_configs' }
);

MerchantConfigSchema.index({ companyId: 1, gateway: 1, merchantId: 1 }, { unique: true });
MerchantConfigSchema.index({ gateway: 1, companySlug: 1, merchantId: 1 });

module.exports = mongoose.model('MerchantConfig', MerchantConfigSchema);