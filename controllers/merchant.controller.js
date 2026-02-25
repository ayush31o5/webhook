/**
 * Merchant Controller
 * ───────────────────
 *
 * KEY DESIGN DECISION — Who generates the webhook secret?
 * ────────────────────────────────────────────────────────
 *
 * It depends on the gateway:
 *
 * ┌──────────────┬────────────────────────────────────────────────────────┐
 * │ Gateway      │ Who sets the secret & flow                             │
 * ├──────────────┼────────────────────────────────────────────────────────┤
 * │ Razorpay     │ WE generate webhookSecret.                             │
 * │              │ Company pastes it in Razorpay Dashboard when adding   │
 * │              │ the webhook URL. Shown ONCE in our API response.       │
 * ├──────────────┼────────────────────────────────────────────────────────┤
 * │ Cashfree     │ Company provides their API clientSecret from           │
 * │              │ Cashfree Dashboard (Developers → API Keys).            │
 * │              │ Cashfree signs webhooks using this same key.           │
 * ├──────────────┼────────────────────────────────────────────────────────┤
 * │ PayU         │ Company provides their salt from PayU Dashboard.       │
 * │              │ PayU uses this salt in reverse-hash verification.      │
 * ├──────────────┼────────────────────────────────────────────────────────┤
 * │ PhonePe      │ Company provides saltKey + saltIndex from              │
 * │              │ PhonePe Business Dashboard → API Configuration.        │
 * ├──────────────┼────────────────────────────────────────────────────────┤
 * │ CCAvenue     │ Company provides workingKey (+ optional accessCode)    │
 * │              │ from CCAvenue Dashboard → Account → My Profile.        │
 * └──────────────┴────────────────────────────────────────────────────────┘
 *
 * For Razorpay: platformSecret is stored encrypted in MerchantConfig.
 * It is shown ONCE in the POST /api/merchants response.
 * If lost, company must call POST /api/merchants/:id/rotate-secret
 * which generates a new one and requires updating Razorpay dashboard too.
 *
 * Routes:
 *   POST   /api/merchants                       Add merchant → get callbackUrl
 *   GET    /api/merchants                       List all merchants
 *   GET    /api/merchants/:id                   Get single merchant
 *   DELETE /api/merchants/:id                   Deactivate
 *   POST   /api/merchants/:id/rotate-secret     Regenerate Razorpay webhook secret
 */

const crypto         = require('crypto');
const MerchantConfig = require('../models/MerchantConfig');
const { encrypt }    = require('../config/encryption');

const BASE_URL = process.env.BASE_URL || 'https://yourplatform.com';

// ── Gateway config: what company must provide vs what we generate ──────────

const GATEWAY_CONFIG = {
  razorpay: {
    // We generate the webhookSecret — company pastes it in Razorpay dashboard
    companyMustProvide: [],
    weGenerate:         ['webhookSecret'],
    plainFields:        [],
    note: 'We generate the webhook secret for you. Paste it in Razorpay Dashboard → Settings → Webhooks when adding the webhook URL.',
  },
  cashfree: {
    // clientSecret comes from Cashfree API Keys — company must provide
    companyMustProvide: ['clientSecret'],
    weGenerate:         [],
    plainFields:        [],
    note: 'Provide your Cashfree API clientSecret from Cashfree Dashboard → Developers → API Keys.',
  },
  payu: {
    // salt comes from PayU dashboard — company must provide
    companyMustProvide: ['salt'],
    weGenerate:         [],
    plainFields:        [],
    note: 'Provide your PayU salt from PayU Dashboard → Settings.',
  },
  phonepe: {
    // saltKey + saltIndex from PhonePe Business Dashboard
    companyMustProvide: ['saltKey', 'saltIndex'],
    weGenerate:         [],
    plainFields:        ['saltIndex'],   // saltIndex is not secret
    note: 'Provide your saltKey and saltIndex from PhonePe Business Dashboard → API Configuration.',
  },
  ccavenue: {
    // workingKey from CCAvenue dashboard
    companyMustProvide: ['workingKey'],
    weGenerate:         [],
    plainFields:        [],
    note: 'Provide your Working Key from CCAvenue Dashboard → Account → My Profile.',
  },
};

