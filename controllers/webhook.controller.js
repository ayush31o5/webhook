/**
 * Webhook Controller
 * ──────────────────
 * Single controller handles all 5 gateways.
 * Route: POST /webhook/:gateway/:merchantId
 *
 * Flow:
 *   1. Load MerchantConfig by (gateway + merchantId)
 *   2. Decrypt credentials from DB
 *   3. Verify signature (gateway-specific)
 *   4. Map raw payload → universal keys
 *   5. Store in `webhooks` collection
 *   6. Return 200 immediately (gateways retry on non-2xx)
 */

const MerchantConfig = require('../models/MerchantConfig');
const Webhook        = require('../models/Webhook');
const { decrypt }    = require('../config/encryption');

// Verifiers
const { verifyRazorpay }                       = require('../verifiers/razorpay.verifier');
const { verifyCashfree }                       = require('../verifiers/cashfree.verifier');
const { verifyPayU }                           = require('../verifiers/payu.verifier');
const { verifyPhonePe, decodePhonePeResponse } = require('../verifiers/phonepe.verifier');
const { verifyCCAvenue }                       = require('../verifiers/ccavenue.verifier');

// Mappers
const { mapRazorpay } = require('../mappers/razorpay.mapper');
const { mapCashfree } = require('../mappers/cashfree.mapper');
const { mapPayU }     = require('../mappers/payu.mapper');
const { mapPhonePe }  = require('../mappers/phonepe.mapper');
const { mapCCAvenue } = require('../mappers/ccavenue.mapper');

// ─── Gateway Handlers ────────────────────────────────────────────────────────

async function handleRazorpay(req, config) {
  const creds = config.credentials;
  const webhookSecret  = decrypt(creds.webhookSecret);
  const receivedSig    = req.headers['x-razorpay-signature'] || '';

  const isVerified = verifyRazorpay(req.rawBody, receivedSig, webhookSecret);
  const normalized = mapRazorpay(req.body);

  return {
    isVerified,
    receivedSignature: receivedSig,
    rawPayload: req.body,
    ...normalized,
  };
}

async function handleCashfree(req, config) {
  const creds = config.credentials;
  const clientSecret = decrypt(creds.clientSecret);
  const receivedSig  = req.headers['x-webhook-signature'] || '';
  const timestamp    = req.headers['x-webhook-timestamp'] || '';

  const isVerified = verifyCashfree(req.rawBody, receivedSig, timestamp, clientSecret);
  const normalized = mapCashfree(req.body);

  return {
    isVerified,
    receivedSignature: receivedSig,
    rawPayload: req.body,
    ...normalized,
  };
}

async function handlePayU(req, config) {
  const creds = config.credentials;
  const salt  = decrypt(creds.salt);

  const isVerified = verifyPayU(req.body, salt);
  const normalized = mapPayU(req.body);

  return {
    isVerified,
    receivedSignature: req.body.hash || '',
    rawPayload: req.body,
    ...normalized,
  };
}

async function handlePhonePe(req, config) {
  const creds     = config.credentials;
  const saltKey   = decrypt(creds.saltKey);
  const saltIndex = creds.saltIndex || '1';

  const base64Response = req.body.response || '';
  const xVerify        = req.headers['x-verify'] || '';

  const isVerified = verifyPhonePe(base64Response, xVerify, saltKey, saltIndex);

  // Decode the base64 payload to get actual payment data
  const decoded    = decodePhonePeResponse(base64Response);
  const normalized = decoded ? mapPhonePe(decoded) : {};

  return {
    isVerified,
    receivedSignature: xVerify,
    rawPayload: decoded || { base64Response },
    ...normalized,
  };
}

async function handleCCAvenue(req, config) {
  const creds      = config.credentials;
  const workingKey = decrypt(creds.workingKey);
  const encResp    = req.body.encResp || '';

  const { isVerified, decrypted } = verifyCCAvenue(encResp, workingKey, config.merchantId);
  const normalized = decrypted ? mapCCAvenue(decrypted) : {};

  return {
    isVerified,
    receivedSignature: '',   // CCAvenue has no explicit signature header
    rawPayload: decrypted || { encResp: '[encrypted]' },
    ...normalized,
  };
}

// ─── Gateway Router Map ───────────────────────────────────────────────────────

const GATEWAY_HANDLERS = {
  razorpay: handleRazorpay,
  cashfree:  handleCashfree,
  payu:      handlePayU,
  phonepe:   handlePhonePe,
  ccavenue:  handleCCAvenue,
};

// ─── Main Controller ──────────────────────────────────────────────────────────

const handleWebhook = async (req, res) => {
  // Always respond 200 first — gateways WILL retry on any other status
  // We handle failures internally
  res.status(200).json({ received: true });

  const { gateway, merchantId } = req.params;

  // ── Step 1: Validate gateway ─────────────────────────────────────────────
  const handler = GATEWAY_HANDLERS[gateway];
  if (!handler) {
    console.warn(`[Webhook] Unknown gateway in route: ${gateway}`);
    return;
  }

  // ── Step 2: Load MerchantConfig ──────────────────────────────────────────
  let config;
  try {
    config = await MerchantConfig.findOne({
      gateway,
      merchantId,
      isActive: true,
    }).lean();
  } catch (err) {
    console.error(`[Webhook] DB error loading config for ${gateway}/${merchantId}:`, err.message);
    return;
  }

  if (!config) {
    console.warn(`[Webhook] No active config for gateway=${gateway} merchantId=${merchantId}`);
    // Still store the raw webhook for investigation but mark unverified
    await safeStore({
      gateway,
      merchantId,
      clientId:   'unknown',
      isVerified: false,
      rawPayload: req.body,
      eventType:  'UNKNOWN_MERCHANT',
    });
    return;
  }

  // ── Step 3: Verify + Map ─────────────────────────────────────────────────
  let result;
  try {
    result = await handler(req, config);
  } catch (err) {
    console.error(`[Webhook] Handler error for ${gateway}/${merchantId}:`, err.message);
    await safeStore({
      gateway,
      merchantId,
      clientId:   config.clientId,
      isVerified: false,
      rawPayload: req.body,
      eventType:  'HANDLER_ERROR',
    });
    return;
  }

  // ── Step 4: Log unverified webhooks (don't silently drop them) ───────────
  if (!result.isVerified) {
    console.warn(`[Webhook] SIGNATURE FAILED | gateway=${gateway} mid=${merchantId} event=${result.eventType}`);
  }

  // ── Step 5: Store ────────────────────────────────────────────────────────
  await safeStore({
    gateway,
    merchantId,
    clientId: config.clientId,
    ...result,
  });
};

async function safeStore(data) {
  try {
    await Webhook.create(data);
    console.log(
      `[Webhook] Stored | gateway=${data.gateway} mid=${data.merchantId} ` +
      `event=${data.eventType} verified=${data.isVerified} ` +
      `orderId=${data.orderId} status=${data.status}`
    );
  } catch (err) {
    console.error('[Webhook] Failed to store:', err.message);
  }
}

module.exports = { handleWebhook };