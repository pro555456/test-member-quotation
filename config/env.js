const path = require("path");

const DEFAULTS = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  inventoryHoldMinutes: Number(process.env.INVENTORY_HOLD_MINUTES || 15),
  orderExpiryIntervalMs: Number(process.env.ORDER_EXPIRY_INTERVAL_MS || 60_000),
  cookieSecure: String(process.env.COOKIE_SECURE || "false") === "true",
  quoteImportDefaultPath: process.env.QUOTE_IMPORT_DEFAULT_PATH || "",
  quoteImportDefaultSheet: process.env.QUOTE_IMPORT_DEFAULT_SHEET || "2025",
  pythonBin: process.env.PYTHON_BIN || "python",
  quoteSalesCcEmail: process.env.QUOTE_SALES_CC_EMAIL || "",
  quotePdfStoragePath: process.env.QUOTE_PDF_STORAGE_PATH || path.join(process.cwd(), "tmp", "quotes-pdf"),
  quoteNoPrefix: process.env.QUOTE_NO_PREFIX || "GQ",
  quotePdfChromePath: process.env.QUOTE_PDF_CHROME_PATH || "",
};

const REQUIRED_SECRETS = ["JWT_SECRET", "JWT_REFRESH_SECRET"];

function getRuntimeConfig() {
  return { ...DEFAULTS };
}

function validateConfig({ logger = console, strict = process.env.NODE_ENV === "production" } = {}) {
  const missing = REQUIRED_SECRETS.filter((key) => !process.env[key]);

  if (missing.length && strict) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (missing.length && !strict) {
    logger.warn(`Config warning: missing ${missing.join(", ")}. Some auth flows will fail until they are set.`);
  }

  return { missing, strict };
}

module.exports = {
  getRuntimeConfig,
  validateConfig,
  REQUIRED_SECRETS,
};
