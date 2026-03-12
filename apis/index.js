const express = require('express');

const healthRouter = require('./routes/health');
const dashboardRouter = require('./routes/dashboard');
const quotesRouter = require('./routes/quotes');
const casesRouter = require('./routes/cases');
const importQuotesRouter = require('./routes/importQuotes');
const legacyRouter = require('./api');

const router = express.Router();

const extractedPrefixes = [
  '/health',
  '/dashboard',
  '/quotes',
  '/cases',
  '/import',
];

function isExtractedPath(pathname) {
  return extractedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

router.use(healthRouter);
router.use(dashboardRouter);
router.use(quotesRouter);
router.use(casesRouter);
router.use(importQuotesRouter);

router.use((req, res, next) => {
  if (isExtractedPath(req.path)) {
    return next();
  }
  return legacyRouter(req, res, next);
});

module.exports = router;
