/**
 * Webhook Controller
 * ──────────────────
 * Route: POST /webhook/:gateway/:companySlug/:merchantId
 *
 * Flow:
 *   1. Load MerchantConfig by (gateway + companySlug + merchantId)
 *   2. Decrypt credentials in-memory
 *   3. Verify signature (gateway-specific)
 *   4. Map raw payload → normalized Transaction fields
 *   5. Save Transaction document
 *   6. Return 200 immediately (gateways retry on non-2xx)
 */

const MerchantConfig = require('../models/MerchantConfig');
const Transaction    = require('../models/Transaction');
const { decrypt }    = require('../config/encryption');

// ── Verifiers ──────────────────────────────────────────────────────────────
const { verifyRazorpay }                       = require('../verifiers/razorpay.verifier');
const { verifyCashfree }                       = require('../verifiers/cashfree.verifier');
const { verifyPayU }                           = require('../verifiers/payu.verifier');
const { verifyPhonePe, decodePhonePeResponse } = require('../verifiers/phonepe.verifier');
const { verifyCCAvenue }                       = require('../verifiers/ccavenue.verifier');

// ── Mappers ────────────────────────────────────────────────────────────────
const { mapRazorpay } = require('../mappers/razorpay.mapper');
const { mapCashfree } = require('../mappers/cashfree.mapper');
const { mapPayU }     = require('../mappers/payu.mapper');
const { mapPhonePe }  = require('../mappers/phonepe.mapper');
const { mapCCAvenue } = require('../mappers/ccavenue.mapper');

// ── Per-gateway handlers ───────────────────────────────────────────────────

async function handleRazorpay(req, config) {
  const webhookSecret = decrypt(config.credentials.webhookSecret);
  const receivedSig   = req.headers['x-razorpay-signature'] || '';
  const isVerified    = verifyRazorpay(req.rawBody, receivedSig, webhookSecret);
  return { isVerified, receivedSignature: receivedSig, rawPayload: req.body, ...mapRazorpay(req.body) };
}

async function handleCashfree(req, config) {
  const clientSecret = decrypt(config.credentials.clientSecret);
  const receivedSig  = req.headers['x-webhook-signature'] || '';
  const timestamp    = req.headers['x-webhook-timestamp'] || '';
  const isVerified   = verifyCashfree(req.rawBody, receivedSig, timestamp, clientSecret);
  return { isVerified, receivedSignature: receivedSig, rawPayload: req.body, ...mapCashfree(req.body) };
}

async function handlePayU(req, config) {
  const salt       = decrypt(config.credentials.salt);
  const isVerified = verifyPayU(req.body, salt);
  return { isVerified, receivedSignature: req.body.hash || '', rawPayload: req.body, ...mapPayU(req.body) };
}

async function handlePhonePe(req, config) {
  const saltKey      = decrypt(config.credentials.saltKey);
  const saltIndex    = config.credentials.saltIndex || '1';
  const base64Resp   = req.body.response || '';
  const xVerify      = req.headers['x-verify'] || '';
  const isVerified   = verifyPhonePe(base64Resp, xVerify, saltKey, saltIndex);
  const decoded      = decodePhonePeResponse(base64Resp);
  return { isVerified, receivedSignature: xVerify, rawPayload: decoded || { base64Response: base64Resp }, ...mapPhonePe(decoded || {}) };
}

async function handleCCAvenue(req, config) {
  const workingKey                    = decrypt(config.credentials.workingKey);
  const encResp                       = req.body.encResp || '';
  const { isVerified, decrypted }     = verifyCCAvenue(encResp, workingKey, config.merchantId);
  return { isVerified, receivedSignature: '', rawPayload: decrypted || { encResp: '[encrypted]' }, ...mapCCAvenue(decrypted || {}) };
}

const HANDLERS = {
  razorpay: handleRazorpay,
  cashfree: handleCashfree,
  payu:     handlePayU,
  phonepe:  handlePhonePe,
  ccavenue: handleCCAvenue,
};

// ── Main controller ────────────────────────────────────────────────────────

const handleWebhook = async (req, res) => {
  // Always 200 first — gateways retry on any other status
  res.status(200).json({ received: true });

  const { gateway, companySlug, merchantId } = req.params;

  // ── 1. Validate gateway ────────────────────────────────────────────────
  const handler = HANDLERS[gateway];
  if (!handler) {
    console.warn(`[Webhook] Unknown gateway: ${gateway}`);
    return;
  }

  // ── 2. Load MerchantConfig (with credentials) ──────────────────────────
  let config;
  try {
    config = await MerchantConfig
      .findOne({ gateway, companySlug, merchantId, isActive: true })
      .select('+credentials')
      .lean();
  } catch (err) {
    console.error(`[Webhook] DB error | ${gateway}/${companySlug}/${merchantId}:`, err.message);
    return;
  }

  if (!config) {
    console.warn(`[Webhook] No config | gateway=${gateway} company=${companySlug} mid=${merchantId}`);
    await saveTransaction({
      gateway, companySlug, merchantId,
      companyId:    null,
      isVerified:   false,
      eventType:    'UNKNOWN_MERCHANT',
      status:       'unknown',
      rawPayload:   req.body,
    });
    return;
  }

  // ── 3. Verify + Map ────────────────────────────────────────────────────
  let result;
  try {
    result = await handler(req, config);
  } catch (err) {
    console.error(`[Webhook] Handler error | ${gateway}/${companySlug}/${merchantId}:`, err.message);
    await saveTransaction({
      gateway, companySlug, merchantId,
      companyId:  config.companyId,
      isVerified: false,
      eventType:  'HANDLER_ERROR',
      status:     'unknown',
      rawPayload: req.body,
    });
    return;
  }

  if (!result.isVerified) {
    console.warn(`[Webhook] Signature FAILED | ${gateway}/${companySlug}/${merchantId} | event=${result.eventType}`);
  }

  // ── 4. Save Transaction ────────────────────────────────────────────────
  await saveTransaction({
    companyId:    config.companyId,
    companySlug:  config.companySlug,
    gateway,
    merchantId,
    ...result,
  });
};

async function saveTransaction(data) {
  try {
    const { rawPayload, receivedSignature, ...fields } = data;
    await Transaction.create({
      ...fields,
      rawPayload,  // stored but not returned by default (select:false)
    });
    console.log(
      `[Transaction] Saved | ${data.gateway}/${data.companySlug}/${data.merchantId}` +
      ` | event=${data.eventType} verified=${data.isVerified}` +
      ` | orderId=${data.orderId} status=${data.status} amount=${data.amount}`
    );
  } catch (err) {
    console.error('[Transaction] Save failed:', err.message);
  }
}

module.exports = { handleWebhook };