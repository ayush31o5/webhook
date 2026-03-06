/**
 * API Routes
 * ──────────
 * Companies:    POST/GET /api/companies
 * Merchants:    CRUD     /api/merchants
 * Transactions: GET      /api/transactions
 * Disputes:     GET      /api/disputes
 * Evidence:     CRUD     /api/disputes/:id/evidence
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');

const { registerCompany, getCompany, rotateApiKey } =
  require('../controllers/company.controller');

const { addMerchant, listMerchants, getMerchant, deactivateMerchant, rotateSecret } =
  require('../controllers/merchant.controller');

const { listTransactions, getTransaction, getByOrderId } =
  require('../controllers/transaction.controller');

const { listDisputes, getUrgentDisputes, getDispute,
        getByOrderId: getDisputeByOrder, updateEvidence } =
  require('../controllers/dispute.controller');

const { uploadEvidence, listEvidence, deleteEvidence, submitEvidence, getEvidenceSummary } =
  require('../controllers/evidence.controller');

router.use(express.json());

// ── Companies ──────────────────────────────────────────────────────────────
router.post('/companies',            registerCompany);
router.get( '/companies/me',   auth, getCompany);
router.post('/companies/rotate-key', auth, rotateApiKey);

// ── Merchants ──────────────────────────────────────────────────────────────
router.post(  '/merchants',                   auth, addMerchant);
router.get(   '/merchants',                   auth, listMerchants);
router.get(   '/merchants/:id',               auth, getMerchant);
router.delete('/merchants/:id',               auth, deactivateMerchant);
router.post(  '/merchants/:id/rotate-secret', auth, rotateSecret);

// ── Transactions ───────────────────────────────────────────────────────────
router.get('/transactions',                auth, listTransactions);
router.get('/transactions/order/:orderId', auth, getByOrderId);
router.get('/transactions/:id',            auth, getTransaction);

// ── Disputes ───────────────────────────────────────────────────────────────
router.get('/disputes',                    auth, listDisputes);
router.get('/disputes/urgent',             auth, getUrgentDisputes);
router.get('/disputes/order/:orderId',     auth, getDisputeByOrder);
router.get('/disputes/:id',                auth, getDispute);
router.put('/disputes/:id',                auth, updateEvidence);   // legacy – update dispute fields

// ── Evidence (file upload + gateway submission) ────────────────────────────
// POST with file:   multipart/form-data { file, evidenceType, note }
// POST with text:   application/json    { evidenceType, textContent, note }
router.post(
  '/disputes/:id/evidence/upload',
  auth,
  (req, res, next) => {
    // Allow both multipart (file) and JSON (text) on same route
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart')) {
      upload.single('file')(req, res, (err) => handleUploadError(err, req, res, next));
    } else {
      next();
    }
  },
  uploadEvidence
);

router.get(  '/disputes/:id/evidence',          auth, listEvidence);
router.get(  '/disputes/:id/evidence/summary',  auth, getEvidenceSummary);
router.delete('/disputes/:id/evidence/:eid',    auth, deleteEvidence);
router.post( '/disputes/:id/evidence/submit',   auth, submitEvidence);

module.exports = router;