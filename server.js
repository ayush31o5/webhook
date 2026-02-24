/**
 * server.js — Entry Point
 *
 * Start: node server.js
 * Dev:   nodemon server.js
 */

require('dotenv').config();

const express       = require('express');
const connectDB     = require('./config/db');
const webhookRoutes = require('./routes/webhook.routes');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Global middleware ─────────────────────────────────────────────────────────
// NOTE: We do NOT use express.json() or express.urlencoded() globally.
// The rawBody middleware in webhook.routes.js handles parsing per-request
// because signature verification requires the raw bytes.

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));
app.use('/webhook', webhookRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
(async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
    console.log(`[Server] Webhook URLs:`);
    console.log(`  POST http://localhost:${PORT}/webhook/razorpay/:merchantId`);
    console.log(`  POST http://localhost:${PORT}/webhook/cashfree/:merchantId`);
    console.log(`  POST http://localhost:${PORT}/webhook/payu/:merchantId`);
    console.log(`  POST http://localhost:${PORT}/webhook/phonepe/:merchantId`);
    console.log(`  POST http://localhost:${PORT}/webhook/ccavenue/:merchantId`);
  });
})();