// ── Generate a platform webhook secret (for Razorpay) ─────────────────────
function generateWebhookSecret() {
  // 32 bytes = 64 hex chars — strong enough for HMAC-SHA256
  return crypto.randomBytes(32).toString('hex');
}

// ── POST /api/merchants ────────────────────────────────────────────────────
const addMerchant = async (req, res) => {
  const company = req.company;
  const { gateway, merchantId, label, credentials = {} } = req.body;

  if (!gateway || !merchantId) {
    return res.status(400).json({ error: 'gateway and merchantId are required' });
  }

  const gw = gateway.toLowerCase();
  const gwConfig = GATEWAY_CONFIG[gw];

  if (!gwConfig) {
    return res.status(400).json({
      error: `Invalid gateway. Must be one of: ${Object.keys(GATEWAY_CONFIG).join(', ')}`,
    });
  }

  // ── Validate company-provided credentials ─────────────────────────────
  const missing = gwConfig.companyMustProvide.filter((k) => !credentials[k]);
  if (missing.length > 0) {
    return res.status(400).json({
      error:    `Missing required credentials for ${gw}: ${missing.join(', ')}`,
      required: gwConfig.companyMustProvide,
      note:     gwConfig.note,
    });
  }

  // ── Check duplicate ───────────────────────────────────────────────────
  const exists = await MerchantConfig.findOne({
    companyId: company._id,
    gateway:   gw,
    merchantId,
  });
  if (exists) {
    return res.status(409).json({
      error:               `Merchant "${merchantId}" for ${gw} already registered`,
      existingCallbackUrl: exists.callbackUrl,
    });
  }

  // ── Build credentials to store ────────────────────────────────────────
  const encryptedCredentials = {};

  // 1. Company-provided fields → encrypt (unless in plainFields)
  for (const key of gwConfig.companyMustProvide) {
    const value = credentials[key];
    if (!value) continue;
    encryptedCredentials[key] = gwConfig.plainFields.includes(key)
      ? String(value)
      : encrypt(String(value));
  }

  // 2. Platform-generated fields → generate + encrypt + return to company once
  const generatedSecrets = {};
  for (const key of gwConfig.weGenerate) {
    const plaintext = generateWebhookSecret();
    encryptedCredentials[key] = encrypt(plaintext);
    generatedSecrets[key]     = plaintext;   // returned ONCE in response
  }

  // ── Build callback URL ─────────────────────────────────────────────────
  const callbackUrl = `${BASE_URL}/webhook/${gw}/${company.slug}/${merchantId}`;

  // ── Save ───────────────────────────────────────────────────────────────
  const config = await MerchantConfig.create({
    companyId:   company._id,
    companySlug: company.slug,
    gateway:     gw,
    merchantId,
    label:       label || `${gw} — ${merchantId}`,
    credentials: encryptedCredentials,
    callbackUrl,
  });

  // ── Build response ─────────────────────────────────────────────────────
  const response = {
    merchant: {
      id:          config._id,
      gateway:     config.gateway,
      merchantId:  config.merchantId,
      label:       config.label,
      callbackUrl: config.callbackUrl,
      isActive:    config.isActive,
      createdAt:   config.createdAt,
    },
    setup: getSetupInstructions(gw, callbackUrl, generatedSecrets),
  };

  // If we generated secrets, highlight them clearly
  if (Object.keys(generatedSecrets).length > 0) {
    response.generatedSecrets = generatedSecrets;
    response.warning = '⚠️  Save these secrets now — they will NOT be shown again. If lost, use /rotate-secret to regenerate (requires updating your gateway dashboard too).';
  }

  return res.status(201).json(response);
};

