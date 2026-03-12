const express = require("express");

const { asyncHandler } = require("../../utils/http");
const { requireAuthAuto } = require("../../middlewares/auth");
const { requirePermission } = require("../../middlewares/rbac");
const dashboardService = require("../../services/dashboardService");
const adminAnalyticsService = require("../../services/adminAnalyticsService");

const router = express.Router();

router.get(
  "/dashboard/summary",
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const summary = await dashboardService.getSummary();
    res.status(200).json({ summary });
  })
);

router.get(
  "/dashboard/trends",
  requireAuthAuto,
  asyncHandler(async (req, res) => {
    const trends = await dashboardService.getTrends();
    res.status(200).json({ trends });
  })
);

router.get(
  "/dashboard/admin-analytics",
  requireAuthAuto,
  requirePermission("admin:access"),
  asyncHandler(async (req, res) => {
    const analytics = await adminAnalyticsService.getAdminAnalytics({
      period: req.query?.period,
      startDate: req.query?.startDate,
      endDate: req.query?.endDate,
    });
    res.status(200).json({ analytics });
  })
);

router.get(
  "/dashboard/admin-analytics/export/excel",
  requireAuthAuto,
  requirePermission("admin:access"),
  asyncHandler(async (req, res) => {
    const analytics = await adminAnalyticsService.getAdminAnalytics({
      period: req.query?.period,
      startDate: req.query?.startDate,
      endDate: req.query?.endDate,
    });

    res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${adminAnalyticsService.buildExcelFilename(analytics)}"`);
    res.status(200).send(`\uFEFF${adminAnalyticsService.buildExcelWorkbookXml(analytics)}`);
  })
);

module.exports = router;
