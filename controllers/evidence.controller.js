/**
 * Evidence Controller
 * ───────────────────
 * Full lifecycle management of dispute proof documents.
 *
 * ── What merchants actually upload in real cases ──────────────────────────
 *
 * shipping_proof
 *   Real case: Customer says "item not received"
 *   Submit: Screenshot of Delhivery/BlueDart tracking showing "Delivered"
 *           + courier AWB PDF + photo of signed delivery slip
 *   Format: PNG/JPG screenshot, PDF of courier receipt
 *
 * billing_proof
 *   Real case: Customer says "I never ordered this"
 *   Submit: Invoice PDF with customer's name/address, order confirmation email
 *           screenshot, GST invoice
 *   Format: PDF invoice, JPG/PNG of order email screenshot
 *
 * customer_communication
 *   Real case: Customer claims they asked for refund and didn't get it
 *   Submit: WhatsApp/email thread screenshot showing customer confirmed receipt,
 *           or support chat where issue was resolved
 *   Format: PNG screenshots of chat/email
 *
 * proof_of_service
 *   Real case: SaaS — customer says service wasn't provided
 *   Submit: Server access logs PDF, screenshot of customer's active session,
 *           usage analytics export
 *   Format: PDF logs, PNG dashboard screenshots
 *
 * cancellation_proof
 *   Real case: Customer says they cancelled but was still charged
 *   Submit: Screenshot showing cancellation was NOT requested before charge,
 *           or that cancellation policy prevents refund
 *   Format: PNG of dashboard/portal screenshot
 *
 * explanation_letter
 *   Real case: Customer disputes a recurring charge
 *   Submit: Written text explaining the subscription terms, why charge is valid
 *   Format: TEXT → we generate PDF automatically
 *
 * refund_confirmation
 *   Real case: Customer disputes payment but refund was already processed
 *   Submit: Bank reference number PDF, refund transaction screenshot
 *   Format: PDF or PNG
 *
 * access_activity_log
 *   Real case: Digital goods/software — customer says they didn't use it
 *   Submit: Server logs showing customer IP accessed the service after purchase
 *   Format: PDF of exported logs, or plain text → auto-converted to PDF
 *
 * refund_cancellation_policy
 *   Real case: Any dispute where terms matter
 *   Submit: Screenshot/PDF of published refund policy page on website
 *   Format: PDF, PNG
 *
 * term_and_conditions
 *   Real case: Chargeback for subscription/auto-debit
 *   Submit: Signed T&C or checkout screenshot showing customer agreed
 *   Format: PDF, PNG
 *
 * ── Routes ────────────────────────────────────────────────────────────────
 *
 * POST   /api/disputes/:id/evidence/upload     Upload a file or text note
 * GET    /api/disputes/:id/evidence            List all evidence for a dispute
 * DELETE /api/disputes/:id/evidence/:eid       Remove an evidence file
 * POST   /api/disputes/:id/evidence/submit     Push all evidence to gateway
 * GET    /api/disputes/:id/evidence/summary    Full submission-ready summary
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const Dispute         = require('../models/Dispute');
const DisputeEvidence = require('../models/DisputeEvidence');
const MerchantConfig  = require('../models/MerchantConfig');
const { decrypt }     = require('../config/encryption');

const { uploadFileToRazorpay, submitContestToRazorpay }   = require('../services/razorpay.evidence.service');
const { uploadFileToCashfree, submitDisputeToCashfree }   = require('../services/cashfree.evidence.service');

const { EVIDENCE_TYPES } = require('../models/DisputeEvidence');

// ── POST /api/disputes/:id/evidence/upload ────────────────────────────────

const uploadEvidence = async (req, res) => {
  const dispute = await Dispute.findOne({ _id: req.params.id, companyId: req.company._id });
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  if (['won', 'lost', 'closed'].includes(dispute.status))
    return res.status(400).json({ error: `Dispute is already ${dispute.status} — cannot add evidence` });

  const { evidenceType, note, textContent } = req.body;

  if (!evidenceType || !EVIDENCE_TYPES.includes(evidenceType))
    return res.status(400).json({ error: `evidenceType required. Must be one of: ${EVIDENCE_TYPES.join(', ')}` });

  let filePath, originalName, mimeType, sizeBytes;

  // ── TEXT content → write to temp file (plain .txt stored on disk) ────────
  if (textContent && !req.file) {
    if (typeof textContent !== 'string' || textContent.trim().length < 10)
      return res.status(400).json({ error: 'textContent must be at least 10 characters' });

    const uploadDir = path.join(process.cwd(), 'uploads', 'dispute-evidence', req.company.slug, req.params.id);
    fs.mkdirSync(uploadDir, { recursive: true });

    originalName = `${evidenceType}_${Date.now()}.txt`;
    filePath     = path.join(uploadDir, originalName);
    mimeType     = 'text/plain';

    // Write formatted text file with metadata header
    const fileContent = [
      `DISPUTE EVIDENCE — ${evidenceType.toUpperCase().replace(/_/g, ' ')}`,
      `Dispute ID   : ${dispute.gatewayDisputeId}`,
      `Gateway      : ${dispute.gateway.toUpperCase()}`,
      `Order ID     : ${dispute.orderId || 'N/A'}`,
      `Submitted by : ${req.company.name}`,
      `Date         : ${new Date().toISOString()}`,
      '',
      '─'.repeat(60),
      '',
      textContent.trim(),
    ].join('\n');

    fs.writeFileSync(filePath, fileContent, 'utf8');
    sizeBytes = Buffer.byteLength(fileContent, 'utf8');
  }

  // ── FILE upload (image/pdf) ────────────────────────────────────────────
  else if (req.file) {
    filePath     = req.file.path;
    originalName = req.file.originalname;
    mimeType     = req.file.mimetype;
    sizeBytes    = req.file.size;

    // Cashfree: 5MB limit
    if (dispute.gateway === 'cashfree' && sizeBytes > 5 * 1024 * 1024)
      return res.status(400).json({ error: 'Cashfree max file size is 5MB' });
  }

  else {
    return res.status(400).json({ error: 'Provide either a file upload (multipart) or textContent in request body' });
  }

  // Save evidence record
  const evidence = await DisputeEvidence.create({
    companyId:        req.company._id,
    disputeId:        dispute._id,
    gatewayDisputeId: dispute.gatewayDisputeId,
    gateway:          dispute.gateway,
    merchantId:       dispute.merchantId,
    evidenceType,
    originalName,
    mimeType,
    sizeBytes,
    localPath:    filePath,
    uploadStatus: 'pending',
    note:         note || null,
  });

  return res.status(201).json({
    message:  'Evidence saved. Call /submit when ready to send to gateway.',
    evidence: sanitizeEvidence(evidence),
    nextStep: getNextStep(dispute.gateway, dispute.gatewayDisputeId),
  });
};

// ── GET /api/disputes/:id/evidence ────────────────────────────────────────

const listEvidence = async (req, res) => {
  const dispute = await Dispute.findOne({ _id: req.params.id, companyId: req.company._id });
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  const evidences = await DisputeEvidence.find({ disputeId: dispute._id }).lean();

  // Group by evidenceType for easy reading
  const grouped = {};
  for (const e of evidences) {
    if (!grouped[e.evidenceType]) grouped[e.evidenceType] = [];
    grouped[e.evidenceType].push(sanitizeEvidence(e));
  }

  const pending   = evidences.filter(e => e.uploadStatus === 'pending').length;
  const uploaded  = evidences.filter(e => e.uploadStatus === 'gateway_uploaded').length;
  const submitted = evidences.filter(e => e.uploadStatus === 'submitted').length;

  return res.json({
    dispute: {
      id:               dispute._id,
      gatewayDisputeId: dispute.gatewayDisputeId,
      gateway:          dispute.gateway,
      status:           dispute.status,
      respondBy:        dispute.respondBy,
      hoursLeft:        dispute.respondBy
        ? Math.max(0, Math.round((new Date(dispute.respondBy) - new Date()) / 3600000))
        : null,
    },
    counts:  { total: evidences.length, pending, gateway_uploaded: uploaded, submitted },
    grouped,
    readyToSubmit: pending === 0 && uploaded > 0,
  });
};

// ── DELETE /api/disputes/:id/evidence/:eid ────────────────────────────────

const deleteEvidence = async (req, res) => {
  const evidence = await DisputeEvidence.findOne({
    _id:       req.params.eid,
    disputeId: req.params.id,
    companyId: req.company._id,
  }).select('+localPath');

  if (!evidence) return res.status(404).json({ error: 'Evidence not found' });

  if (evidence.uploadStatus === 'submitted')
    return res.status(400).json({ error: 'Cannot delete — already submitted to gateway' });

  // Delete local file
  if (evidence.localPath && fs.existsSync(evidence.localPath)) {
    try { fs.unlinkSync(evidence.localPath); } catch (_) {}
  }

  await evidence.deleteOne();
  return res.json({ message: 'Evidence deleted', id: req.params.eid });
};

// ── POST /api/disputes/:id/evidence/submit ────────────────────────────────

const submitEvidence = async (req, res) => {
  const dispute = await Dispute.findOne({ _id: req.params.id, companyId: req.company._id });
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  if (['won', 'lost', 'closed'].includes(dispute.status))
    return res.status(400).json({ error: `Dispute is ${dispute.status} — cannot submit evidence` });

  if (!['razorpay', 'cashfree', 'payu'].includes(dispute.gateway))
    return res.status(400).json({ error: `${dispute.gateway} does not support programmatic dispute submission` });

  // Load merchant config for API credentials
  const config = await MerchantConfig
    .findOne({ gateway: dispute.gateway, companySlug: dispute.companySlug, merchantId: dispute.merchantId, isActive: true })
    .select('+credentials').lean();

  if (!config) return res.status(400).json({ error: 'Merchant config not found — cannot submit' });

  if (dispute.gateway === 'razorpay') return submitRazorpay(req, res, dispute, config);
  if (dispute.gateway === 'cashfree') return submitCashfree(req, res, dispute, config);
  if (dispute.gateway === 'payu')     return submitPayU(req, res, dispute);
};

// ── RAZORPAY submit flow ──────────────────────────────────────────────────

async function submitRazorpay(req, res, dispute, config) {
  const { summary, action = 'submit' } = req.body;

  if (!summary || summary.trim().length < 20)
    return res.status(400).json({ error: 'summary is required (min 20 chars) — explain why this dispute is invalid' });

  if (!['draft', 'submit'].includes(action))
    return res.status(400).json({ error: 'action must be "draft" or "submit"' });

  const keyId     = decrypt(config.credentials.keyId);
  const keySecret = decrypt(config.credentials.keySecret);

  // Load all pending evidence for this dispute
  const evidences = await DisputeEvidence.find({
    disputeId:    dispute._id,
    uploadStatus: { $in: ['pending', 'gateway_uploaded'] },
  }).select('+localPath');

  if (!evidences.length)
    return res.status(400).json({ error: 'No evidence files found. Upload at least one file first.' });

  const results  = { uploaded: [], failed: [] };

  // Step 1: Upload each file to Razorpay Documents API
  for (const ev of evidences) {
    if (ev.uploadStatus === 'gateway_uploaded') {
      results.uploaded.push({ id: ev._id, originalName: ev.originalName, gatewayDocId: ev.gatewayDocId });
      continue;
    }

    try {
      const filePath = ev.localPath;
      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error(`File not found on disk: ${ev.originalName}`);
      }

      // Razorpay accepts image/* and application/pdf
      // text/plain is not accepted — wrap as PDF (simple approach)
      let uploadPath = filePath;
      let uploadMime = ev.mimeType;
      if (ev.mimeType === 'text/plain') {
        uploadPath = wrapTextAsPdf(filePath, ev.originalName);
        uploadMime = 'application/pdf';
      }

      const docId = await uploadFileToRazorpay(uploadPath, ev.originalName.replace('.txt', '.pdf'), uploadMime, keyId, keySecret);

      await DisputeEvidence.updateOne({ _id: ev._id }, {
        gatewayDocId: docId,
        uploadStatus: 'gateway_uploaded',
        uploadError:  null,
      });

      results.uploaded.push({ id: ev._id, originalName: ev.originalName, gatewayDocId: docId });
    } catch (err) {
      await DisputeEvidence.updateOne({ _id: ev._id }, {
        uploadStatus: 'gateway_failed',
        uploadError:  err.message,
      });
      results.failed.push({ id: ev._id, originalName: ev.originalName, error: err.message });
    }
  }

  if (results.failed.length && !results.uploaded.length)
    return res.status(502).json({ error: 'All file uploads to Razorpay failed', details: results.failed });

  // Step 2: Build contest payload grouped by evidenceType
  const allUploaded = await DisputeEvidence.find({
    disputeId: dispute._id, uploadStatus: 'gateway_uploaded',
  });

  const contestPayload = { action, summary: summary.trim() };

  for (const ev of allUploaded) {
    const field = ev.evidenceType;  // already matches Razorpay field names exactly
    if (!contestPayload[field]) contestPayload[field] = [];
    contestPayload[field].push(ev.gatewayDocId);
  }

  try {
    const rzpResponse = await submitContestToRazorpay(dispute.gatewayDisputeId, contestPayload, keyId, keySecret);

    // Mark all as submitted
    await DisputeEvidence.updateMany(
      { disputeId: dispute._id, uploadStatus: 'gateway_uploaded' },
      { uploadStatus: 'submitted', submittedAt: new Date() }
    );

    // Update dispute status
    await Dispute.updateOne({ _id: dispute._id }, {
      status:                'under_review',
      'evidence.summary':    summary,
      'evidence.submittedAt': new Date(),
    });

    return res.json({
      message:      action === 'submit' ? 'Evidence submitted to Razorpay. Dispute is now under review.' : 'Evidence saved as draft on Razorpay.',
      uploadResults: results,
      razorpayResponse: rzpResponse,
    });
  } catch (err) {
    return res.status(502).json({ error: `Razorpay contest submission failed: ${err.message}`, uploadResults: results });
  }
}

// ── CASHFREE submit flow ──────────────────────────────────────────────────

async function submitCashfree(req, res, dispute, config) {
  const clientSecret = decrypt(config.credentials.clientSecret);
  const clientId     = decrypt(config.credentials.clientId || '');

  const evidences = await DisputeEvidence.find({
    disputeId:    dispute._id,
    uploadStatus: { $in: ['pending', 'gateway_uploaded'] },
  }).select('+localPath');

  if (!evidences.length)
    return res.status(400).json({ error: 'No evidence files found. Upload files first.' });

  const results = { uploaded: [], failed: [] };

  // Step 1: Upload each file
  for (const ev of evidences) {
    if (ev.uploadStatus === 'gateway_uploaded') {
      results.uploaded.push({ id: ev._id, originalName: ev.originalName, gatewayDocId: ev.gatewayDocId });
      continue;
    }
    try {
      const filePath = ev.localPath;
      if (!filePath || !fs.existsSync(filePath)) throw new Error(`File not found: ${ev.originalName}`);

      let uploadPath = filePath;
      let uploadMime = ev.mimeType;
      if (ev.mimeType === 'text/plain') {
        uploadPath = wrapTextAsPdf(filePath, ev.originalName);
        uploadMime = 'application/pdf';
      }

      const cfDocType = DisputeEvidence.toCashfreeDocType(ev.evidenceType);
      const docId     = await uploadFileToCashfree(
        dispute.gatewayDisputeId, uploadPath,
        ev.originalName.replace('.txt', '.pdf'),
        uploadMime, cfDocType, clientId, clientSecret
      );

      await DisputeEvidence.updateOne({ _id: ev._id }, { gatewayDocId: docId, uploadStatus: 'gateway_uploaded', uploadError: null });
      results.uploaded.push({ id: ev._id, originalName: ev.originalName, gatewayDocId: docId });
    } catch (err) {
      await DisputeEvidence.updateOne({ _id: ev._id }, { uploadStatus: 'gateway_failed', uploadError: err.message });
      results.failed.push({ id: ev._id, originalName: ev.originalName, error: err.message });
    }
  }

  if (results.failed.length && !results.uploaded.length)
    return res.status(502).json({ error: 'All Cashfree uploads failed', details: results.failed });

  // Step 2: Submit
  try {
    const cfResponse = await submitDisputeToCashfree(dispute.gatewayDisputeId, clientId, clientSecret);

    await DisputeEvidence.updateMany(
      { disputeId: dispute._id, uploadStatus: 'gateway_uploaded' },
      { uploadStatus: 'submitted', submittedAt: new Date() }
    );

    await Dispute.updateOne({ _id: dispute._id }, { status: 'under_review', 'evidence.submittedAt': new Date() });

    return res.json({ message: 'Evidence submitted to Cashfree.', uploadResults: results, cashfreeResponse: cfResponse });
  } catch (err) {
    return res.status(502).json({ error: `Cashfree submit failed: ${err.message}`, uploadResults: results });
  }
}

// ── PAYU — no API, return download package info ───────────────────────────

async function submitPayU(req, res, dispute) {
  const evidences = await DisputeEvidence.find({ disputeId: dispute._id }).lean();

  if (!evidences.length)
    return res.status(400).json({ error: 'No evidence files uploaded yet.' });

  return res.json({
    message:   'PayU does not have a programmatic dispute evidence API.',
    manualSteps: [
      '1. Log in to PayU Dashboard → Reports → Chargebacks',
      `2. Find chargeback ID: ${dispute.gatewayDisputeId}`,
      '3. Click "Respond" or "Upload Documents"',
      '4. Upload each file listed below',
      `5. Deadline: ${dispute.respondBy ? new Date(dispute.respondBy).toDateString() : 'Check PayU dashboard'}`,
    ],
    filesUploadedToOurPlatform: evidences.map(e => ({
      evidenceType: e.evidenceType,
      fileName:     e.originalName,
      mimeType:     e.mimeType,
      sizeBytes:    e.sizeBytes,
      uploadedAt:   e.createdAt,
    })),
    downloadNote: 'Contact your platform admin to download these files for manual PayU submission.',
  });
}

// ── GET /api/disputes/:id/evidence/summary ────────────────────────────────

const getEvidenceSummary = async (req, res) => {
  const dispute  = await Dispute.findOne({ _id: req.params.id, companyId: req.company._id });
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  const evidences = await DisputeEvidence.find({ disputeId: dispute._id }).lean();

  const byType = {};
  for (const e of evidences) {
    if (!byType[e.evidenceType]) byType[e.evidenceType] = [];
    byType[e.evidenceType].push({
      fileName:     e.originalName,
      mimeType:     e.mimeType,
      status:       e.uploadStatus,
      gatewayDocId: e.gatewayDocId,
      note:         e.note,
      uploadedAt:   e.createdAt,
    });
  }

  const allSubmitted = evidences.length > 0 && evidences.every(e => e.uploadStatus === 'submitted');

  return res.json({
    dispute: {
      gatewayDisputeId: dispute.gatewayDisputeId,
      gateway:          dispute.gateway,
      status:           dispute.status,
      reasonCode:       dispute.reasonCode,
      reasonDescription:dispute.reasonDescription,
      disputeAmount:    dispute.disputeAmount,
      respondBy:        dispute.respondBy,
      hoursLeft:        dispute.respondBy
        ? Math.max(0, Math.round((new Date(dispute.respondBy) - new Date()) / 3600000))
        : null,
    },
    evidenceSummary:  byType,
    totalFiles:       evidences.length,
    allSubmitted,
    submittedAt:      dispute.evidence?.submittedAt || null,
    whatToUploadNext: getWhatToUploadNext(dispute, evidences),
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────

function sanitizeEvidence(e) {
  const obj = e.toObject ? e.toObject() : { ...e };
  delete obj.localPath;  // never return disk path
  return obj;
}

function getNextStep(gateway, gatewayDisputeId) {
  const map = {
    razorpay: `When all files are uploaded, call POST /api/disputes/:id/evidence/submit with { "summary": "...", "action": "submit" }`,
    cashfree: `When all files are uploaded, call POST /api/disputes/:id/evidence/submit`,
    payu:     `PayU has no API. After uploading files here, call POST /api/disputes/:id/evidence/submit to get manual submission instructions.`,
  };
  return map[gateway] || '';
}

/**
 * Smart suggestions: based on dispute reason_code, suggest what to upload.
 * These are real chargeback reason codes and what banks actually want to see.
 */
