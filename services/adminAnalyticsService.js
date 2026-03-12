const mySqlDb = require("../connection/mySqlConnection");
const { HttpError } = require("../utils/http");

const PERIOD_CONFIG = {
  month: {
    key: "month",
    label: "每月",
    currentWhere: "quote_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') AND quote_date < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)",
    trendLabelSql: "DATE_FORMAT(quote_date, '%Y-%m')",
    trendGroupBy: "DATE_FORMAT(quote_date, '%Y-%m')",
    trendWhere: "quote_date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)",
    trendOrderBy: "MIN(quote_date)",
    trendLimit: 12,
  },
  quarter: {
    key: "quarter",
    label: "每季",
    currentWhere: "quote_date >= MAKEDATE(YEAR(CURDATE()), 1) + INTERVAL ((QUARTER(CURDATE()) - 1) * 3) MONTH AND quote_date < MAKEDATE(YEAR(CURDATE()), 1) + INTERVAL (QUARTER(CURDATE()) * 3) MONTH",
    trendLabelSql: "CONCAT(YEAR(quote_date), '-Q', QUARTER(quote_date))",
    trendGroupBy: "YEAR(quote_date), QUARTER(quote_date)",
    trendWhere: "quote_date >= DATE_SUB(MAKEDATE(YEAR(CURDATE()), 1) + INTERVAL ((QUARTER(CURDATE()) - 1) * 3) MONTH, INTERVAL 21 MONTH)",
    trendOrderBy: "YEAR(quote_date), QUARTER(quote_date)",
    trendLimit: 8,
  },
  halfYear: {
    key: "halfYear",
    label: "每半年",
    currentWhere: "quote_date >= MAKEDATE(YEAR(CURDATE()), 1) + INTERVAL (CASE WHEN MONTH(CURDATE()) <= 6 THEN 0 ELSE 6 END) MONTH AND quote_date < MAKEDATE(YEAR(CURDATE()), 1) + INTERVAL (CASE WHEN MONTH(CURDATE()) <= 6 THEN 6 ELSE 12 END) MONTH",
    trendLabelSql: "CONCAT(YEAR(quote_date), '-H', IF(MONTH(quote_date) <= 6, 1, 2))",
    trendGroupBy: "YEAR(quote_date), IF(MONTH(quote_date) <= 6, 1, 2)",
    trendWhere: "quote_date >= DATE_SUB(MAKEDATE(YEAR(CURDATE()), 1) + INTERVAL (CASE WHEN MONTH(CURDATE()) <= 6 THEN 0 ELSE 6 END) MONTH, INTERVAL 30 MONTH)",
    trendOrderBy: "YEAR(quote_date), IF(MONTH(quote_date) <= 6, 1, 2)",
    trendLimit: 6,
  },
  year: {
    key: "year",
    label: "每年",
    currentWhere: "YEAR(quote_date) = YEAR(CURDATE())",
    trendLabelSql: "CAST(YEAR(quote_date) AS CHAR)",
    trendGroupBy: "YEAR(quote_date)",
    trendWhere: "quote_date >= MAKEDATE(YEAR(CURDATE()) - 4, 1)",
    trendOrderBy: "YEAR(quote_date)",
    trendLimit: 5,
  },
};

const PLATFORM_COLUMNS = [
  { key: "ios", label: "iOS", flagColumn: "platform_ios" },
  { key: "android", label: "Android", flagColumn: "platform_android" },
  { key: "web", label: "Web", flagColumn: "platform_web" },
  { key: "other", label: "Other", flagColumn: "platform_other" },
];

function getPeriodConfig(period) {
  return PERIOD_CONFIG[period] || PERIOD_CONFIG.month;
}

function normalizeDateInput(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HttpError(400, `Invalid ${fieldName}`, "INVALID_DATE_FILTER", { fieldName, value });
  }
  return text;
}

function resolveFilters(filters = {}) {
  const period = getPeriodConfig(filters.period).key;
  const startDate = normalizeDateInput(filters.startDate, "startDate");
  const endDate = normalizeDateInput(filters.endDate, "endDate");

  if (startDate && endDate && startDate > endDate) {
    throw new HttpError(400, "startDate cannot be later than endDate", "INVALID_DATE_RANGE", { startDate, endDate });
  }

  return {
    period,
    startDate,
    endDate,
    hasCustomRange: Boolean(startDate || endDate),
  };
}

