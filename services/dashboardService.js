const mySqlDb = require("../connection/mySqlConnection");

async function getSummary() {
  const [totals] = await mySqlDb.query(
    `SELECT
        SUM(CASE WHEN quote_date = CURDATE() THEN 1 ELSE 0 END) AS today_case_count,
        SUM(CASE WHEN DATE_FORMAT(quote_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') THEN 1 ELSE 0 END) AS month_case_count,
        SUM(CASE WHEN DATE_FORMAT(quote_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') THEN total_untaxed ELSE 0 END) AS month_total_untaxed,
        SUM(CASE WHEN case_status IN ('DRAFT', 'QUOTED') THEN 1 ELSE 0 END) AS pending_sign_count,
        SUM(CASE WHEN case_status IN ('SIGNED', 'IN_PROGRESS', 'COMPLETED') THEN 1 ELSE 0 END) AS in_progress_count,
        AVG(CASE WHEN closed_at IS NULL THEN NULL ELSE DATEDIFF(closed_at, quote_date) END) AS avg_close_days,
        SUM(CASE WHEN case_status <> 'CLOSED' AND DATEDIFF(CURDATE(), quote_date) > 30 THEN 1 ELSE 0 END) AS overdue_case_count,
        COUNT(DISTINCT CASE WHEN DATE_FORMAT(quote_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') THEN customer_name END) AS active_customer_count,
        COUNT(*) AS total_case_count,
        MIN(quote_date) AS earliest_quote_date,
        MAX(quote_date) AS latest_quote_date
     FROM inspection_quotes`
  );

  const latestQuoteDate = totals?.latest_quote_date || null;
  const earliestQuoteDate = totals?.earliest_quote_date || null;
  const latestQuoteMonth = latestQuoteDate ? String(latestQuoteDate).slice(0, 7) : null;
  const monthCaseCount = Number(totals?.month_case_count || 0);
  const totalCaseCount = Number(totals?.total_case_count || 0);

  return {
    todayCaseCount: Number(totals?.today_case_count || 0),
    monthCaseCount,
    monthUntaxedTotal: Number(totals?.month_total_untaxed || 0),
    pendingSignCount: Number(totals?.pending_sign_count || 0),
    inProgressCount: Number(totals?.in_progress_count || 0),
    avgCloseDays: totals?.avg_close_days === null ? null : Number(Number(totals.avg_close_days).toFixed(1)),
    overdueCaseCount: Number(totals?.overdue_case_count || 0),
    activeCustomerCount: Number(totals?.active_customer_count || 0),
    totalCaseCount,
    earliestQuoteDate,
    latestQuoteDate,
    latestQuoteMonth,
    currentMonth: new Date().toISOString().slice(0, 7),
    showDataRangeHint: totalCaseCount > 0 && monthCaseCount === 0 && !!latestQuoteMonth,
  };
}

async function getTrends() {
  const [monthly, platform, topCustomers, statusBreakdown] = await Promise.all([
    mySqlDb.query(
      `SELECT DATE_FORMAT(quote_date, '%Y-%m') AS month,
              COUNT(*) AS case_count,
              ROUND(SUM(total_untaxed), 2) AS untaxed_total
       FROM inspection_quotes
       WHERE quote_date >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
       GROUP BY DATE_FORMAT(quote_date, '%Y-%m')
       ORDER BY month ASC`
    ),
    mySqlDb.query(
      `SELECT
          SUM(platform_ios) AS ios,
          SUM(platform_android) AS android,
          SUM(platform_web) AS web,
          SUM(platform_other) AS other
       FROM inspection_quotes`
    ),
    mySqlDb.query(
      `SELECT customer_name,
              COUNT(*) AS case_count,
              ROUND(SUM(total_untaxed), 2) AS untaxed_total
       FROM inspection_quotes
       GROUP BY customer_name
       ORDER BY untaxed_total DESC, case_count DESC, customer_name ASC
       LIMIT 8`
    ),
    mySqlDb.query(
      `SELECT case_status, COUNT(*) AS total
       FROM inspection_quotes
       GROUP BY case_status
       ORDER BY total DESC, case_status ASC`
    ),
  ]);

  return {
    monthly: monthly.map((row) => ({
      month: row.month,
      caseCount: Number(row.case_count),
      untaxedTotal: Number(row.untaxed_total || 0),
    })),
    platformMix: {
      ios: Number(platform[0]?.ios || 0),
      android: Number(platform[0]?.android || 0),
      web: Number(platform[0]?.web || 0),
      other: Number(platform[0]?.other || 0),
    },
    topCustomers: topCustomers.map((row) => ({
      customerName: row.customer_name,
      caseCount: Number(row.case_count),
      untaxedTotal: Number(row.untaxed_total || 0),
    })),
    statusBreakdown: statusBreakdown.map((row) => ({
      caseStatus: row.case_status,
      total: Number(row.total || 0),
    })),
  };
}

module.exports = {
  getSummary,
  getTrends,
};
