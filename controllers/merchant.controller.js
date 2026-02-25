/**
 * Merchant Controller
 * ───────────────────
 * Manages merchant gateway configs for a company.
 *
 * POST   /api/merchants                  → Add a merchant config, get callback URL
 * GET    /api/merchants                  → List all merchants for this company
 * GET    /api/merchants/:id              → Get single merchant config
 * DELETE /api/merchants/:id              → Deactivate a merchant config
 *
 * All routes require auth (Bearer API key).
 */

const MerchantConfig = require('../models/MerchantConfig');
const { encrypt }    = require('../config/encryption');

// ── Validation: required credential fields per gateway ─────────────────────
const REQUIRED_CREDENTIALS = {
  razorpay: ['webhookSecret'],
  cashfree: ['clientSecret'],
  payu:     ['salt'],
  phonepe:  ['saltKey', 'saltIndex'],
  ccavenue: ['workingKey'],
};

// Fields that should NOT be encrypted (not secret)
const PLAIN_FIELDS = new Set(['saltIndex']);

const BASE_URL = process.env.BASE_URL || 'https://yourplatform.com';

// ── POST /api/merchants ────────────────────────────────────────────────────
const addMerchant = async (req, res) => {
  const company = req.company;
  const { gateway, merchantId, label, credentials } = req.body;

  // ── Validate inputs ───────────────────────────────────────────────────
  if (!gateway || !merchantId) {
    return res.status(400).json({ error: 'gateway and merchantId are required' });
  }

  const validGateways = ['razorpay', 'cashfree', 'payu', 'phonepe', 'ccavenue'];
  if (!validGateways.includes(gateway.toLowerCase())) {
    return res.status(400).json({
      error: `Invalid gateway. Must be one of: ${validGateways.join(', ')}`,
    });
  }

  const gw = gateway.toLowerCase();

  // ── Check required credentials ────────────────────────────────────────
  const required = REQUIRED_CREDENTIALS[gw];
  if (!credentials || typeof credentials !== 'object') {
    return res.status(400).json({ error: 'credentials object is required' });
  }

  const missing = required.filter((k) => !credentials[k]);
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing credentials for ${gw}: ${missing.join(', ')}`,
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
      error: `Merchant "${merchantId}" for gateway "${gw}" already exists`,
      existingCallbackUrl: exists.callbackUrl,
    });
  }

  // ── Encrypt credentials ───────────────────────────────────────────────
  const encryptedCredentials = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (!value) continue;
    encryptedCredentials[key] = PLAIN_FIELDS.has(key)
      ? String(value)          // saltIndex → store as plain
      : encrypt(String(value)); // everything else → AES-256-GCM
  }

  // ── Build callback URL ────────────────────────────────────────────────
  const callbackUrl = `${BASE_URL}/webhook/${gw}/${company.slug}/${merchantId}`;

  // ── Save ──────────────────────────────────────────────────────────────
  const config = await MerchantConfig.create({
    companyId:   company._id,
    companySlug: company.slug,
    gateway:     gw,
    merchantId,
    label:       label || `${gw} — ${merchantId}`,
    credentials: encryptedCredentials,
    callbackUrl,
  });

  return res.status(201).json({
    message: `Merchant added. Paste the callbackUrl into your ${gw} dashboard.`,
    merchant: {
      id:          config._id,
      gateway:     config.gateway,
      merchantId:  config.merchantId,
      label:       config.label,
      callbackUrl: config.callbackUrl,
      isActive:    config.isActive,
      createdAt:   config.createdAt,
    },
    instructions: getInstructions(gw, callbackUrl),
  });
};

// ── GET /api/merchants ─────────────────────────────────────────────────────
const listMerchants = async (req, res) => {
  const { gateway, isActive } = req.query;

  const filter = { companyId: req.company._id };
  if (gateway)  filter.gateway  = gateway.toLowerCase();
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const merchants = await MerchantConfig
    .find(filter)
    .select('-credentials')   // never return encrypted creds in list
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
    instructions: getInstructions(config.gateway, config.callbackUrl),
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

// ── Helper: per-gateway dashboard instructions ─────────────────────────────
function getInstructions(gateway, callbackUrl) {
  const map = {
    razorpay: {
      where:  'Razorpay Dashboard → Settings → Webhooks → Add New Webhook',
      url:    callbackUrl,
      note:   'Paste the webhookSecret you provided as the "Secret" field in the Razorpay webhook form.',
    },
    cashfree: {
      where:  'Cashfree Dashboard → Developers → Webhooks',
      url:    callbackUrl,
      note:   'Set PAYMENT_SUCCESS, PAYMENT_FAILED, and REFUND events.',
    },
    payu: {
      where:  'PayU Dashboard → Developer → Webhook URL',
      url:    callbackUrl,
      note:   'PayU uses reverse hash — ensure the salt you provided matches your PayU dashboard salt.',
    },
    phonepe: {
      where:  'PhonePe Business Dashboard → API Configuration → Redirect URL / Webhook',
      url:    callbackUrl,
      note:   'PhonePe calls this URL with base64-encoded response payload.',
    },
    ccavenue: {
      where:  'CCAvenue Dashboard → Account → My Profile → Notify URL',
      url:    callbackUrl,
      note:   'CCAvenue encrypts the response with your Working Key. No separate signature is used.',
    },
  };
  return map[gateway] || {};
}

module.exports = { addMerchant, listMerchants, getMerchant, deactivateMerchant };