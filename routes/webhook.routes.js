/**
 * Webhook Routes
 * ──────────────
 * POST /webhook/:gateway/:companySlug/:merchantId
 *
 * :gateway     = razorpay | cashfree | payu | phonepe | ccavenue
 * :companySlug = company slug registered on platform  e.g. "acme-ltd"
 * :merchantId  = gateway's own merchant identifier    e.g. "rzp_live_abc123"
 *
 * Examples:
 *   POST /webhook/razorpay/acme-ltd/rzp_live_abc123
 *   POST /webhook/cashfree/acme-ltd/CF_APP_456
 *   POST /webhook/payu/globemart/QyT13U
 *   POST /webhook/phonepe/shopnow/SHOPNOW_PROD
 *   POST /webhook/ccavenue/shopnow/12345678
 */

const express  = require('express');
const router   = express.Router();
const rawBody  = require('../middleware/rawBody');
const { handleWebhook } = require('../controllers/webhook.controller');

const VALID_GATEWAYS = ['razorpay', 'cashfree', 'payu', 'phonepe', 'ccavenue'];

router.use('/:gateway/:companySlug/:merchantId', (req, res, next) => {
  if (!VALID_GATEWAYS.includes(req.params.gateway)) {
    return res.status(404).json({ error: `Unknown gateway: ${req.params.gateway}` });
  }
  next();
});

router.post('/:gateway/:companySlug/:merchantId', rawBody, handleWebhook);

module.exports = router;