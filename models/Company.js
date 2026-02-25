/**
 * Company
 * ───────
 * A "Company" is any business that registers on your platform.
 * They get:
 *   - A unique slug  (used in their webhook URLs)
 *   - A platform API key (to call your management APIs)
 *
 * One Company can have MANY MerchantConfigs across any gateway.
 *
 * Example:
 *   Acme Ltd → slug: "acme-ltd"
 *   Their Razorpay webhook URL: /webhook/razorpay/acme-ltd/rzp_live_xxx
 *   Their Cashfree webhook URL: /webhook/cashfree/acme-ltd/CF_APP_xxx
 */

const mongoose = require('mongoose');
const crypto   = require('crypto');

const CompanySchema = new mongoose.Schema(
  {
    // ── Identity ──────────────────────────────────────────────────────────
    name: {
      type:     String,
      required: true,
      trim:     true,
    },

    /**
     * slug — used in webhook URLs
     * Auto-generated from name if not provided.
     * e.g. "Acme Ltd" → "acme-ltd"
     * Must be URL-safe: lowercase letters, numbers, hyphens only.
     */
    slug: {
      type:      String,
      required:  true,
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     /^[a-z0-9-]+$/,
    },

    email: {
      type:     String,
      required: true,
      unique:   true,
      trim:     true,
      lowercase: true,
    },

    // ── Platform API Key ──────────────────────────────────────────────────
    /**
     * apiKey — used by the company to call your management REST API.
     * Format: pk_live_<32 random hex chars>
     * Stored as SHA-256 hash. The plaintext is shown ONCE on creation.
     *
     * WHY HASH? If your DB leaks, no one can use stale API keys.
     */
    apiKeyHash: {
      type:   String,
      select: false,   // never returned by default
    },

    // Key prefix stored in plain (for "which key is this?" identification)
    apiKeyPrefix: {
      type: String,    // e.g. "pk_live_a3f8"
    },

    isActive: {
      type:    Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'companies',
  }
);

// ── Static helpers ─────────────────────────────────────────────────────────

/**
 * Generate a new API key.
 * Returns { plaintext, hash, prefix }
 * Store hash+prefix in DB. Show plaintext to user ONCE.
 */
CompanySchema.statics.generateApiKey = function () {
  const raw       = crypto.randomBytes(32).toString('hex');
  const plaintext = `pk_live_${raw}`;
  const hash      = crypto.createHash('sha256').update(plaintext).digest('hex');
  const prefix    = plaintext.slice(0, 16);   // "pk_live_" + first 8 chars
  return { plaintext, hash, prefix };
};

/**
 * Generate a URL-safe slug from company name.
 * "Acme Ltd India" → "acme-ltd-india"
 */
CompanySchema.statics.slugify = function (name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
};

/**
 * Find a company by plaintext API key.
 * Hashes the key and looks up apiKeyHash.
 */
CompanySchema.statics.findByApiKey = async function (plaintext) {
  const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
  return this.findOne({ apiKeyHash: hash, isActive: true }).select('+apiKeyHash');
};

module.exports = mongoose.model('Company', CompanySchema);