const express = require("express");

const { asyncHandler } = require("../../utils/http");
const { requireAuthAuto } = require("../../middlewares/auth");
const quoteService = require("../../services/quoteService");

const router = express.Router();

router.get(
  "/quotes",
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const quotes = await quoteService.listQuotes(req.query || {});
    res.status(200).json({ quotes });
  })
);

router.post(
  "/quotes",
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const quote = await quoteService.createQuote(req.user, req.body || {});
    res.status(201).json({ quote });
  })
);

router.get(
  "/quotes/:id",
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const quote = await quoteService.getQuoteById(Number(req.params.id));
    res.status(200).json({ quote });
  })
);

router.patch(
  "/quotes/:id",
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const quote = await quoteService.updateQuote(Number(req.params.id), req.user, req.body || {});
    res.status(200).json({ quote });
  })
);

module.exports = router;
