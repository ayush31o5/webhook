/**
 * Cashfree Evidence Service
 * ─────────────────────────
 * Handles Cashfree dispute evidence submission flow:
 *
 * STEP 1 — Upload document to dispute
 *   POST https://api.cashfree.com/pg/disputes/:disputeId/documents
 *   Headers: x-client-id, x-client-secret, x-api-version: 2023-08-01
 *   Content-Type: multipart/form-data
 *   Body: { file: <binary>, document_type: "DeliveryProof" }
 *   Response: {
 *     document_id:   18150,
 *     document_name: "disputeSampleFile.pdf",
 *     document_type: "DeliveryProof"
 *   }
 *
 * STEP 2 — Submit all attached documents
 *   POST https://api.cashfree.com/pg/disputes/:disputeId/submit
 *   Headers: x-client-id, x-client-secret, x-api-version: 2023-08-01
 *   Body: (empty — submits all documents attached to the dispute)
 *   Response: { message: "Dispute submitted successfully" }
 *
 * Accepted document_type values:
 *   DeliveryProof | BillingProof | CancellationProof | CustomerCommunication |
 *   ProofOfService | ExplanationLetter | RefundConfirmation | AccessActivityLog |
 *   RefundCancellationPolicy | TermsAndConditions | Others
 *
 * Note: Cashfree sandbox URL: https://sandbox.cashfree.com/pg/disputes/...
 *       Production URL:        https://api.cashfree.com/pg/disputes/...
 *       Controlled by NODE_ENV.
 */

const fs     = require('fs');
const crypto = require('crypto');
const https  = require('https');

const CF_API_VERSION = '2023-08-01';

function getCashfreeHost() {
  return process.env.NODE_ENV === 'production'
    ? 'api.cashfree.com'
    : 'sandbox.cashfree.com';
}

/**
 * Upload a file to Cashfree dispute documents.
 * Returns the document_id (numeric).
 *
 * @param {string} gatewayDisputeId  - Cashfree dispute_id (numeric string)
 * @param {string} filePath
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} documentType      - Cashfree document type e.g. "DeliveryProof"
 * @param {string} clientId          - x-client-id (plaintext, decrypted)
 * @param {string} clientSecret      - x-client-secret (plaintext, decrypted)
 * @returns {Promise<string>} document_id as string
 */
async function uploadFileToCashfree(gatewayDisputeId, filePath, fileName, mimeType, documentType, clientId, clientSecret) {
  const fileBuffer = fs.readFileSync(filePath);
  const boundary   = `----CashfreeBoundary${crypto.randomBytes(8).toString('hex')}`;

  const docTypePart =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="document_type"\r\n\r\n` +
    `${documentType}\r\n`;

  const fileHeader =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;

  const closing = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(docTypePart),
    Buffer.from(fileHeader),
    fileBuffer,
    Buffer.from(closing),
  ]);

  const host = getCashfreeHost();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path:     `/pg/disputes/${gatewayDisputeId}/documents`,
        method:   'POST',
        headers: {
          'x-client-id':     clientId,
          'x-client-secret': clientSecret,
          'x-api-version':   CF_API_VERSION,
          'Content-Type':    `multipart/form-data; boundary=${boundary}`,
          'Content-Length':  body.length,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200 && res.statusCode !== 201) {
              reject(new Error(`Cashfree document upload error ${res.statusCode}: ${JSON.stringify(json)}`));
            } else {
              resolve(String(json.document_id));
            }
          } catch {
            reject(new Error(`Cashfree document upload parse error: ${data}`));
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
 * Submit all attached documents to Cashfree for review.
 *
 * @param {string} gatewayDisputeId
 * @param {string} clientId
 * @param {string} clientSecret
 * @returns {Promise<object>}
 */
async function submitDisputeToCashfree(gatewayDisputeId, clientId, clientSecret) {
  const host = getCashfreeHost();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path:     `/pg/disputes/${gatewayDisputeId}/submit`,
        method:   'POST',
        headers: {
          'x-client-id':     clientId,
          'x-client-secret': clientSecret,
          'x-api-version':   CF_API_VERSION,
          'Content-Type':    'application/json',
          'Content-Length':  0,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(`Cashfree submit error ${res.statusCode}: ${JSON.stringify(json)}`));
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error(`Cashfree submit parse error: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

module.exports = { uploadFileToCashfree, submitDisputeToCashfree };