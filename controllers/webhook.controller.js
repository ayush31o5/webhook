/**
 * Webhook Controller
 * ──────────────────
 * Route: POST /webhook/:gateway/:companySlug/:merchantId
 *
 * Handles BOTH payment events and dispute events on the same endpoint.
 * The gateway sends everything to the same URL — we detect the event type
 * and route to either Transaction (payment) or Dispute (chargeback/dispute).
 *
 * ── Event Detection Logic ──────────────────────────────────────────────────
 *
 * Razorpay:
 *   body.event starts with "payment.dispute." → dispute
 *   body.event starts with "payment." or "refund." or "order." → transaction
 *
 * Cashfree:
 *   body.type starts with "DISPUTE_" → dispute
 *   body.type starts with "PAYMENT_" or "REFUND_" → transaction
 *
 * PayU:
 *   body.type === "payments" && body.event === "dispute" → dispute
 *   otherwise → transaction
 *
 * PhonePe:
 *   No dispute webhooks. All events → transaction.
 *
 * CCAvenue:
 *   No dispute webhooks. All events → transaction.
 */

const MerchantConfig = require('../models/MerchantConfig');
const Transaction    = require('../models/Transaction');
const Dispute        = require('../models/Dispute');
const { decrypt }    = require('../config/encryption');

// ── Verifiers ─────────────────────────────────────────────────────────────
const { verifyRazorpay }                       = require('../verifiers/razorpay.verifier');
const { verifyCashfree }                       = require('../verifiers/cashfree.verifier');
const { verifyPayU }                           = require('../verifiers/payu.verifier');
const { verifyPhonePe, decodePhonePeResponse } = require('../verifiers/phonepe.verifier');
const { verifyCCAvenue }                       = require('../verifiers/ccavenue.verifier');

// ── Payment Mappers ────────────────────────────────────────────────────────
const { mapRazorpay } = require('../mappers/razorpay.mapper');
const { mapCashfree } = require('../mappers/cashfree.mapper');
const { mapPayU }     = require('../mappers/payu.mapper');
const { mapPhonePe }  = require('../mappers/phonepe.mapper');
const { mapCCAvenue } = require('../mappers/ccavenue.mapper');

// ── Dispute Mappers ────────────────────────────────────────────────────────
const { mapRazorpayDispute }            = require('../mappers/razorpay.dispute.mapper');
const { mapCashfreeDispute }            = require('../mappers/cashfree.dispute.mapper');
const { mapPayUDispute, isPayUDisputeEvent } = require('../mappers/payu.dispute.mapper');

// ── Event type detection ───────────────────────────────────────────────────

function isDisputeEvent(gateway, body) {
  switch (gateway) {
    case 'razorpay':
      return (body.event || '').startsWith('payment.dispute.');
    case 'cashfree':
      return (body.type || '').startsWith('DISPUTE_');
    case 'payu':
      return isPayUDisputeEvent(body);
    default:
      return false;
  }
}

// ── Per-gateway verify + raw data extraction ───────────────────────────────

async function extractRazorpay(req, config) {
  const secret     = decrypt(config.credentials.webhookSecret);
  const sig        = req.headers['x-razorpay-signature'] || '';
  const isVerified = verifyRazorpay(req.rawBody, sig, secret);
  return { isVerified, sig, body: req.body };
}

async function extractCashfree(req, config) {
  const secret     = decrypt(config.credentials.clientSecret);
  const sig        = req.headers['x-webhook-signature'] || '';
  const ts         = req.headers['x-webhook-timestamp'] || '';
  const isVerified = verifyCashfree(req.rawBody, sig, ts, secret);
  return { isVerified, sig, body: req.body };
}

async function extractPayU(req, config) {
  const salt       = decrypt(config.credentials.salt);
  const isVerified = verifyPayU(req.body, salt);
  return { isVerified, sig: req.body.hash || '', body: req.body };
}

async function extractPhonePe(req, config) {
  const saltKey    = decrypt(config.credentials.saltKey);
  const saltIndex  = config.credentials.saltIndex || '1';
  const base64R    = req.body.response || '';
  const xVerify    = req.headers['x-verify'] || '';
  const isVerified = verifyPhonePe(base64R, xVerify, saltKey, saltIndex);
  const decoded    = decodePhonePeResponse(base64R);
  return { isVerified, sig: xVerify, body: decoded || { base64Response: base64R } };
}

