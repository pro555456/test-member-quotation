const express = require("express");

const { asyncHandler } = require("../../utils/http");
const { requireAuthAuto } = require("../../middlewares/auth");
const quoteService = require("../../services/quoteService");

const router = express.Router();

router.get(
  "/cases",
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const cases = await quoteService.listCases(req.query || {});
    res.status(200).json({ cases });
  })
);

router.patch(
  "/cases/:id/status",
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const quote = await quoteService.updateCaseStatus(Number(req.params.id), req.user, req.body || {});
    res.status(200).json({ quote });
  })
);

module.exports = router;
