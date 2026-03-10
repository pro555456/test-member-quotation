# Node.js
Node course
--------------------------------------------
1221 chatgpt
再往前一步做到「真企業」等級，加上
✅ /api/admin/users/:id 取得詳情 + 審計欄位（誰重設密碼、誰停用）
✅ 操作紀錄表 admin_audit_log（後台必備）
把 audit log 也補上

好，下面直接把「真企業等級」兩件事一次補齊：DB（audit log + 審計欄位）＋ API（含寫 log）＋ 人員管理頁面顯示 log。你照貼就能跑。
1) DB：新增審計欄位 + 操作紀錄表 admin_audit_log
1-1 custaccount 加「最後一次重設密碼/停用」審計欄位
你前面已加 is_disabled/disabled_at/disabled_reason，這裡再補「誰做的」。
ALTER TABLE custaccount
  ADD COLUMN password_reset_at DATETIME NULL AFTER disabled_reason,
  ADD COLUMN password_reset_by INT UNSIGNED NULL AFTER password_reset_at,
  ADD COLUMN disabled_by INT UNSIGNED NULL AFTER disabled_at;
CREATE INDEX idx_custaccount_disabled_by ON custaccount(disabled_by);
CREATE INDEX idx_custaccount_pwd_reset_by ON custaccount(password_reset_by);
若你想加外鍵也可，但很多企業會先不加（避免操作員帳號被刪造成 FK 卡死）。

