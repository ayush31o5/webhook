/**
 * API Routes
 * ──────────
 * All management routes — authenticated with platform API key.
 *
 * Companies:
 *   POST /api/companies             → Register company
 *   GET  /api/companies/me          → Get own info
 *   POST /api/companies/rotate-key  → Rotate API key
 *
 * Merchants:
 *   POST   /api/merchants           → Add merchant config → get callback URL
 *   GET    /api/merchants           → List all merchants
 *   GET    /api/merchants/:id       → Get one merchant
 *   DELETE /api/merchants/:id       → Deactivate merchant
 *
 * Transactions:
 *   GET /api/transactions                    → List (filterable, paginated)
 *   GET /api/transactions/order/:orderId     → By orderId
 *   GET /api/transactions/:id                → Single transaction
 */

const express     = require('express');
const router      = express.Router();
const auth        = require('../middleware/auth');

const {
  registerCompany, getCompany, rotateApiKey,
} = require('../controllers/company.controller');

const {
  addMerchant, listMerchants, getMerchant, deactivateMerchant,
} = require('../controllers/merchant.controller');

const {
  listTransactions, getTransaction, getByOrderId,
} = require('../controllers/transaction.controller');

// Express body parsing for API routes (not needed for webhooks)
router.use(express.json());

// ── Companies (no auth on register) ───────────────────────────────────────
router.post('/companies',            registerCompany);
router.get( '/companies/me',   auth, getCompany);
router.post('/companies/rotate-key', auth, rotateApiKey);

// ── Merchants ──────────────────────────────────────────────────────────────
router.post(  '/merchants',      auth, addMerchant);
router.get(   '/merchants',      auth, listMerchants);
router.get(   '/merchants/:id',  auth, getMerchant);
router.delete('/merchants/:id',  auth, deactivateMerchant);

// ── Transactions ───────────────────────────────────────────────────────────
router.get('/transactions',                  auth, listTransactions);
router.get('/transactions/order/:orderId',   auth, getByOrderId);
router.get('/transactions/:id',              auth, getTransaction);

module.exports = router;