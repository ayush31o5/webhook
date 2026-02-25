/**
 * Transaction Controller
 * ──────────────────────
 * Query normalized payment data.
 *
 * GET /api/transactions              → List transactions (paginated, filterable)
 * GET /api/transactions/:id          → Single transaction
 * GET /api/transactions/order/:orderId → By orderId (for reconciliation)
 */

const Transaction = require('../models/Transaction');

// ── GET /api/transactions ──────────────────────────────────────────────────
const listTransactions = async (req, res) => {
  const {
    gateway,
    merchantId,
    status,
    method,
    orderId,
    from,      // ISO date string
    to,        // ISO date string
    page  = 1,
    limit = 20,
  } = req.query;

  const filter = { companyId: req.company._id };

  if (gateway)    filter.gateway    = gateway.toLowerCase();
  if (merchantId) filter.merchantId = merchantId;
  if (status)     filter.status     = status.toLowerCase();
  if (method)     filter.method     = method.toLowerCase();
  if (orderId)    filter.orderId    = orderId;

  if (from || to) {
    filter.receivedAt = {};
    if (from) filter.receivedAt.$gte = new Date(from);
    if (to)   filter.receivedAt.$lte = new Date(to);
  }

  const skip  = (Number(page) - 1) * Number(limit);
  const total = await Transaction.countDocuments(filter);

  const transactions = await Transaction
    .find(filter)
    .sort({ receivedAt: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

  return res.json({
    total,
    page:    Number(page),
    limit:   Number(limit),
    pages:   Math.ceil(total / Number(limit)),
    transactions,
  });
};

// ── GET /api/transactions/:id ──────────────────────────────────────────────
const getTransaction = async (req, res) => {
  const txn = await Transaction
    .findOne({ _id: req.params.id, companyId: req.company._id })
    .lean();

  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  return res.json(txn);
};

// ── GET /api/transactions/order/:orderId ───────────────────────────────────
const getByOrderId = async (req, res) => {
  const transactions = await Transaction
    .find({ orderId: req.params.orderId, companyId: req.company._id })
    .sort({ receivedAt: -1 })
    .lean();

  if (!transactions.length) {
    return res.status(404).json({ error: 'No transactions found for this orderId' });
  }
  return res.json({ count: transactions.length, transactions });
};

module.exports = { listTransactions, getTransaction, getByOrderId };