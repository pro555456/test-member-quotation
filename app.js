require("dotenv").config();
const express = require("express");
const path = require("path");
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');

const app = express();
app.set('trust proxy', 1); // 若你用 nginx/反向代理（上線強烈建議開）
// ✅ Nginx 上線前必做：讓 IP 正確（不然 audit 的 ip 會全變成 127.0.0.1）
// app.js（在所有 middleware/router 前面）
// app.set('trust proxy', 1);

// nginx 反代要有（你通常已經有）
// proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
// proxy_set_header X-Real-IP $remote_addr;

// const dotenv = require("dotenv").config();


const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./config/swagger.json");
const pageRouter = require("./apis/pages");
const apiRouter = require("./apis/api");
const PORT = 3000;





// 為node掛上ejs
// ejs + layouts
// extractScripts/extractStyles 讓你在某些頁面需要額外 <script> 或 <style> 時可以塞進去，不會亂。
app.set("view engine", "ejs");
app.set('views', path.join(__dirname, 'views'));

app.use(expressLayouts);
app.set('layout', 'layout'); // views/layout.ejs

// ✅ 可選：讓每個頁面可以指定額外 <head>（少數頁才需要）
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);



// 同時 把你的 log middleware 移到最前面（在 static 之前），順序應該是：
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());




// --- 將日誌 Middleware 移到最前面 ---
app.use((req, res, next) => {
  const start = Date.now();
  // 注意：req.body 在 express.json() 之前是空的
  // 為了正確記錄 body，最好放在 express.json() 之後
  console.log(`[IN] ${req.method} ${req.originalUrl}`); 
  res.on('finish', () => {
    console.log(`[OUT] ${req.method} ${req.originalUrl}`, 'status=', res.statusCode, `(${Date.now()-start}ms)`);
  });
  next();
 });
// ------------------------------------
// app.use((err, req, res, next) => {
//   console.error('[UnhandledError]', err);   // 打完整 stack
//   res.status(500).send('系統發生錯誤，請洽管理員'); // 對外維持一致訊息
// });

// 使用 bootstrap
app.use(express.static(path.join(__dirname, "node_modules/bootstrap/dist/")));
// 使用靜態資源
app.use(express.static(path.join(__dirname, "public")));

// router 設定
app.use("/", pageRouter); // 前端頁面

// 1) 為什麼 /api/me 會出現 304？
// API 回 304 幾乎一定是你前面加的 log middleware 位置錯了：你把 log middleware 放在 express.static() 之後，導致某些請求被靜態快取/etag 機制影響（或瀏覽器對同一路徑做 If-None-Match/If-Modified-Since），Express 可能回 304。

// ✅ 企業版做法：API 永遠不要被快取
// ✅ API 一律禁止快取（避免 304、避免權限頁被快取）
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use("/api", apiRouter); // api router

// swagger設定檔案
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));


// ✅ 4) 你的 error handler 已經有，但要「讓 route 的錯誤進得去」
// 你目前 routes 裡 catch 後 safeJson(res,500...) 其實也可以，但你真正卡住的是 ReferenceError 發生在 try 外、或 async 錯誤沒傳遞。
// 我上面已經改成 next(err)，你的 app.js 這段就會正常接到：
// 錯誤處理（一定要在最最後，四參數）
app.use((err, req, res, next) => {
  console.error('[UnhandledError]', err);
  res.status(500).send('系統發生錯誤，請洽管理員');
});

// 404（最後面的一般 middleware）
app.use((req, res) => {
  res.status(404).send('Not Found');
});


// 週期性工作範例：每分鐘檢查是否有過期未付款訂單，並自動取消
// 1-4-2 超時未付款：排程 job 回補（補償機制）
// 你可先用「簡單版」：用 setInterval 每分鐘掃一次 PENDING & expires_at < NOW()。
// 放在 app.js 啟動後（或獨立 worker 更好）

// ✅ 相容 mysql2/promise 與你自包的 query 回傳
// ✅ app.js 加在上方（setInterval 之前）
async function dbQuery(db, sql, params = []) {
  const r = await db.query(sql, params);
  // mysql2/promise: [rows, fields]
  if (Array.isArray(r) && Array.isArray(r[0])) return r[0];
  // INSERT/UPDATE: [result, fields]
  if (Array.isArray(r) && r[0] && typeof r[0] === 'object') return r[0];
  // 其他封裝：直接回 rows 或 result
  return r;
}


// ✅ 任何 promise 超過時間直接 reject（避免 Mongo 卡死造成 IN 沒 OUT）
function withTimeout(promise, ms = 1500, label = 'timeout') {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

const mySqlDb =  require('./connection/mySqlConnection');
setInterval(async () => {
  try {
    const rows = await dbQuery(
      mySqlDb,
      `SELECT trade_no FROM shop_order
       WHERE status2='PENDING'
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       LIMIT 50`
    );

    const expired = Array.isArray(rows) ? rows : []; // ✅ 保險
    for (const o of expired) {
      await cancelAndRestockByTradeNo(o.trade_no, 'EXPIRED');
    }
  } catch (e) {
    console.error('[JOB] expire orders failed:', e);
  }
}, 60 * 1000);

// setInterval(async () => {
//   try {
//     const [expired] = await mySqlDb.query(
//       `SELECT trade_no FROM shop_order WHERE status2='PENDING' AND expires_at IS NOT NULL AND expires_at < NOW() LIMIT 50`
//     );
//     for (const o of expired) {
//       await cancelAndRestockByTradeNo(o.trade_no, 'EXPIRED');
//     }
//   } catch (e) {
//     console.error('[JOB] expire orders failed:', e);
//   }
// }, 60 * 1000);


app.listen(PORT, () => {
    console.log("Server is listen on port:", PORT);
});


module.exports = app;
