const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const mySqlDb = require("../connection/mySqlConnection");
const { HttpError } = require("../utils/http");
const quoteService = require("./quoteService");

const execFileAsync = promisify(execFile);

function resolveImportPath(filePath) {
  const resolved = filePath || process.env.QUOTE_IMPORT_DEFAULT_PATH;
  if (!resolved) throw new HttpError(400, "filePath is required", "IMPORT_FILE_REQUIRED");
  if (!fs.existsSync(resolved)) {
    throw new HttpError(404, "Import file not found", "IMPORT_FILE_NOT_FOUND", { filePath: resolved });
  }
  return resolved;
}

async function parseWorkbook({ filePath, sheetName }) {
  const pythonBin = process.env.PYTHON_BIN || "python";
  const scriptPath = path.join(__dirname, "..", "scripts", "parse_quotes_xlsx.py");

  try {
    const { stdout } = await execFileAsync(pythonBin, [scriptPath, "--sheet", sheetName], {
      env: {
        ...process.env,
        QUOTE_XLSX_PATH: filePath,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10,
    });

    return JSON.parse(stdout);
  } catch (error) {
    throw new HttpError(500, "Failed to parse Excel workbook", "IMPORT_PARSE_FAILED", {
      message: error.message,
    });
  }
}

async function importQuotes({ filePath, sheetName = process.env.QUOTE_IMPORT_DEFAULT_SHEET || "2025", dryRun = false, userId = null } = {}) {
  const resolvedPath = resolveImportPath(filePath);
  const parsed = await parseWorkbook({ filePath: resolvedPath, sheetName });
  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const normalizedRows = rows.map((row) => {
    try {
      return quoteService._internals.normalizeQuotePayload({
        ...row,
        sourceSheet: row.sourceSheet || sheetName,
        sourceRowNo: row.sourceRowNo,
      });
    } catch (error) {
      if (!error.details) {
        error.details = {};
      }
      error.details.sourceRowNo = row?.sourceRowNo || null;
      throw error;
    }
  });

  if (dryRun) {
    return {
      dryRun: true,
      totalRows: normalizedRows.length,
      sample: normalizedRows.slice(0, 5),
      sheetName,
      filePath: resolvedPath,
    };
  }

  let inserted = 0;
  let updated = 0;

  await mySqlDb.withTransaction(async (tx) => {
    for (const row of normalizedRows) {
      const existing = await tx.query(
        "SELECT id FROM inspection_quotes WHERE dedupe_key = ? LIMIT 1",
        [row.dedupeKey]
      );

      if (existing.length) {
        await quoteService.saveNormalizedQuote(row, {
          id: Number(existing[0].id),
          userId,
          tx,
        });
        updated += 1;
      } else {
        await quoteService.saveNormalizedQuote(row, { userId, tx });
        inserted += 1;
      }
    }
  });

  return {
    dryRun: false,
    totalRows: normalizedRows.length,
    inserted,
    updated,
    sheetName,
    filePath: resolvedPath,
  };
}

module.exports = {
  importQuotes,
};

