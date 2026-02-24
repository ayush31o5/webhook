/**
 * MerchantConfig
 * ──────────────
 * One document per (gateway + merchantId) combination.
 *
 * Credentials stored are ENCRYPTED using AES-256-GCM.
 * The plaintext secret is NEVER written to the DB.
 *
 * Example documents:
 *
 * Razorpay:
 *   gateway: "razorpay"
 *   merchantId: "rzp_live_xxxxx"          ← Razorpay Account ID / key_id
 *   clientId: "client_acme_ltd"           ← your internal client identifier
 *   credentials: {
 *     webhookSecret: "<encrypted>"        ← webhook secret set in Razorpay dashboard
 *   }
 *
 * Cashfree:
 *   gateway: "cashfree"
 *   merchantId: "CF_APPID_xxxxx"          ← x-client-id (App ID)
 *   clientId: "client_xyz"
 *   credentials: {
 *     clientSecret: "<encrypted>"         ← x-client-secret
 *   }
 *
 * PayU:
 *   gateway: "payu"
 *   merchantId: "QyT13U"                  ← key (PayU merchant key)
 *   clientId: "client_pqr"
 *   credentials: {
 *     salt: "<encrypted>"                 ← PayU salt (v2 preferred)
 *   }
 *
 * PhonePe:
 *   gateway: "phonepe"
 *   merchantId: "MERCHANT_ID_HERE"        ← merchantId from PhonePe dashboard
 *   clientId: "client_abc"
 *   credentials: {
 *     saltKey:   "<encrypted>",
 *     saltIndex: "1"                      ← not secret, but stored here for convenience
 *   }
 *
 * CCAvenue:
 *   gateway: "ccavenue"
 *   merchantId: "12345678"                ← numeric merchant_id from CCAvenue dashboard
 *   clientId: "client_def"
 *   credentials: {
 *     workingKey: "<encrypted>",          ← 32-char AES key from CCAvenue
 *     accessCode: "<encrypted>"           ← access code (optional, for initiating payments)
 *   }
 */

const mongoose = require('mongoose');

const CredentialSchema = new mongoose.Schema(
  {
    // All values here are AES-256-GCM encrypted strings (iv:authTag:ciphertext)
    webhookSecret: { type: String },   // Razorpay
    clientSecret:  { type: String },   // Cashfree
    salt:          { type: String },   // PayU
    saltKey:       { type: String },   // PhonePe
    saltIndex:     { type: String },   // PhonePe (not encrypted — not secret)
    workingKey:    { type: String },   // CCAvenue
    accessCode:    { type: String },   // CCAvenue
  },
  { _id: false }
);

const MerchantConfigSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────────────────
    gateway: {
      type:     String,
      required: true,
      enum:     ['razorpay', 'cashfree', 'payu', 'phonepe', 'ccavenue'],
      lowercase: true,
    },

    /**
     * merchantId — the PRIMARY routing key.
     *
     * This must match the :merchantId param in the webhook URL:
     *   POST /webhook/:gateway/:merchantId
     *
     * Use the gateway's own identifier where possible:
     *   Razorpay  → rzp_live_xxx / account ID
     *   Cashfree  → CF App ID
     *   PayU      → key (merchant key)
     *   PhonePe   → MERCHANT_ID from dashboard
     *   CCAvenue  → numeric merchant_id
     */
    merchantId: {
      type:     String,
      required: true,
      trim:     true,
    },

    // ── Your internal client identifier ──────────────────────────────────
    clientId: {
      type:     String,
      required: true,
      trim:     true,
    },

    // ── Encrypted gateway credentials ────────────────────────────────────
    credentials: {
      type:     CredentialSchema,
      required: true,
    },

    isActive: {
      type:    Boolean,
      default: true,
    },

    // Optional: human-readable label e.g. "Acme Ltd – Razorpay Production"
    label: { type: String },
  },
  {
    timestamps: true,
    collection: 'merchant_configs',
  }
);

// Composite unique index: one config per gateway+merchantId combination
MerchantConfigSchema.index({ gateway: 1, merchantId: 1 }, { unique: true });
MerchantConfigSchema.index({ clientId: 1 });

module.exports = mongoose.model('MerchantConfig', MerchantConfigSchema);