1-2 建立操作紀錄表：admin_audit_log（後台必備）
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id INT UNSIGNED NOT NULL COMMENT '操作者（後台人員）',
  action VARCHAR(50) NOT NULL COMMENT '動作：USER_CREATE/USER_DISABLE/USER_ENABLE/USER_RESET_PASSWORD/ROLE_UPDATE...',
  target_user_id INT UNSIGNED NULL COMMENT '被操作的使用者（可為 NULL）',
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  detail_json JSON NULL COMMENT '細節（如角色列表、原因）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_actor_time (actor_user_id, created_at),
  KEY idx_target_time (target_user_id, created_at),
  KEY idx_action_time (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


--------------------------------------------
3️⃣ 後台新增「人員管理」頁面（EJS + API）
3-1 pages.js：新增路由（後台頁面）
你的 apis/pages.js 目前只有 /admin。加一頁：
router.route('/admin/users')
.get((req, res) => res.render('admin_users.ejs'));
頁面權限控制會在 API 做（UI 也可以依權限顯示/隱藏）。

3-2 後台 header：把「人員管理」入口加到選單
在 basic/header.ejs 後台區塊加一個選項，例如：
<li>
  <a class="dropdown-item" href="/admin/users" id="adminUsers">人員管理</a>
</li>

並在你現有的 JS 判斷那邊（以前是 cust.type === "2"），改成更正確：
建議：登入成功後把 type 改成 'A'/'U' 已經做了
更企業：你可以讓 /api/me 回 perms（或 roles），前端決定是否顯示
最簡單先做：cust.type === 'A' 顯示後台入口（你現在 JWT payload already type='A'）
3-3 新增 API：人員 CRUD + 指派角色

在 apis/api.js 加這些（需 user:manage 權限）

3-3-1 列出使用者
router.get('/admin/users', requireAuth, requirePermission('user:manage'), async (req, res) => {
  const rows = await mySqlDb.query(
    `SELECT id, account, type, name, cellphone, email, create_date, update_date
     FROM custaccount
     ORDER BY id DESC
     LIMIT 200`
  );
  res.status(200).json({ users: rows });
});

3-3-2 取得角色列表
router.get('/admin/roles', requireAuth, requirePermission('user:manage'), async (req, res) => {
  const rows = await mySqlDb.query(`SELECT id, code, name FROM roles ORDER BY id`);
  res.status(200).json({ roles: rows });
});

3-3-3 指派使用者角色（多角色）

3-3-4 建立後台人員（可選）
（建立 staff/admin 帳號用；密碼要 bcrypt）

3-4 新增 EJS：views/admin_users.ejs
（簡潔版：datatable + 指派角色 modal）

你可以先用這個 MVP 版本跑起來，之後再美化/分頁。

如果你要「顯示目前已勾選的角色」，我再幫你補 /api/admin/users/:id/roles 取回現況即可。

--------------------------------------------
1️⃣ 庫存預扣（Pending/Paid）＋金流回調補償機制
1-1 訂單狀態模型（建議）
PENDING：已下單、已預扣庫存、等待付款
PAID：付款成功、訂單成立
CANCELLED：取消/付款失敗（要回補庫存）
EXPIRED：超時未付款（要回補庫存）
原本你的 shop_order.status 用 '1' 這種字串，建議升級成 ENUM 或明確字串。
SQL：升級 shop_order

1-2 「預扣庫存」資料結構（企業版做法）
你已經有 shop_order_item（之前我建議你加）。這裡再加兩個欄位：
reserved_qty：預扣量（通常 = qty）
released_at：回補時間（避免重複回補）
SQL：升級 shop_order_item

1-3 下單流程（transaction）改成「預扣庫存 + Pending」
你之前已經做了 SELECT ... FOR UPDATE + 扣庫存，現在只要加上：
設定 expires_at（例如 15 分鐘）
訂單寫入 trade_no（MerchantTradeNo）
訂單 status2=PENDING
明細 reserved_qty=qty
下面是一段「可直接替換」你現有 /submitOrder 的核心交易片段（保留你後面產生金流表單的邏輯就好）

1-4 金流回調（Paid / Failed）＋回補機制（補償）
你需要兩條後端端點：
POST /api/payment/ecpay/notify：綠界 server-to-server 回呼（最可信）
GET /payment/result：使用者導回頁（只做顯示，不作為最終依據）
1-4-1 付款成功回調：把訂單改 PAID（且不回補）
重點：只允許 PENDING → PAID 一次（避免重放攻擊）

1-4-2 超時未付款：排程 job 回補（補償機制）
你可先用「簡單版」：用 setInterval 每分鐘掃一次 PENDING & expires_at < NOW()。
放在 app.js 啟動後（或獨立 worker 更好）

2️⃣ RBAC 權限表（支援多角色、多權限）
2-1 SQL：RBAC 四張表

2-2 初始化資料（角色/權限）

2-3 把你舊的 type='A' 對應到 admin（一次性遷移）

2-4 Node：新增 RBAC middleware（取代 requireAdmin）
新增檔案：middlewares/rbac.js
然後在 apis/api.js：

原本 requireAuth, requireAdmin 的地方，改成：
requireAuth, requirePermission('product:write')
requireAuth, requirePermission('user:manage')

例：商品刪改新增
const { requirePermission } = require('../middlewares/rbac');
router.delete('/product/:id', requireAuth, requirePermission('product:write'), ...);
router.put('/product/:id', requireAuth, requirePermission('product:write'), ...);
router.post('/product', requireAuth, requirePermission('product:write'), ...);

--------------------------------------------
我需要你注意的一個小點（避免你踩坑）
你 product WHERE id IN (?) FOR UPDATE 這種寫法，mysql2 通常 OK；如果你遇到「IN (?) 變成字串」的問題，我可以給你一個安全的「動態 placeholders」版本（IN (?,?,?)）讓你完全不踩雷。
如果你回我一句：你 mySqlConnection 用的是 mysql2 還是 mysql（或貼一小段 connection 檔案），我就把那段 IN (?) 全部幫你改成最保險寫法。

很好，這支 mySqlConnection 我會直接幫你升級成企業等級、現代化、可長期維護的版本，並且完全對齊你前面已經寫好的：
async/await
withTransaction
SELECT ... FOR UPDATE
高併發下單
docker / 本機 / nginx 環境
下面分成 「為什麼要改」→「最終推薦版本（整檔可覆蓋）」→「你要注意的 5 個重點」

為什麼你現在這版「該升級了」
你目前用的是：
const mysql = require('mysql');
這是 舊版 mysql driver（callback 為主），問題是：
❌ 不原生支援 Promise
❌ transaction 要自己包 callback（容易寫錯）
❌ IN (?)、FOR UPDATE 在複雜情境容易踩雷
❌ 官方早就建議新專案用 mysql2
👉 企業 / 金流 / 高併發專案，標準都是 mysql2/promise
✅ 最終推薦版本（整檔可直接覆蓋）
1️⃣ 先安裝（只做一次）
npm uninstall mysql
npm install mysql2

2️⃣ 新版 connection/mySqlConnection.js（企業版）
✅ Promise 原生
✅ pool + transaction helper
✅ 詳細 log
✅ docker / nginx / k8s 都適用

4️⃣ 關於你最關心的兩個「企業級雷點」
✅ 1. IN (?) FOR UPDATE 現在是「安全的」
✅ 2. 高併發下不會超賣

5️⃣ 企業實務再給你 5 個「隱藏加分點」
① process.exit(1) 是刻意的
DB 掛掉就不該讓 API 繼續跑
否則會出現「API 看似正常但每個請求都爆炸」

② dateStrings: true
避免：
MySQL DATETIME 被轉成 JS Date
nginx / docker / server timezone 不一致導致帳務錯亂

③ connectionLimit
建議值：
小專案：5~10
電商 / 金流：10~30（依 VM 核心）

④ 不再需要手動 pool.query(new Promise...)
你現在：
pool.query(sql, params, cb)
已被：
await pool.execute(sql, params)
完全取代（可讀性 + 穩定性大幅提升）

⑤ 你現在已達「可上線等級」
以你現在的架構：
JWT + refresh rotation
HttpOnly cookie
rate limit
transaction 防超賣
Mongo pool
axios retry
多裝置 session 管理
👉 這已經是中大型電商 / SaaS 後端水準


