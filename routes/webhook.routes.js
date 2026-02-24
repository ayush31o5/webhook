/**
 * Webhook Routes
 * ──────────────
 * POST /webhook/:gateway/:merchantId
 *
 * :gateway    = razorpay | cashfree | payu | phonepe | ccavenue
 * :merchantId = the MID registered in MerchantConfig
 *
 * Examples:
 *   POST /webhook/razorpay/rzp_live_abc123
 *   POST /webhook/cashfree/CF_APPID_xyz
 *   POST /webhook/payu/QyT13U
 *   POST /webhook/phonepe/MERCHANTID_HERE
 *   POST /webhook/ccavenue/12345678
 */

const express  = require('express');
const router   = express.Router();
const rawBody  = require('../middleware/rawBody');
const { handleWebhook } = require('../controllers/webhook.controller');

const VALID_GATEWAYS = ['razorpay', 'cashfree', 'payu', 'phonepe', 'ccavenue'];

// Gate: reject unknown gateways before hitting controller
router.use('/:gateway/:merchantId', (req, res, next) => {
  const { gateway } = req.params;
  if (!VALID_GATEWAYS.includes(gateway)) {
    return res.status(404).json({ error: `Unknown gateway: ${gateway}` });
  }
  next();
});

// rawBody middleware — MUST be before any JSON/urlencoded parsing
// Applied per-route so other routes are unaffected
router.post('/:gateway/:merchantId', rawBody, handleWebhook);

module.exports = router;