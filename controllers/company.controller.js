/**
 * Company Controller
 * ──────────────────
 * Handles company registration on the platform.
 *
 * POST /api/companies          → Register new company, get API key
 * GET  /api/companies/me       → Get own company info  (auth required)
 * POST /api/companies/rotate-key → Rotate API key      (auth required)
 */

const Company = require('../models/Company');

// ── POST /api/companies ────────────────────────────────────────────────────
const registerCompany = async (req, res) => {
  const { name, email, slug: customSlug } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  // Auto-generate slug if not provided
  const slug = customSlug
    ? customSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    : Company.slugify(name);

  // Check uniqueness
  const [slugExists, emailExists] = await Promise.all([
    Company.findOne({ slug }),
    Company.findOne({ email: email.toLowerCase() }),
  ]);

  if (slugExists) {
    return res.status(409).json({ error: `Slug "${slug}" already taken. Provide a custom slug.` });
  }
  if (emailExists) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  // Generate API key
  const { plaintext, hash, prefix } = Company.generateApiKey();

  const company = await Company.create({
    name,
    email: email.toLowerCase(),
    slug,
    apiKeyHash:   hash,
    apiKeyPrefix: prefix,
  });

  // Return plaintext ONCE — never stored in plain
  return res.status(201).json({
    message: 'Company registered. Save your API key — it will not be shown again.',
    company: {
      id:    company._id,
      name:  company.name,
      email: company.email,
      slug:  company.slug,
    },
    apiKey: plaintext,   // ← shown ONCE
    webhookBaseUrl: `${process.env.BASE_URL || 'https://yourplatform.com'}/webhook`,
  });
};

// ── GET /api/companies/me ──────────────────────────────────────────────────
const getCompany = async (req, res) => {
  const company = req.company;
  return res.json({
    id:            company._id,
    name:          company.name,
    email:         company.email,
    slug:          company.slug,
    apiKeyPrefix:  company.apiKeyPrefix,
    createdAt:     company.createdAt,
  });
};

// ── POST /api/companies/rotate-key ────────────────────────────────────────
const rotateApiKey = async (req, res) => {
  const { plaintext, hash, prefix } = Company.generateApiKey();

  await Company.findByIdAndUpdate(req.company._id, {
    apiKeyHash:   hash,
    apiKeyPrefix: prefix,
  });

  return res.json({
    message: 'API key rotated. Save your new key — it will not be shown again.',
    apiKey:  plaintext,
  });
};

module.exports = { registerCompany, getCompany, rotateApiKey };