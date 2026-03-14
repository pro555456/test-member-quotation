const express = require('express');

const { asyncHandler } = require('../../utils/http');
const { requireAuthAuto } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const quoteService = require('../../services/quoteService');

const router = express.Router();

router.get(
  '/quotes',
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const quotes = await quoteService.listQuotes(req.query || {});
    res.status(200).json({ quotes });
  })
);

router.post(
  '/quotes',
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const quote = await quoteService.createQuote(req.user, req.body || {});
    res.status(201).json({ quote });
  })
);

router.get(
  '/quotes/:id',
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const quote = await quoteService.getQuoteById(Number(req.params.id));
    res.status(200).json({ quote });
  })
);

router.patch(
  '/quotes/:id',
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const quote = await quoteService.updateQuote(Number(req.params.id), req.user, req.body || {});
    res.status(200).json({ quote });
  })
);

router.get(
  '/quotes/:id/pdf',
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const { quote, attachment } = await quoteService.generateQuotePdf(Number(req.params.id), req.user);
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${attachment.fileName}"`);
    res.setHeader('Content-Length', String(attachment.fileSize || attachment.buffer?.length || 0));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Quote-Internal-Order-No', quote.internalOrderNo || '');
    res.setHeader('X-Quotation-No', quote.quotationNo || quote.quoteNo || '');
    return res.end(attachment.buffer);
  })
);

router.post(
  '/quotes/:id/send',
  requireAuthAuto,
  requirePermission('quote:send'),
  asyncHandler(async (req, res) => {
    const result = await quoteService.sendQuote(Number(req.params.id), req.user, req.body || {});
    res.status(200).json({ result });
  })
);

router.get(
  '/quotes/:id/send-logs',
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const logs = await quoteService.listQuoteSendLogs(Number(req.params.id));
    res.status(200).json({ logs });
  })
);

module.exports = router;