async function extractCCAvenue(req, config) {
  const workingKey              = decrypt(config.credentials.workingKey);
  const { isVerified, decrypted } = verifyCCAvenue(req.body.encResp || '', workingKey, config.merchantId);
  return { isVerified, sig: '', body: decrypted || { encResp: '[encrypted]' } };
}

const EXTRACTORS = {
  razorpay: extractRazorpay,
  cashfree:  extractCashfree,
  payu:      extractPayU,
  phonepe:   extractPhonePe,
  ccavenue:  extractCCAvenue,
};

// ── Main controller ────────────────────────────────────────────────────────

const handleWebhook = async (req, res) => {
  res.status(200).json({ received: true });

  const { gateway, companySlug, merchantId } = req.params;

  const extractor = EXTRACTORS[gateway];
  if (!extractor) {
    console.warn(`[Webhook] Unknown gateway: ${gateway}`);
    return;
  }

  // Load config with credentials
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
    console.warn(`[Webhook] No config | ${gateway}/${companySlug}/${merchantId}`);
    return;
  }

  // Verify signature + extract body
  let extracted;
  try {
    extracted = await extractor(req, config);
  } catch (err) {
    console.error(`[Webhook] Extraction error | ${gateway}:`, err.message);
    return;
  }

  const { isVerified, sig: receivedSig, body } = extracted;

  if (!isVerified) {
    console.warn(`[Webhook] Signature FAILED | ${gateway}/${companySlug}/${merchantId}`);
  }

  // ── Route to dispute or transaction ─────────────────────────────────────
  if (isDisputeEvent(gateway, body)) {
    await handleDisputeEvent({
      gateway, companySlug, merchantId,
      companyId: config.companyId,
      isVerified, receivedSig, body,
    });
  } else {
    await handlePaymentEvent({
      gateway, companySlug, merchantId,
      companyId: config.companyId,
      isVerified, receivedSig, body,
      // PhonePe: body is already decoded JSON; for others it's the raw parsed body
    });
  }
};

// ── Dispute event handler ──────────────────────────────────────────────────

async function handleDisputeEvent({ gateway, companySlug, merchantId, companyId, isVerified, receivedSig, body }) {
  let mapped;
  try {
    if (gateway === 'razorpay') mapped = mapRazorpayDispute(body);
    else if (gateway === 'cashfree') mapped = mapCashfreeDispute(body);
    else if (gateway === 'payu') mapped = mapPayUDispute(body);
    else return;
  } catch (err) {
    console.error(`[Dispute] Mapper error | ${gateway}:`, err.message);
    return;
  }

  if (!mapped.disputeId) {
    console.warn(`[Dispute] No disputeId in payload | ${gateway}`);
    return;
  }

  try {
    // UPSERT — multiple events for same dispute update the same document
    await Dispute.findOneAndUpdate(
      { gateway, disputeId: mapped.disputeId },
      {
        $set: {
          companyId,
          companySlug,
          merchantId,
          isVerified,
          rawPayload: body,
          ...mapped,
        },
        $setOnInsert: { receivedAt: new Date() },
      },
      { upsert: true, new: true }
    );

    console.log(
      `[Dispute] Saved | ${gateway}/${companySlug} | event=${mapped.eventType}` +
      ` disputeId=${mapped.disputeId} status=${mapped.status}` +
      ` respondBy=${mapped.respondBy?.toISOString() || 'N/A'}`
    );
  } catch (err) {
    console.error(`[Dispute] Save failed:`, err.message);
  }
}

// ── Payment event handler ──────────────────────────────────────────────────

async function handlePaymentEvent({ gateway, companySlug, merchantId, companyId, isVerified, receivedSig, body }) {
  let mapped;
  try {
    if (gateway === 'razorpay') mapped = mapRazorpay(body);
    else if (gateway === 'cashfree') mapped = mapCashfree(body);
    else if (gateway === 'payu') mapped = mapPayU(body);
    else if (gateway === 'phonepe') mapped = mapPhonePe(body);
    else if (gateway === 'ccavenue') mapped = mapCCAvenue(body);
    else return;
  } catch (err) {
    console.error(`[Payment] Mapper error | ${gateway}:`, err.message);
    return;
  }

  try {
    await Transaction.create({
      companyId, companySlug, gateway, merchantId,
      isVerified, rawPayload: body,
      ...mapped,
    });

    console.log(
      `[Transaction] Saved | ${gateway}/${companySlug} | event=${mapped.eventType}` +
      ` orderId=${mapped.orderId} status=${mapped.status} amount=${mapped.amount}`
    );
  } catch (err) {
    console.error(`[Transaction] Save failed:`, err.message);
  }
}

module.exports = { handleWebhook };