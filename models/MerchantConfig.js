/**
 * MerchantConfig
 * ──────────────
 * One document per (company + gateway + merchantId) combination.
 *
 * Callback URL format:
 *   https://yourplatform.com/webhook/:gateway/:companySlug/:merchantId
 *
 * Examples:
 *   /webhook/razorpay/acme-ltd/rzp_live_abc123
 *   /webhook/cashfree/acme-ltd/CF_APP_456
 *   /webhook/payu/globemart/QyT13U
 *
 * Per-gateway merchantId:
 *   Razorpay  → Key ID           e.g. rzp_live_abc123
 *   Cashfree  → App ID           e.g. CF_APP_123456
 *   PayU      → Merchant Key     e.g. QyT13U
 *   PhonePe   → Merchant ID      e.g. MERCHANTID_PROD
 *   CCAvenue  → Merchant ID      e.g. 12345678 (numeric)
 *
 * Credentials stored (AES-256-GCM encrypted):
 *   Razorpay  → webhookSecret
 *   Cashfree  → clientSecret
 *   PayU      → salt
 *   PhonePe   → saltKey  (saltIndex not encrypted)
 *   CCAvenue  → workingKey, accessCode
 */

const mongoose = require('mongoose');

const CredentialSchema = new mongoose.Schema(
  {
    webhookSecret: { type: String },  // Razorpay
    clientSecret:  { type: String },  // Cashfree
    salt:          { type: String },  // PayU
    saltKey:       { type: String },  // PhonePe (encrypted)
    saltIndex:     { type: String },  // PhonePe (plain — not secret)
    workingKey:    { type: String },  // CCAvenue (encrypted)
    accessCode:    { type: String },  // CCAvenue (encrypted)
  },
  { _id: false }
);

const MerchantConfigSchema = new mongoose.Schema(
  {
    // ── Ownership ──────────────────────────────────────────────────────
    companyId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Company',
      required: true,
      index:    true,
    },

    // Denormalized — avoids DB join on every webhook hit
    companySlug: {
      type:     String,
      required: true,
      index:    true,
    },

    // ── Gateway ────────────────────────────────────────────────────────
    gateway: {
      type:      String,
      required:  true,
      enum:      ['razorpay', 'cashfree', 'payu', 'phonepe', 'ccavenue'],
      lowercase: true,
    },

    // Gateway's own identifier for this merchant account (3rd URL segment)
    merchantId: {
      type:     String,
      required: true,
      trim:     true,
    },

    // Human label e.g. "Razorpay Production Account 1"
    label: { type: String, trim: true },

    // ── Credentials (all encrypted AES-256-GCM) ───────────────────────
    credentials: {
      type:     CredentialSchema,
      required: true,
      select:   false,   // never returned in API responses by default
    },

    // ── Generated Callback URL ─────────────────────────────────────────
    // Company pastes this into their gateway dashboard
    // e.g. https://hooks.yourplatform.com/webhook/razorpay/acme-ltd/rzp_live_abc123
    callbackUrl: { type: String },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps:  true,
    collection:  'merchant_configs',
  }
);

// One config per company+gateway+merchantId
MerchantConfigSchema.index(
  { companyId: 1, gateway: 1, merchantId: 1 },
  { unique: true }
);

// Fast routing lookup on every incoming webhook
MerchantConfigSchema.index({ gateway: 1, companySlug: 1, merchantId: 1 });

module.exports = mongoose.model('MerchantConfig', MerchantConfigSchema);