function getWhatToUploadNext(dispute, existing) {
  const existingTypes = new Set(existing.map(e => e.evidenceType));

  const suggestions = REASON_CODE_SUGGESTIONS[dispute.reasonCode]
    || REASON_CODE_SUGGESTIONS[dispute.reasonDescription?.toLowerCase()]
    || DEFAULT_SUGGESTIONS;

  return suggestions
    .filter(s => !existingTypes.has(s.evidenceType))
    .map(s => ({
      evidenceType:  s.evidenceType,
      why:           s.why,
      acceptedFiles: 'image/jpeg, image/png, application/pdf, or plain text',
    }));
}

// Real reason codes → what to upload
const REASON_CODE_SUGGESTIONS = {
  // Razorpay reason codes
  'goods_or_services_not_received_or_partially_received': [
    { evidenceType: 'shipping_proof',         why: 'Courier tracking showing delivery with timestamp and recipient signature' },
    { evidenceType: 'billing_proof',          why: 'Order confirmation + GST invoice with customer details' },
    { evidenceType: 'customer_communication', why: 'Any WhatsApp/email where customer acknowledged receipt' },
  ],
  'non_matching_account_number': [
    { evidenceType: 'billing_proof',          why: 'Invoice showing correct payment account details' },
    { evidenceType: 'explanation_letter',     why: 'Written explanation of payment routing' },
  ],
  'processed_invalid_expired_card': [
    { evidenceType: 'billing_proof',          why: 'Payment receipt showing card was valid at time of transaction' },
    { evidenceType: 'access_activity_log',    why: 'Server logs showing successful card authorization' },
  ],
  // Cashfree reason codes
  '4855': [  // Goods/Services Not Provided
    { evidenceType: 'shipping_proof',         why: 'Proof of delivery or service completion' },
    { evidenceType: 'proof_of_service',       why: 'Screenshot/log showing service was rendered' },
    { evidenceType: 'customer_communication', why: 'Communication where customer confirmed receipt' },
  ],
  '4853': [  // Cardholder Dispute - Not as Described
    { evidenceType: 'billing_proof',          why: 'Original product description/listing at time of purchase' },
    { evidenceType: 'customer_communication', why: 'Pre-purchase communication about product details' },
    { evidenceType: 'explanation_letter',     why: 'Explanation of how product matches description' },
  ],
  '4837': [  // No Cardholder Authorization (Fraud)
    { evidenceType: 'access_activity_log',    why: 'IP address logs, device fingerprint, OTP verification records' },
    { evidenceType: 'customer_communication', why: 'Any contact with the cardholder that proves they placed the order' },
    { evidenceType: 'billing_proof',          why: 'Order confirmation sent to cardholder\'s registered email/phone' },
  ],
};

