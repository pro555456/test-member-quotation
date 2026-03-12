const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const { HttpError, asyncHandler } = require("../../utils/http");
const { requireAuthAuto } = require("../../middlewares/auth");
const { requirePermission } = require("../../middlewares/rbac");
const quoteImportService = require("../../services/quoteImportService");

const router = express.Router();
const uploadDir = path.join(process.cwd(), "tmp", "imports");
const allowedExcelExtensions = new Set([".xlsx", ".xlsm", ".xltx", ".xltm"]);

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (allowedExcelExtensions.has(ext)) {
      cb(null, true);
      return;
    }

    cb(new HttpError(400, "Only .xlsx, .xlsm, .xltx, .xltm files are supported", "INVALID_IMPORT_FILE"));
  },
});

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("file")(req, res, (error) => {
      if (!error) {
        resolve();
        return;
      }

      if (error instanceof multer.MulterError) {
        reject(new HttpError(400, error.message, "UPLOAD_ERROR"));
        return;
      }

      reject(error);
    });
  });
}

router.post(
  "/import/quotes",
  requireAuthAuto,
  requirePermission("user:manage"),
  asyncHandler(async (req, res) => {
    await runUpload(req, res);

    const uploadedFilePath = req.file?.path || null;

    try {
      const result = await quoteImportService.importQuotes({
        filePath: uploadedFilePath || req.body?.filePath,
        sheetName: req.body?.sheetName,
        dryRun: req.body?.dryRun === true || req.body?.dryRun === "true",
        userId: req.user?.id || null,
      });

      res.status(200).json({
        result: {
          ...result,
          upload: req.file
            ? {
                originalName: req.file.originalname,
                size: req.file.size,
              }
            : null,
        },
      });
    } finally {
      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        fs.unlinkSync(uploadedFilePath);
      }
    }
  })
);

module.exports = router;
