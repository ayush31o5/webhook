/**
 * Razorpay Evidence Service
 * ─────────────────────────
 * Handles the 2-step Razorpay dispute evidence flow:
 *
 * STEP 1 — Upload file to Razorpay Documents API
 *   POST https://api.razorpay.com/v1/documents
 *   Auth: Basic (key_id:key_secret)
 *   Content-Type: multipart/form-data
 *   Body: { file: <binary>, purpose: "dispute_evidence" }
 *   Response: { id: "doc_xxx", entity: "document", purpose: "dispute_evidence",
 *               name: "...", mime_type: "...", size: 2863, created_at: 1590604200 }
 *
 * STEP 2 — Contest the dispute (draft or submit)
 *   PATCH https://api.razorpay.com/v1/disputes/:disputeId/contest
 *   Auth: Basic
 *   Content-Type: application/json
 *   Body:
 *   {
 *     action: "draft" | "submit",    ← submit = sends to bank, triggers under_review
 *     amount: 39000,                 ← paise, optional (defaults to full dispute amount)
 *     summary: "Goods delivered...", ← explanation (max 1000 chars)
 *     shipping_proof:             ["doc_xxx", "doc_yyy"],
 *     billing_proof:              ["doc_xxx"],
 *     cancellation_proof:         [],
 *     customer_communication:     [],
 *     proof_of_service:           [],
 *     explanation_letter:         [],
 *     refund_confirmation:        [],
 *     access_activity_log:        [],
 *     refund_cancellation_policy: [],
 *     term_and_conditions:        [],
 *     others: [{ type: "receipt_signed_by_customer", document_ids: ["doc_xxx"] }]
 *   }
 *
 * NOTE: key_id and key_secret are the Razorpay API keys (not the webhook secret).
 *       These are DIFFERENT from the webhookSecret stored in MerchantConfig.
 *       They need to be stored separately in MerchantConfig.credentials.
 *       (We'll prompt for them when adding the merchant if gateway = razorpay)
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const crypto  = require('crypto');

const RAZORPAY_API_BASE = 'api.razorpay.com';

/**
 * Upload a file to Razorpay Documents API.
 * Returns the doc_id (e.g. "doc_EsyWjHrfzb59Re").
 *
 * @param {string} filePath  - absolute path to the file on disk
 * @param {string} fileName  - original file name
 * @param {string} mimeType  - MIME type
 * @param {string} keyId     - Razorpay key_id
 * @param {string} keySecret - Razorpay key_secret (plaintext, decrypted before calling)
 * @returns {Promise<string>} doc_id
 */
async function uploadFileToRazorpay(filePath, fileName, mimeType, keyId, keySecret) {
  const fileBuffer = fs.readFileSync(filePath);

  // Build multipart/form-data manually (no axios/form-data needed)
  const boundary = `----RazorpayBoundary${crypto.randomBytes(8).toString('hex')}`;

  const purposePart =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="purpose"\r\n\r\n` +
    `dispute_evidence\r\n`;

  const fileHeader =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;

  const closing = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(purposePart),
    Buffer.from(fileHeader),
    fileBuffer,
    Buffer.from(closing),
  ]);

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: RAZORPAY_API_BASE,
        path:     '/v1/documents',
        method:   'POST',
        headers: {
          'Authorization':  `Basic ${auth}`,
          'Content-Type':   `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(`Razorpay Documents API error ${res.statusCode}: ${json.error?.description || data}`));
            } else {
              resolve(json.id);  // "doc_xxx"
            }
          } catch {
            reject(new Error(`Razorpay Documents API parse error: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Submit contest to Razorpay with all evidence doc IDs.
 *
 * @param {string} gatewayDisputeId   - e.g. "disp_EsIAlDcoUr8CaQ"
 * @param {object} contestPayload     - { action, amount, summary, shipping_proof, ... }
 * @param {string} keyId
 * @param {string} keySecret
 * @returns {Promise<object>} updated dispute entity from Razorpay
 */
async function submitContestToRazorpay(gatewayDisputeId, contestPayload, keyId, keySecret) {
  const body = JSON.stringify(contestPayload);
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: RAZORPAY_API_BASE,
        path:     `/v1/disputes/${gatewayDisputeId}/contest`,
        method:   'PATCH',
        headers: {
          'Authorization':  `Basic ${auth}`,
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(`Razorpay contest error ${res.statusCode}: ${json.error?.description || data}`));
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error(`Razorpay contest parse error: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { uploadFileToRazorpay, submitContestToRazorpay };