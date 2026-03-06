/**
 * Merchant Controller
 * ───────────────────
 * Manages gateway merchant configs per company.
 *
 * ── Secret ownership ────────────────────────────────────────────────────────
 *
 *  Razorpay
 *    WE generate webhookSecret → shown once → company pastes in Razorpay dashboard
 *    Company MUST provide keyId + keySecret (from Razorpay Dashboard → API Keys)
 *    These are needed to upload evidence files & submit dispute contests.
 *
 *  Cashfree
 *    Company provides clientSecret (Cashfree Dashboard → Developers → API Keys)
 *    Same secret used for webhook HMAC verification AND dispute evidence API.
 *    clientId = their merchantId (CF_APP_xxx)
 *
 *  PayU
 *    Company provides salt (from PayU Dashboard)
 *    No dispute API — evidence managed via PayU dashboard manually.
 *
 *  PhonePe
 *    Company provides saltKey + saltIndex
 *    No dispute webhook support.
 *
 *  CCAvenue
 *    Company provides workingKey + accessCode
 *    No dispute webhook support.
 *
 * Routes:
 *   POST   /api/merchants                     → Add merchant → callbackUrl
 *   GET    /api/merchants                     → List all
 *   GET    /api/merchants/:id                 → Get one
 *   DELETE /api/merchants/:id                 → Deactivate
 *   POST   /api/merchants/:id/rotate-secret   → Razorpay: regen webhookSecret
 */

const crypto         = require('crypto');
const MerchantConfig = require('../models/MerchantConfig');
const { encrypt }    = require('../config/encryption');

const BASE_URL = process.env.BASE_URL || 'https://yourplatform.com';

// ── What each gateway needs ──────────────────────────────────────────────────

const GATEWAY_CONFIG = {
  razorpay: {
    // webhookSecret is platform-generated
    companyMustProvide: ['keyId', 'keySecret'],
    weGenerate:         ['webhookSecret'],
    plainFields:        [],
    credentialDocs: {
      keyId:     'Razorpay Dashboard → Settings → API Keys → Key ID (rzp_live_xxx)',
      keySecret: 'Razorpay Dashboard → Settings → API Keys → Key Secret (revealed once)',
    },
    note: 'keyId and keySecret are needed to upload dispute evidence files and submit contests to Razorpay.',
  },
  cashfree: {
    companyMustProvide: ['clientSecret'],
    weGenerate:         [],
    plainFields:        [],
    credentialDocs: {
      clientSecret: 'Cashfree Dashboard → Developers → API Keys → Client Secret',
    },
    note: 'clientSecret is used for both webhook verification and dispute evidence submission.',
  },
  payu: {
    companyMustProvide: ['salt'],
    weGenerate:         [],
    plainFields:        [],
    credentialDocs: {
      salt: 'PayU Dashboard → Settings → Salt',
    },
    note: 'PayU does not have a dispute evidence API. Files must be submitted via PayU Dashboard manually.',
  },
  phonepe: {
    companyMustProvide: ['saltKey', 'saltIndex'],
    weGenerate:         [],
    plainFields:        ['saltIndex'],
    credentialDocs: {
      saltKey:   'PhonePe Business Dashboard → API Configuration → Salt Key',
      saltIndex: 'PhonePe Business Dashboard → API Configuration → Salt Index (usually 1)',
    },
    note: 'PhonePe does not support dispute webhooks.',
  },
  ccavenue: {
    companyMustProvide: ['workingKey', 'accessCode'],
    weGenerate:         [],
    plainFields:        [],
    credentialDocs: {
      workingKey: 'CCAvenue Dashboard → Account → My Profile → Working Key',
      accessCode: 'CCAvenue Dashboard → Account → My Profile → Access Code',
    },
    note: 'CCAvenue does not support dispute webhooks.',
  },
};

function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// ── POST /api/merchants ──────────────────────────────────────────────────────

const addMerchant = async (req, res) => {
  const company = req.company;
  const { gateway, merchantId, label, credentials = {} } = req.body;

  if (!gateway || !merchantId)
    return res.status(400).json({ error: 'gateway and merchantId are required' });

  const gw = gateway.toLowerCase();
  const gwConfig = GATEWAY_CONFIG[gw];
  if (!gwConfig)
    return res.status(400).json({ error: `Invalid gateway. Must be one of: ${Object.keys(GATEWAY_CONFIG).join(', ')}` });

  const missing = gwConfig.companyMustProvide.filter(k => !credentials[k]);
  if (missing.length)
    return res.status(400).json({
      error:    `Missing credentials for ${gw}: ${missing.join(', ')}`,
      required: gwConfig.companyMustProvide,
      docs:     gwConfig.credentialDocs,
      note:     gwConfig.note,
    });

  const exists = await MerchantConfig.findOne({ companyId: company._id, gateway: gw, merchantId });
  if (exists)
    return res.status(409).json({ error: `Merchant "${merchantId}" for ${gw} already exists`, existingCallbackUrl: exists.callbackUrl });

  // Build encrypted credentials
  const encCreds = {};
  for (const key of gwConfig.companyMustProvide) {
    const val = credentials[key];
    if (!val) continue;
    encCreds[key] = gwConfig.plainFields.includes(key) ? String(val) : encrypt(String(val));
  }

  // Platform-generated
  const generatedSecrets = {};
  for (const key of gwConfig.weGenerate) {
    const plain   = generateWebhookSecret();
    encCreds[key] = encrypt(plain);
    generatedSecrets[key] = plain;
  }

  const callbackUrl = `${BASE_URL}/webhook/${gw}/${company.slug}/${merchantId}`;

  const config = await MerchantConfig.create({
    companyId:   company._id,
    companySlug: company.slug,
    gateway:     gw,
    merchantId,
    label:       label || `${gw} — ${merchantId}`,
    credentials: encCreds,
    callbackUrl,
  });

  const resp = {
    merchant: {
      id: config._id, gateway: config.gateway, merchantId: config.merchantId,
      label: config.label, callbackUrl: config.callbackUrl, isActive: config.isActive, createdAt: config.createdAt,
    },
    setup: getSetupInstructions(gw, callbackUrl, generatedSecrets),
  };

  if (Object.keys(generatedSecrets).length) {
    resp.generatedSecrets = generatedSecrets;
    resp.warning = '⚠️  Save these secrets now — they will NOT be shown again.';
  }

  return res.status(201).json(resp);
};

