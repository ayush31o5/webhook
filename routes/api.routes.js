/**
 * API Routes
 * ──────────
 * Companies:
 *   POST /api/companies             → Register company
 *   GET  /api/companies/me          → Get own info
 *   POST /api/companies/rotate-key  → Rotate API key
 *
 * Merchants:
 *   POST   /api/merchants                     → Add merchant → get callback URL
 *   GET    /api/merchants                     → List all merchants
 *   GET    /api/merchants/:id                 → Get one merchant
 *   DELETE /api/merchants/:id                 → Deactivate merchant
 *   POST   /api/merchants/:id/rotate-secret   → Regenerate Razorpay webhook secret
 *
 * Transactions (payment events):
 *   GET /api/transactions                     → List (filterable, paginated)
 *   GET /api/transactions/order/:orderId      → By orderId
 *   GET /api/transactions/:id                 → Single transaction
 *
 * Disputes:
 *   GET /api/disputes                         → List disputes
 *   GET /api/disputes/urgent                  → Disputes expiring in 48h
 *   GET /api/disputes/order/:orderId          → By orderId
 *   GET /api/disputes/:id                     → Single dispute
 *   PUT /api/disputes/:id/evidence            → Save/update evidence docs
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');

const { registerCompany, getCompany, rotateApiKey } =
  require('../controllers/company.controller');

const { addMerchant, listMerchants, getMerchant, deactivateMerchant, rotateSecret } =
  require('../controllers/merchant.controller');

const { listTransactions, getTransaction, getByOrderId } =
  require('../controllers/transaction.controller');

const { listDisputes, getUrgentDisputes, getDispute, getByOrderId: getDisputeByOrder, updateEvidence } =
  require('../controllers/dispute.controller');

// Express body parsing (only for API — webhook routes handle their own)
router.use(express.json());

// ── Companies ──────────────────────────────────────────────────────────────
router.post('/companies',             registerCompany);
router.get( '/companies/me',    auth, getCompany);
router.post('/companies/rotate-key',  auth, rotateApiKey);

// ── Merchants ──────────────────────────────────────────────────────────────
router.post(  '/merchants',                   auth, addMerchant);
router.get(   '/merchants',                   auth, listMerchants);
router.get(   '/merchants/:id',               auth, getMerchant);
router.delete('/merchants/:id',               auth, deactivateMerchant);
router.post(  '/merchants/:id/rotate-secret', auth, rotateSecret);

// ── Transactions ───────────────────────────────────────────────────────────
router.get('/transactions',                 auth, listTransactions);
router.get('/transactions/order/:orderId',  auth, getByOrderId);
router.get('/transactions/:id',             auth, getTransaction);

// ── Disputes ───────────────────────────────────────────────────────────────
// NOTE: /urgent and /order/:orderId must be before /:id — Express matches in order
router.get('/disputes',                     auth, listDisputes);
router.get('/disputes/urgent',              auth, getUrgentDisputes);
router.get('/disputes/order/:orderId',      auth, getDisputeByOrder);
router.get('/disputes/:id',                 auth, getDispute);
router.put('/disputes/:id/evidence',        auth, updateEvidence);

module.exports = router;