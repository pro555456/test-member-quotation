require("dotenv").config();

const quoteImportService = require("../services/quoteImportService");

async function run() {
  const filePath = process.argv[2] || process.env.QUOTE_IMPORT_DEFAULT_PATH;
  const sheetName = process.argv[3] || process.env.QUOTE_IMPORT_DEFAULT_SHEET || "2025";
  const dryRun = process.argv.includes("--dry-run");

  const result = await quoteImportService.importQuotes({ filePath, sheetName, dryRun, userId: null });
  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