// ── POST /api/merchants/:id/rotate-secret ────────────────────────────────────

const rotateSecret = async (req, res) => {
  const config = await MerchantConfig.findOne({ _id: req.params.id, companyId: req.company._id }).select('+credentials');
  if (!config) return res.status(404).json({ error: 'Merchant config not found' });

  const gwConfig = GATEWAY_CONFIG[config.gateway];
  if (!gwConfig.weGenerate.length)
    return res.status(400).json({ error: `Secret rotation only for platform-generated secrets. ${config.gateway} secrets come from gateway dashboard.` });

  const generatedSecrets = {};
  for (const key of gwConfig.weGenerate) {
    const plain = generateWebhookSecret();
    config.credentials[key] = encrypt(plain);
    generatedSecrets[key] = plain;
  }
  config.markModified('credentials');
  await config.save();

  return res.json({ message: 'Secret rotated. Update your gateway dashboard immediately.', generatedSecrets, callbackUrl: config.callbackUrl });
};

// ── GET /api/merchants ───────────────────────────────────────────────────────

const listMerchants = async (req, res) => {
  const { gateway, isActive } = req.query;
  const filter = { companyId: req.company._id };
  if (gateway)  filter.gateway  = gateway.toLowerCase();
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const merchants = await MerchantConfig.find(filter).select('-credentials').sort({ createdAt: -1 }).lean();
  return res.json({ count: merchants.length, merchants });
};

// ── GET /api/merchants/:id ───────────────────────────────────────────────────

const getMerchant = async (req, res) => {
  const config = await MerchantConfig.findOne({ _id: req.params.id, companyId: req.company._id }).select('-credentials').lean();
  if (!config) return res.status(404).json({ error: 'Merchant config not found' });
  return res.json({ ...config, setup: getSetupInstructions(config.gateway, config.callbackUrl, {}) });
};

// ── DELETE /api/merchants/:id ────────────────────────────────────────────────

const deactivateMerchant = async (req, res) => {
  const config = await MerchantConfig.findOneAndUpdate(
    { _id: req.params.id, companyId: req.company._id },
    { isActive: false }, { new: true }
  ).select('-credentials');
  if (!config) return res.status(404).json({ error: 'Merchant config not found' });
  return res.json({ message: 'Merchant deactivated', merchantId: config.merchantId });
};

// ── Setup instructions ───────────────────────────────────────────────────────

function getSetupInstructions(gateway, callbackUrl, generated) {
  const map = {
    razorpay: {
      step1: 'Razorpay Dashboard → Settings → Webhooks → Add New Webhook',
      step2: `Webhook URL: ${callbackUrl}`,
      step3: generated.webhookSecret ? `Secret: ${generated.webhookSecret}  ← paste this exactly` : 'Use webhookSecret from registration',
      step4: 'Events: payment.captured, payment.failed, refund.created, payment.dispute.created, payment.dispute.won, payment.dispute.lost',
    },
    cashfree: {
      step1: 'Cashfree Dashboard → Developers → Webhooks',
      step2: `Webhook URL: ${callbackUrl}`,
      step3: 'Events: PAYMENT_SUCCESS, PAYMENT_FAILED, REFUND_STATUS, DISPUTE_CREATED, DISPUTE_UPDATED, DISPUTE_CLOSED',
    },
    payu: {
      step1: 'PayU Dashboard → Developer → Webhook URL',
      step2: `Webhook URL: ${callbackUrl}`,
    },
    phonepe: {
      step1: 'PhonePe Business Dashboard → API Configuration → Callback URL',
      step2: `Callback URL: ${callbackUrl}`,
    },
    ccavenue: {
      step1: 'CCAvenue Dashboard → Account → My Profile → Notify URL',
      step2: `Notify URL: ${callbackUrl}`,
    },
  };
  return map[gateway] || {};
}

module.exports = { addMerchant, listMerchants, getMerchant, deactivateMerchant, rotateSecret };