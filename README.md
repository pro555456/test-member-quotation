# Game QA Platform

內部使用的遊戲檢測報價單、案件追蹤、請款結案與管理分析平台。

這個專案已從原本的購物平台重構為遊戲檢測營運系統，首頁為登入頁，登入後可進入儀表板、報價單、案件追蹤與管理分析頁面。

## Core Features
- 首頁 `/` 為登入頁，登入成功預設進入 `/dashboard`
- 報價單管理：建立、編輯、列表、案件狀態更新
- 案件追蹤：未結案、已結案、請款狀態一覽
- Excel 匯入：支援直接上傳 `.xlsx`、`.xlsm`、`.xltx`、`.xltm`
- 管理分析：每月、每季、每半年、每年與自訂區間分析
- 交叉分析：客戶別 / 平台別案件數與金額矩陣
- 報表匯出：Excel 多工作表與列印版 PDF
- RBAC 權限管理：管理分析與人員管理皆受權限控管

## Main Routes
### Pages
- `/`：登入頁
- `/dashboard`：後台儀表板
- `/quotes`：報價單列表
- `/quotes/new`：新增報價單
- `/quotes/:id`：報價單詳情 / 編輯
- `/cases`：案件追蹤
- `/admin/analytics`：管理分析
- `/admin/users`：人員管理
- `/admin/smtp-test`：SMTP 測試

### APIs
- `/api/me`
- `/api/dashboard/summary`
- `/api/dashboard/trends`
- `/api/dashboard/admin-analytics`
- `/api/dashboard/admin-analytics/export/excel`
- `/api/quotes`
- `/api/quotes/:id`
- `/api/cases`
- `/api/cases/:id/status`
- `/api/import/quotes`
- `/api/health`

## Tech Stack
- Node.js
- Express + EJS
- MySQL 8
- MongoDB
- Bootstrap
- Nodemailer

## Project Structure
```text
apis/                API routes and page routes
config/              Runtime config and Swagger config
connection/          MySQL connection layer
database/            Full schema SQL and migration SQL
docs/                Deployment and release documentation
migrations/          Incremental application migrations
public/              Static assets
scripts/             Import, smoke check, migration, release helper scripts
services/            Business logic
tests/               Lightweight integration and smoke tests
views/               EJS templates
```

## Local Setup
1. 安裝相依套件
```powershell
npm install
```

2. 準備 `.env`
可直接複製 [.env.example](.env.example) 為 `.env`，再填入本機資料。

3. 建立資料庫
建議使用 `game_qa_platform`。

4. 建表與 migration
```powershell
mysql -u root -p game_qa_platform < database/mysql_game_qa_platform_schema.sql
npm run migrate
```

5. 啟動專案
```powershell
npm run dev
```

6. 開啟網站
[http://localhost:3000](http://localhost:3000)

## Excel Import
### 後台上傳匯入
1. 以有權限帳號登入
2. 前往 `/dashboard`
3. 在 `Excel 匯入工具` 選擇檔案
4. 先執行 `Dry Run`
5. 再執行正式匯入

### 指令列匯入
```powershell
npm run import:quotes "D:\桌面2\遊戲檢測總表.xlsx" 2025 --dry-run
npm run import:quotes "D:\桌面2\遊戲檢測總表.xlsx" 2025
```

## Analytics and Reports
管理分析頁支援：
- 每月 / 每季 / 每半年 / 每年切換
- 自訂日期區間篩選
- 未結案 / 未收款重點客戶清單
- 客戶別 / 平台別交叉分析圖
- Excel 多工作表匯出
- PDF 列印版輸出

## Database
主要正式表包含：
- `customers`
- `games`
- `quotes`
- `quote_items`
- `quote_platforms`
- `quote_status_logs`
- `billing_records`
- `import_jobs`
- `import_job_rows`
- `roles`
- `permissions`
- `user_roles`
- `role_permissions`

完整 SQL：
- [database/mysql_game_qa_platform_schema.sql](database/mysql_game_qa_platform_schema.sql)
- [database/migrate_shop_to_game_qa_platform.sql](database/migrate_shop_to_game_qa_platform.sql)

## Release Flow
### 本機發版前檢查
```powershell
npm run release:check
```

### 版本號更新
```powershell
npm run release:patch
npm run release:minor
npm run release:major
```

### 推送版本 tag
```powershell
git push origin main --follow-tags
```

當 `v*.*.*` tag 被推上 GitHub 時，GitHub Actions 會自動：
- 啟動 MySQL 測試環境
- 執行 `npm run release:check`
- 建立 GitHub Release
- 附上 schema、migration、release 文件

Workflow 檔案：
- [.github/workflows/release.yml](.github/workflows/release.yml)

完整說明：
- [docs/release-process.md](docs/release-process.md)

## Notes
- `.env` 不應提交到 Git
- 匯入暫存檔已由 `.gitignore` 排除
- 若 release 含 schema 變更，先執行 `npm run migrate`
- 若要搬舊 `shop` 資料庫，請先閱讀 [docs/shop_to_game_qa_platform_migration.md](docs/shop_to_game_qa_platform_migration.md)