// ── POST /api/merchants/:id/rotate-secret ─────────────────────────────────
// Only applicable for Razorpay (where we own the secret)
const rotateSecret = async (req, res) => {
  const config = await MerchantConfig
    .findOne({ _id: req.params.id, companyId: req.company._id })
    .select('+credentials');

  if (!config) return res.status(404).json({ error: 'Merchant config not found' });

  const gwConfig = GATEWAY_CONFIG[config.gateway];
  if (!gwConfig.weGenerate.length) {
    return res.status(400).json({
      error: `Secret rotation is only for platform-generated secrets (Razorpay). For ${config.gateway}, update your credentials via the gateway dashboard.`,
    });
  }

  const generatedSecrets = {};
  for (const key of gwConfig.weGenerate) {
    const plaintext = generateWebhookSecret();
    config.credentials[key] = encrypt(plaintext);
    generatedSecrets[key]   = plaintext;
  }

  config.markModified('credentials');
  await config.save();

  return res.json({
    message:          'Secret rotated. Update your gateway dashboard immediately.',
    generatedSecrets,
    warning:          '⚠️  Update your Razorpay webhook secret NOW — old webhooks will fail until you do.',
    callbackUrl:      config.callbackUrl,
  });
};

// ── GET /api/merchants ─────────────────────────────────────────────────────
const listMerchants = async (req, res) => {
  const { gateway, isActive } = req.query;
  const filter = { companyId: req.company._id };
  if (gateway)            filter.gateway  = gateway.toLowerCase();
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const merchants = await MerchantConfig
    .find(filter)
    .select('-credentials')
    .sort({ createdAt: -1 })
    .lean();

  return res.json({ count: merchants.length, merchants });
};

// ── GET /api/merchants/:id ─────────────────────────────────────────────────
const getMerchant = async (req, res) => {
  const config = await MerchantConfig
    .findOne({ _id: req.params.id, companyId: req.company._id })
    .select('-credentials')
    .lean();

  if (!config) return res.status(404).json({ error: 'Merchant config not found' });

  return res.json({
    ...config,
    setup: getSetupInstructions(config.gateway, config.callbackUrl, {}),
  });
};

// ── DELETE /api/merchants/:id ──────────────────────────────────────────────
const deactivateMerchant = async (req, res) => {
  const config = await MerchantConfig.findOneAndUpdate(
    { _id: req.params.id, companyId: req.company._id },
    { isActive: false },
    { new: true }
  ).select('-credentials');

  if (!config) return res.status(404).json({ error: 'Merchant config not found' });
  return res.json({ message: 'Merchant deactivated', merchantId: config.merchantId });
};

// ── Setup instructions per gateway ────────────────────────────────────────
function getSetupInstructions(gateway, callbackUrl, generatedSecrets) {
  const map = {
    razorpay: {
      step1: `Go to: Razorpay Dashboard → Settings → Webhooks → Add New Webhook`,
      step2: `Webhook URL: ${callbackUrl}`,
      step3: generatedSecrets.webhookSecret
        ? `Webhook Secret: ${generatedSecrets.webhookSecret}  ← paste this exactly`
        : `Webhook Secret: [use the webhookSecret from when you registered]`,
      step4: `Enable events: payment.captured, payment.failed, refund.created`,
    },
    cashfree: {
      step1: `Go to: Cashfree Dashboard → Developers → Webhooks`,
      step2: `Webhook URL: ${callbackUrl}`,
      step3: `Enable events: PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK, REFUND_STATUS_WEBHOOK`,
      note:  `Cashfree signs webhooks with your API clientSecret (already saved).`,
    },
    payu: {
      step1: `Go to: PayU Dashboard → Developer → Webhook URL`,
      step2: `Set Webhook URL: ${callbackUrl}`,
      note:  `PayU uses your salt for hash verification. Ensure it matches your dashboard.`,
    },
    phonepe: {
      step1: `Go to: PhonePe Business Dashboard → API Configuration`,
      step2: `Callback URL: ${callbackUrl}`,
      note:  `PhonePe sends base64-encoded response. Verification uses your saltKey.`,
    },
    ccavenue: {
      step1: `Go to: CCAvenue Dashboard → Account → My Profile → Notify URL`,
      step2: `Notify URL: ${callbackUrl}`,
      note:  `CCAvenue encrypts the entire response with your Working Key. No separate signature.`,
    },
  };
  return map[gateway] || {};
}

module.exports = {
  addMerchant,
  listMerchants,
  getMerchant,
  deactivateMerchant,
  rotateSecret,
};