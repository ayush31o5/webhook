/**
 * rawBody middleware
 * ─────────────────
 * Razorpay and Cashfree require the RAW request body (not parsed JSON)
 * to verify HMAC signatures. Express's json() middleware loses the raw bytes.
 *
 * This middleware captures req.rawBody before any parsing happens.
 * Must be applied BEFORE express.json() / express.urlencoded().
 */

const rawBody = (req, res, next) => {
  let data = '';
  req.setEncoding('utf8');

  req.on('data', (chunk) => {
    data += chunk;
  });

  req.on('end', () => {
    req.rawBody = data;

    // Now parse based on Content-Type so controllers still get req.body
    const contentType = req.headers['content-type'] || '';

    try {
      if (contentType.includes('application/json')) {
        req.body = data ? JSON.parse(data) : {};
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        // PayU and CCAvenue send form-encoded bodies
        req.body = Object.fromEntries(new URLSearchParams(data));
      } else {
        req.body = {};
      }
    } catch {
      req.body = {};
    }

    next();
  });

  req.on('error', (err) => {
    console.error('[rawBody] Stream error:', err.message);
    res.status(400).json({ error: 'Request read error' });
  });
};

module.exports = rawBody;