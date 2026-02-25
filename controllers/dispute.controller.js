/**
 * Dispute Controller
 * ──────────────────
 * GET  /api/disputes                         List disputes (filterable)
 * GET  /api/disputes/urgent                  Disputes expiring within 48h
 * GET  /api/disputes/:id                     Single dispute
 * GET  /api/disputes/order/:orderId          By orderId
 * PUT  /api/disputes/:id/evidence            Save/update evidence
 *
 * Evidence submission:
 *   We store the evidence in MongoDB. Submission TO the actual gateway
 *   (Razorpay Disputes API, Cashfree Disputes API) must be done separately —
 *   this platform stores the state so companies can track what they've submitted.
 *
 *   For Razorpay: after storing here, company should call
 *     PATCH https://api.razorpay.com/v1/disputes/:id/evidence
 *   For Cashfree: company should call their Disputes API
 *   For PayU: company must respond via PayU Dashboard / Chargeback API
 */

const Dispute = require('../models/Dispute');

// ── GET /api/disputes ──────────────────────────────────────────────────────
const listDisputes = async (req, res) => {
  const {
    gateway, merchantId, status, phase,
    from, to,
    page = 1, limit = 20,
  } = req.query;

  const filter = { companyId: req.company._id };
  if (gateway)    filter.gateway    = gateway.toLowerCase();
  if (merchantId) filter.merchantId = merchantId;
  if (status)     filter.status     = status;
  if (phase)      filter.phase      = phase;

  if (from || to) {
    filter.receivedAt = {};
    if (from) filter.receivedAt.$gte = new Date(from);
    if (to)   filter.receivedAt.$lte = new Date(to);
  }

  const skip  = (Number(page) - 1) * Number(limit);
  const total = await Dispute.countDocuments(filter);

  const disputes = await Dispute
    .find(filter)
    .sort({ respondBy: 1, receivedAt: -1 })  // most urgent first
    .skip(skip)
    .limit(Number(limit))
    .lean();

  return res.json({ total, page: Number(page), limit: Number(limit), disputes });
};

// ── GET /api/disputes/urgent ───────────────────────────────────────────────
// Disputes expiring within 48 hours that still need a response
const getUrgentDisputes = async (req, res) => {
  const now         = new Date();
  const fortyEightH = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const disputes = await Dispute.find({
    companyId: req.company._id,
    status:    { $in: ['open', 'action_required'] },
    respondBy: { $gte: now, $lte: fortyEightH },
  })
  .sort({ respondBy: 1 })
  .lean();

  return res.json({
    count:    disputes.length,
    message:  disputes.length
      ? `⚠️  ${disputes.length} dispute(s) require response within 48 hours`
      : '✅ No urgent disputes',
    disputes,
  });
};

// ── GET /api/disputes/:id ──────────────────────────────────────────────────
const getDispute = async (req, res) => {
  const dispute = await Dispute
    .findOne({ _id: req.params.id, companyId: req.company._id })
    .lean();

  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  return res.json({
    ...dispute,
    hoursToRespondBy: dispute.respondBy
      ? Math.max(0, Math.round((new Date(dispute.respondBy) - new Date()) / 3600000))
      : null,
  });
};

// ── GET /api/disputes/order/:orderId ──────────────────────────────────────
const getByOrderId = async (req, res) => {
  const disputes = await Dispute
    .find({ orderId: req.params.orderId, companyId: req.company._id })
    .sort({ receivedAt: -1 })
    .lean();

  if (!disputes.length) {
    return res.status(404).json({ error: 'No disputes found for this orderId' });
  }
  return res.json({ count: disputes.length, disputes });
};

// ── PUT /api/disputes/:id/evidence ────────────────────────────────────────
const updateEvidence = async (req, res) => {
  const dispute = await Dispute.findOne({
    _id: req.params.id,
    companyId: req.company._id,
  });

  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  if (['won', 'lost', 'closed'].includes(dispute.status)) {
    return res.status(400).json({
      error: `Cannot update evidence — dispute is already ${dispute.status}`,
    });
  }

  // Merge incoming evidence fields (don't overwrite untouched fields)
  const incoming = req.body.evidence || {};
  const evidenceFields = [
    'summary', 'shippingProof', 'billingProof', 'cancellationProof',
    'customerCommunication', 'proofOfService', 'explanationLetter',
    'refundConfirmation', 'accessActivityLog', 'refundCancellationPolicy',
    'termsAndConditions', 'others',
  ];

  for (const field of evidenceFields) {
    if (incoming[field] !== undefined) {
      dispute.evidence[field] = incoming[field];
    }
  }

  // Mark as submitted if submittedAt requested
  if (req.body.markAsSubmitted) {
    dispute.evidence.submittedAt = new Date();
  }

  dispute.markModified('evidence');
  await dispute.save();

  return res.json({
    message:  req.body.markAsSubmitted
      ? 'Evidence saved and marked as submitted. Remember to also submit via gateway API/dashboard.'
      : 'Evidence saved.',
    warning:  getGatewaySubmitWarning(dispute.gateway),
    evidence: dispute.evidence,
    dispute: {
      id:         dispute._id,
      disputeId:  dispute.disputeId,
      status:     dispute.status,
      respondBy:  dispute.respondBy,
    },
  });
};

function getGatewaySubmitWarning(gateway) {
  const map = {
    razorpay: 'Saving here does NOT submit to Razorpay. Use PATCH https://api.razorpay.com/v1/disputes/:id/evidence with your Razorpay API key to submit the actual evidence.',
    cashfree: 'Saving here does NOT submit to Cashfree. Use the Cashfree Disputes API to submit evidence before the deadline.',
    payu:     'Saving here does NOT submit to PayU. Respond via PayU Dashboard → Chargeback section before the due date.',
  };
  return map[gateway] || '';
}

module.exports = {
  listDisputes,
  getUrgentDisputes,
  getDispute,
  getByOrderId,
  updateEvidence,
};