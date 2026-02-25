/**
 * server.js — Entry Point
 *
 * npm run dev    → development (nodemon)
 * npm start      → production
 */

require('dotenv').config();

const express       = require('express');
const connectDB     = require('./config/db');
const webhookRoutes = require('./routes/webhook.routes');
const apiRoutes     = require('./routes/api.routes');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Routes ────────────────────────────────────────────────────────────────
// NOTE: No global express.json() — webhook routes handle their own body parsing
// via rawBody middleware (required for HMAC signature verification).
// api.routes.js uses express.json() scoped to /api only.

app.get('/health', (req, res) =>
  res.json({ status: 'ok', ts: new Date(), port: PORT })
);

app.use('/api',     apiRoutes);
app.use('/webhook', webhookRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────
(async () => {
  await connectDB();

  app.listen(PORT, () => {
    const base = process.env.BASE_URL || `http://localhost:${PORT}`;
    console.log(`\n[Server] Running on port ${PORT}\n`);
    console.log('── Management API ───────────────────────────────');
    console.log(`  POST   ${base}/api/companies               ← Register company`);
    console.log(`  GET    ${base}/api/companies/me             ← Company info`);
    console.log(`  POST   ${base}/api/merchants               ← Add merchant + get callback URL`);
    console.log(`  GET    ${base}/api/merchants               ← List merchants`);
    console.log(`  GET    ${base}/api/transactions            ← Query transactions`);
    console.log('\n── Webhook Receiver ────────────────────────────');
    console.log(`  POST   ${base}/webhook/:gateway/:companySlug/:merchantId`);
    console.log(`  e.g.   ${base}/webhook/razorpay/acme-ltd/rzp_live_abc123`);
    console.log(`  e.g.   ${base}/webhook/cashfree/acme-ltd/CF_APP_456\n`);
  });
})();