const DEFAULT_SUGGESTIONS = [
  { evidenceType: 'billing_proof',          why: 'Invoice or order confirmation proving the transaction was legitimate' },
  { evidenceType: 'shipping_proof',         why: 'Delivery proof if physical goods were involved' },
  { evidenceType: 'customer_communication', why: 'Any customer interaction proving they authorized the purchase' },
  { evidenceType: 'explanation_letter',     why: 'Written explanation of why this chargeback is invalid' },
];

/**
 * Convert a plain text file into a minimal PDF.
 * Returns path to the created PDF file.
 * Uses no external libraries — writes raw PDF bytes manually.
 */
function wrapTextAsPdf(textFilePath, originalName) {
  const text    = fs.readFileSync(textFilePath, 'utf8');
  const pdfPath = textFilePath.replace(/\.txt$/, '.pdf');

  // Split into lines (max 80 chars per line for readability)
  const rawLines = text.split('\n');
  const lines    = [];
  for (const line of rawLines) {
    if (line.length <= 80) { lines.push(line); continue; }
    for (let i = 0; i < line.length; i += 80) lines.push(line.slice(i, i + 80));
  }

  // Escape PDF special characters
  const escaped = lines.map(l =>
    l.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  );

  // Build PDF manually (PDF 1.4 minimal structure)
  const fontObj    = '1 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n';
  const lineHeight = 14;
  const marginX    = 50;
  const pageHeight = 842;  // A4
  const pageWidth  = 595;
  const linesPerPage = Math.floor((pageHeight - 100) / lineHeight);

  const pages = [];
  for (let i = 0; i < escaped.length; i += linesPerPage) {
    pages.push(escaped.slice(i, i + linesPerPage));
  }

  const contentStreams = [];
  for (const pageLines of pages) {
    let stream = `BT\n/F1 10 Tf\n${lineHeight} TL\n${marginX} ${pageHeight - 50} Td\n`;
    for (const line of pageLines) stream += `(${line}) Tj T*\n`;
    stream += 'ET';
    contentStreams.push(stream);
  }

  // Build minimal valid PDF
  const objOffset = [0];
  const objects   = [`%PDF-1.4\n`, fontObj];
  let bytePos     = objects[0].length;

  const offsets = [bytePos];
  bytePos += objects[1].length;

  const pageObjNums = [];
  for (let i = 0; i < contentStreams.length; i++) {
    const stream  = contentStreams[i];
    const streamObj = `${2 + i * 2} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`;
    const pageObj   = `${3 + i * 2} 0 obj\n<< /Type /Page /Parent 1000 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${2 + i * 2} 0 R /Resources << /Font << /F1 1 0 R >> >> >>\nendobj\n`;
    objects.push(streamObj, pageObj);
    pageObjNums.push(3 + i * 2);
  }

  const pageRefs  = pageObjNums.map(n => `${n} 0 R`).join(' ');
  const pagesObj  = `1000 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${pageObjNums.length} >>\nendobj\n`;
  const catalogObj = `1001 0 obj\n<< /Type /Catalog /Pages 1000 0 R >>\nendobj\n`;
  objects.push(pagesObj, catalogObj);

  const pdf = objects.join('');
  fs.writeFileSync(pdfPath, pdf);
  return pdfPath;
}

module.exports = { uploadEvidence, listEvidence, deleteEvidence, submitEvidence, getEvidenceSummary };