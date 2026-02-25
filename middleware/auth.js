/**
 * authMiddleware
 * ──────────────
 * Validates the platform API key sent in the Authorization header.
 *
 * Header format:  Authorization: Bearer pk_live_xxxxxxxx
 *
 * Attaches req.company to the request on success.
 */

const Company = require('../models/Company');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header. Use: Bearer <api_key>' });
  }

  const apiKey = authHeader.slice(7).trim();

  if (!apiKey.startsWith('pk_live_') && !apiKey.startsWith('pk_test_')) {
    return res.status(401).json({ error: 'Invalid API key format' });
  }

  try {
    const company = await Company.findByApiKey(apiKey);
    if (!company) {
      return res.status(401).json({ error: 'Invalid or inactive API key' });
    }
    req.company = company;
    next();
  } catch (err) {
    console.error('[Auth] Error:', err.message);
    res.status(500).json({ error: 'Auth check failed' });
  }
};

module.exports = authMiddleware;