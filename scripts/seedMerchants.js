/**
 * scripts/seedMerchants.js
 * ─────────────────────────
 * Helper script to add MerchantConfig documents with encrypted credentials.
 *
 * Usage:
 *   node scripts/seedMerchants.js
 *
 * This script shows HOW to onboard a new merchant/MID.
 * In production, this would be called from an admin API, not run manually.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const connectDB       = require('../config/db');
const MerchantConfig  = require('../models/MerchantConfig');
const { encrypt }     = require('../config/encryption');

// ─── Sample merchants to seed ─────────────────────────────────────────────────
// Replace these with real values. The encrypt() call will AES-256-GCM encrypt
// the secret before it touches the DB. The ENCRYPTION_KEY env var is the master key.

const merchants = [
  // ── Client A — Razorpay (MID 1) ────────────────────────────────────────
  {
    gateway:    'razorpay',
    merchantId: 'rzp_live_abc123',           // Razorpay Key ID / Account ID
    clientId:   'client_acme_ltd',
    label:      'Acme Ltd – Razorpay Production',
    credentials: {
      webhookSecret: encrypt('your_razorpay_webhook_secret_here'),
    },
  },

  // ── Client A — Razorpay (MID 2 — second Razorpay account) ──────────────
  {
    gateway:    'razorpay',
    merchantId: 'rzp_live_xyz789',
    clientId:   'client_acme_ltd',
    label:      'Acme Ltd – Razorpay Secondary',
    credentials: {
      webhookSecret: encrypt('second_razorpay_webhook_secret_here'),
    },
  },

  // ── Client A — Cashfree ─────────────────────────────────────────────────
  {
    gateway:    'cashfree',
    merchantId: 'CF_APP_123456',             // x-client-id (App ID)
    clientId:   'client_acme_ltd',
    label:      'Acme Ltd – Cashfree Production',
    credentials: {
      clientSecret: encrypt('your_cashfree_client_secret_here'),
    },
  },

  // ── Client B — PayU ─────────────────────────────────────────────────────
  {
    gateway:    'payu',
    merchantId: 'QyT13U',                    // PayU merchant key
    clientId:   'client_globemart',
    label:      'GlobeMart – PayU Production',
    credentials: {
      salt: encrypt('your_payu_salt_here'),
    },
  },

  // ── Client B — PhonePe ──────────────────────────────────────────────────
  {
    gateway:    'phonepe',
    merchantId: 'GLOBEMART_PROD',            // PhonePe merchantId from dashboard
    clientId:   'client_globemart',
    label:      'GlobeMart – PhonePe Production',
    credentials: {
      saltKey:   encrypt('your_phonepe_salt_key_here'),
      saltIndex: '1',    // Not secret — stored as-is
    },
  },

  // ── Client C — CCAvenue ─────────────────────────────────────────────────
  {
    gateway:    'ccavenue',
    merchantId: '12345678',                  // numeric merchant_id from CCAvenue dashboard
    clientId:   'client_shopnow',
    label:      'ShopNow – CCAvenue Production',
    credentials: {
      workingKey: encrypt('your_32char_ccavenue_working_key'),
      accessCode: encrypt('your_ccavenue_access_code'),
    },
  },
];

// ─── Run ──────────────────────────────────────────────────────────────────────
(async () => {
  await connectDB();

  for (const merchant of merchants) {
    try {
      await MerchantConfig.findOneAndUpdate(
        { gateway: merchant.gateway, merchantId: merchant.merchantId },
        merchant,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log(`✅ Upserted: ${merchant.gateway}/${merchant.merchantId} → ${merchant.clientId}`);
    } catch (err) {
      console.error(`❌ Failed: ${merchant.gateway}/${merchant.merchantId}:`, err.message);
    }
  }

  console.log('\nDone. Credentials are AES-256-GCM encrypted in MongoDB.');
  process.exit(0);
})();