function buildDateWhere(column, filters, params = []) {
  const clauses = [];
  if (filters.startDate) {
    clauses.push(`${column} >= ?`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    clauses.push(`${column} < DATE_ADD(?, INTERVAL 1 DAY)`);
    params.push(filters.endDate);
  }
  return clauses.length ? clauses.join(" AND ") : "1 = 1";
}

function getCurrentPeriodLabel(periodKey) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  if (periodKey === "quarter") return `${year}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  if (periodKey === "halfYear") return `${year}-H${now.getMonth() < 6 ? 1 : 2}`;
  if (periodKey === "year") return String(year);
  return `${year}-${month}`;
}

function buildPeriodLabel(filters) {
  if (filters.hasCustomRange) {
    return `${filters.startDate || "起始"} ~ ${filters.endDate || "今日"}`;
  }
  return getCurrentPeriodLabel(filters.period);
}

function toNumber(value, digits = null) {
  const normalized = Number(value || 0);
  if (digits === null) return normalized;
  return Number(normalized.toFixed(digits));
}

function formatMoney(value) {
  return toNumber(value, 2).toLocaleString("zh-TW", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildMatrix(row) {
  return PLATFORM_COLUMNS.map((platform) => ({
    key: platform.key,
    label: platform.label,
    caseCount: toNumber(row[`${platform.key}_case_count`]),
    amount: toNumber(row[`${platform.key}_amount`]),
  }));
}

function buildCustomerPlatformCross(rows = []) {
  const matrixRows = rows.map((row) => {
    const platforms = buildMatrix(row);
    return {
      customerName: row.customer_name,
      totalCaseCount: toNumber(row.total_case_count),
      totalAmount: toNumber(row.total_amount),
      platforms,
    };
  });

  const totals = PLATFORM_COLUMNS.map((platform) => ({
    key: platform.key,
    label: platform.label,
    caseCount: matrixRows.reduce((sum, row) => sum + (row.platforms.find((item) => item.key === platform.key)?.caseCount || 0), 0),
    amount: matrixRows.reduce((sum, row) => sum + (row.platforms.find((item) => item.key === platform.key)?.amount || 0), 0),
  }));

  const maxAmount = Math.max(
    ...matrixRows.flatMap((row) => row.platforms.map((platform) => platform.amount)),
    1,
  );

  return {
    platforms: PLATFORM_COLUMNS.map((platform) => ({ key: platform.key, label: platform.label })),
    rows: matrixRows,
    totals,
    maxAmount,
  };
}

async function getAdminAnalytics(rawFilters = {}) {
  const filters = resolveFilters(rawFilters);
  const config = getPeriodConfig(filters.period);

  const selectedParams = [];
  const trendParams = [];
  const selectedWhere = filters.hasCustomRange ? buildDateWhere("quote_date", filters, selectedParams) : config.currentWhere;
  const trendWhere = filters.hasCustomRange ? buildDateWhere("quote_date", filters, trendParams) : config.trendWhere;

  const [filteredSummaryRows, snapshotRows, trendRows, topCustomerRows, outstandingRows, caseStatusRows, billingStatusRows, crossRows] = await Promise.all([
    mySqlDb.query(
      `SELECT
          COUNT(*) AS period_case_count,
          ROUND(SUM(total_untaxed), 2) AS period_untaxed_total,
          SUM(CASE WHEN case_status = 'CLOSED' THEN 1 ELSE 0 END) AS period_closed_count,
          COUNT(DISTINCT customer_name) AS period_customer_count,
          AVG(CASE WHEN closed_at IS NOT NULL THEN DATEDIFF(closed_at, quote_date) END) AS period_avg_close_days
       FROM inspection_quotes
       WHERE ${selectedWhere}`,
      selectedParams,
    ),
    mySqlDb.query(
      `SELECT
          SUM(CASE WHEN case_status <> 'CLOSED' THEN 1 ELSE 0 END) AS open_case_count,
          ROUND(SUM(CASE WHEN case_status <> 'CLOSED' THEN total_untaxed ELSE 0 END), 2) AS open_case_amount,
          SUM(CASE WHEN billing_status <> 'SETTLED' THEN 1 ELSE 0 END) AS unpaid_case_count,
          COUNT(DISTINCT CASE WHEN billing_status <> 'SETTLED' THEN customer_name END) AS unpaid_customer_count,
          ROUND(SUM(CASE WHEN billing_status <> 'SETTLED' THEN total_untaxed ELSE 0 END), 2) AS unpaid_amount,
          SUM(CASE WHEN case_status <> 'CLOSED' AND DATEDIFF(CURDATE(), quote_date) > 30 THEN 1 ELSE 0 END) AS overdue_open_case_count
       FROM inspection_quotes`,
    ),
    mySqlDb.query(
      `SELECT
          ${config.trendLabelSql} AS label,
          COUNT(*) AS case_count,
          ROUND(SUM(total_untaxed), 2) AS untaxed_total,
          SUM(CASE WHEN case_status = 'CLOSED' THEN 1 ELSE 0 END) AS closed_count,
          ROUND(SUM(CASE WHEN billing_status <> 'SETTLED' THEN total_untaxed ELSE 0 END), 2) AS unsettled_amount
       FROM inspection_quotes
       WHERE ${trendWhere}
       GROUP BY ${config.trendGroupBy}
       ORDER BY ${config.trendOrderBy} ASC
       LIMIT ${config.trendLimit}`,
      trendParams,
    ),
    mySqlDb.query(
      `SELECT
          customer_name,
          COUNT(*) AS case_count,
          ROUND(SUM(total_untaxed), 2) AS untaxed_total,
          SUM(CASE WHEN case_status <> 'CLOSED' THEN 1 ELSE 0 END) AS open_case_count,
          ROUND(SUM(CASE WHEN billing_status <> 'SETTLED' THEN total_untaxed ELSE 0 END), 2) AS unpaid_amount
       FROM inspection_quotes
       WHERE ${selectedWhere}
       GROUP BY customer_name
       ORDER BY untaxed_total DESC, case_count DESC, customer_name ASC
       LIMIT 10`,
      selectedParams,
    ),
    mySqlDb.query(
      `SELECT
          customer_name,
          SUM(CASE WHEN case_status <> 'CLOSED' THEN 1 ELSE 0 END) AS open_case_count,
          SUM(CASE WHEN billing_status <> 'SETTLED' THEN 1 ELSE 0 END) AS unpaid_case_count,
          ROUND(SUM(CASE WHEN case_status <> 'CLOSED' THEN total_untaxed ELSE 0 END), 2) AS open_case_amount,
          ROUND(SUM(CASE WHEN billing_status <> 'SETTLED' THEN total_untaxed ELSE 0 END), 2) AS unpaid_amount,
          ROUND(SUM(CASE WHEN case_status <> 'CLOSED' OR billing_status <> 'SETTLED' THEN total_untaxed ELSE 0 END), 2) AS outstanding_amount,
          MAX(quote_date) AS latest_quote_date,
          MAX(CASE WHEN case_status <> 'CLOSED' THEN DATEDIFF(CURDATE(), quote_date) ELSE 0 END) AS oldest_open_days
       FROM inspection_quotes
       WHERE case_status <> 'CLOSED' OR billing_status <> 'SETTLED'
       GROUP BY customer_name
       ORDER BY outstanding_amount DESC, open_case_count DESC, customer_name ASC
       LIMIT 20`,
    ),
    mySqlDb.query(
      `SELECT case_status, COUNT(*) AS total
       FROM inspection_quotes
       WHERE ${selectedWhere}
       GROUP BY case_status
       ORDER BY total DESC, case_status ASC`,
      selectedParams,
    ),
    mySqlDb.query(
      `SELECT billing_status, COUNT(*) AS total
       FROM inspection_quotes
       WHERE ${selectedWhere}
       GROUP BY billing_status
       ORDER BY total DESC, billing_status ASC`,
      selectedParams,
    ),
    mySqlDb.query(
      `SELECT
          customer_name,
          COUNT(*) AS total_case_count,
          ROUND(SUM(total_untaxed), 2) AS total_amount,
          SUM(CASE WHEN platform_ios = 1 THEN 1 ELSE 0 END) AS ios_case_count,
          ROUND(SUM(CASE WHEN platform_ios = 1 THEN total_untaxed ELSE 0 END), 2) AS ios_amount,
          SUM(CASE WHEN platform_android = 1 THEN 1 ELSE 0 END) AS android_case_count,
          ROUND(SUM(CASE WHEN platform_android = 1 THEN total_untaxed ELSE 0 END), 2) AS android_amount,
          SUM(CASE WHEN platform_web = 1 THEN 1 ELSE 0 END) AS web_case_count,
          ROUND(SUM(CASE WHEN platform_web = 1 THEN total_untaxed ELSE 0 END), 2) AS web_amount,
          SUM(CASE WHEN platform_other = 1 THEN 1 ELSE 0 END) AS other_case_count,
          ROUND(SUM(CASE WHEN platform_other = 1 THEN total_untaxed ELSE 0 END), 2) AS other_amount
       FROM inspection_quotes
       WHERE ${selectedWhere}
       GROUP BY customer_name
       ORDER BY total_amount DESC, total_case_count DESC, customer_name ASC
       LIMIT 12`,
      selectedParams,
    ),
  ]);

  const filteredSummary = filteredSummaryRows[0] || {};
  const snapshot = snapshotRows[0] || {};

  return {
    filters,
    period: filters.period,
    periodLabel: buildPeriodLabel(filters),
    summary: {
      periodCaseCount: toNumber(filteredSummary.period_case_count),
      periodUntaxedTotal: toNumber(filteredSummary.period_untaxed_total),
      periodClosedCount: toNumber(filteredSummary.period_closed_count),
      periodCustomerCount: toNumber(filteredSummary.period_customer_count),
      periodAvgCloseDays: filteredSummary.period_avg_close_days === null ? null : toNumber(filteredSummary.period_avg_close_days, 1),
      openCaseCount: toNumber(snapshot.open_case_count),
      openCaseAmount: toNumber(snapshot.open_case_amount),
      unpaidCaseCount: toNumber(snapshot.unpaid_case_count),
      unpaidCustomerCount: toNumber(snapshot.unpaid_customer_count),
      unpaidAmount: toNumber(snapshot.unpaid_amount),
      overdueOpenCaseCount: toNumber(snapshot.overdue_open_case_count),
    },
    trend: trendRows.map((row) => ({
      label: row.label,
      caseCount: toNumber(row.case_count),
      untaxedTotal: toNumber(row.untaxed_total),
      closedCount: toNumber(row.closed_count),
      unsettledAmount: toNumber(row.unsettled_amount),
    })),
    topCustomers: topCustomerRows.map((row) => ({
      customerName: row.customer_name,
      caseCount: toNumber(row.case_count),
      untaxedTotal: toNumber(row.untaxed_total),
      openCaseCount: toNumber(row.open_case_count),
      unpaidAmount: toNumber(row.unpaid_amount),
    })),
    outstandingCustomers: outstandingRows.map((row) => ({
      customerName: row.customer_name,
      openCaseCount: toNumber(row.open_case_count),
      unpaidCaseCount: toNumber(row.unpaid_case_count),
      openCaseAmount: toNumber(row.open_case_amount),
      unpaidAmount: toNumber(row.unpaid_amount),
      outstandingAmount: toNumber(row.outstanding_amount),
      latestQuoteDate: row.latest_quote_date,
      oldestOpenDays: toNumber(row.oldest_open_days),
    })),
    caseStatusBreakdown: caseStatusRows.map((row) => ({
      label: row.case_status,
      total: toNumber(row.total),
    })),
    billingStatusBreakdown: billingStatusRows.map((row) => ({
      label: row.billing_status,
      total: toNumber(row.total),
    })),
    customerPlatformCross: buildCustomerPlatformCross(crossRows),
  };
}

function normalizeSheetName(name) {
  return String(name || "Sheet")
    .replace(/[\\/:?*\[\]]/g, " ")
    .slice(0, 31);
}

function inferCellType(value) {
  return typeof value === "number" ? "Number" : "String";
}

function buildWorksheetXml(sheet) {
  const rows = (sheet.rows || []).map((row) => {
    const cells = row.map((cell) => {
      const value = cell === null || cell === undefined ? "" : cell;
      return `<Cell><Data ss:Type="${inferCellType(value)}">${escapeXml(value)}</Data></Cell>`;
    }).join("");
    return `<Row>${cells}</Row>`;
  }).join("");

  return `<Worksheet ss:Name="${escapeXml(normalizeSheetName(sheet.name))}"><Table>${rows}</Table></Worksheet>`;
}

function buildExcelWorkbookXml(analytics) {
  const summary = analytics.summary || {};
  const cross = analytics.customerPlatformCross || { platforms: [], rows: [], totals: [] };

  const summarySheet = {
    name: "Summary",
    rows: [
      ["管理分析報表", analytics.periodLabel],
      ["期間模式", analytics.period],
      ["開始日期", analytics.filters?.startDate || ""],
      ["結束日期", analytics.filters?.endDate || ""],
      [],
      ["指標", "數值"],
      ["當期案件數", summary.periodCaseCount],
      ["當期未稅營收", summary.periodUntaxedTotal],
      ["當期已結案", summary.periodClosedCount],
      ["當期活躍客戶", summary.periodCustomerCount],
      ["平均結案天數", summary.periodAvgCloseDays ?? "—"],
      ["目前未結案案件", summary.openCaseCount],
      ["目前未結案金額", summary.openCaseAmount],
      ["目前未收款客戶", summary.unpaidCustomerCount],
      ["目前未收款案件", summary.unpaidCaseCount],
      ["目前未收款金額", summary.unpaidAmount],
      ["逾期未結案", summary.overdueOpenCaseCount],
    ],
  };

  const trendSheet = {
    name: "Trend",
    rows: [
      ["區間", "案件數", "未稅營收", "已結案", "未收款金額"],
      ...(analytics.trend || []).map((row) => [row.label, row.caseCount, row.untaxedTotal, row.closedCount, row.unsettledAmount]),
    ],
  };

  const topCustomersSheet = {
    name: "TopCustomers",
    rows: [
      ["客戶", "案件數", "未稅金額", "未結案件數", "未收款金額"],
      ...(analytics.topCustomers || []).map((row) => [row.customerName, row.caseCount, row.untaxedTotal, row.openCaseCount, row.unpaidAmount]),
    ],
  };

  const outstandingSheet = {
    name: "Outstanding",
    rows: [
      ["客戶", "未結案", "未收款", "未結案金額", "未收款金額", "Outstanding 金額", "最新報價", "最久未結案天數"],
      ...(analytics.outstandingCustomers || []).map((row) => [row.customerName, row.openCaseCount, row.unpaidCaseCount, row.openCaseAmount, row.unpaidAmount, row.outstandingAmount, row.latestQuoteDate || "", row.oldestOpenDays]),
    ],
  };

  const statusSheet = {
    name: "StatusBreakdown",
    rows: [
      ["案件狀態", "筆數", "", "請款狀態", "筆數"],
      ...Array.from({ length: Math.max(analytics.caseStatusBreakdown.length, analytics.billingStatusBreakdown.length) }, (_, index) => [
        analytics.caseStatusBreakdown[index]?.label || "",
        analytics.caseStatusBreakdown[index]?.total || "",
        "",
        analytics.billingStatusBreakdown[index]?.label || "",
        analytics.billingStatusBreakdown[index]?.total || "",
      ]),
    ],
  };

  const crossHeader = ["客戶", "總案件數", "總金額"];
  cross.platforms.forEach((platform) => {
    crossHeader.push(`${platform.label} 案件數`, `${platform.label} 金額`);
  });
  const crossRows = (cross.rows || []).map((row) => {
    const cells = [row.customerName, row.totalCaseCount, row.totalAmount];
    cross.platforms.forEach((platform) => {
      const platformCell = row.platforms.find((item) => item.key === platform.key) || { caseCount: 0, amount: 0 };
      cells.push(platformCell.caseCount, platformCell.amount);
    });
    return cells;
  });
  const crossTotals = ["平台總計", "", ""];
  cross.totals.forEach((platform) => {
    crossTotals.push(platform.caseCount, platform.amount);
  });

  const crossSheet = {
    name: "CustomerPlatform",
    rows: [crossHeader, ...crossRows, crossTotals],
  };

  const worksheets = [summarySheet, trendSheet, topCustomersSheet, outstandingSheet, statusSheet, crossSheet]
    .map(buildWorksheetXml)
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Author>OpenAI Codex</Author>
    <LastAuthor>OpenAI Codex</LastAuthor>
    <Created>${new Date().toISOString()}</Created>
  </DocumentProperties>
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/></Style>
  </Styles>
  ${worksheets}
</Workbook>`;
}

function buildExcelFilename(analytics) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `admin-analytics-${analytics.period}-${stamp}.xls`;
}

module.exports = {
  getAdminAnalytics,
  buildExcelWorkbookXml,
  buildExcelFilename,
  resolveFilters,
};
