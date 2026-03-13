const express = require('express');

const healthRouter = require('./routes/health');
const dashboardRouter = require('./routes/dashboard');
const quotesRouter = require('./routes/quotes');
const casesRouter = require('./routes/cases');
const customersRouter = require('./routes/customers');
const importQuotesRouter = require('./routes/importQuotes');
const legacyRouter = require('./api');

const router = express.Router();

const extractedPrefixes = [
  '/health',
  '/dashboard',
  '/quotes',
  '/cases',
  '/customers',
  '/import',
];

function isExtractedPath(pathname) {
  return extractedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

router.use(healthRouter);
router.use(dashboardRouter);
router.use(quotesRouter);
router.use(casesRouter);
router.use(customersRouter);
router.use(importQuotesRouter);

router.use((req, res, next) => {
  if (isExtractedPath(req.path)) {
    return next();
  }
  return legacyRouter(req, res, next);
});

module.exports = router;
