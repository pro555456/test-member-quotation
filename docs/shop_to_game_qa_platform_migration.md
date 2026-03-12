# shop -> game_qa_platform 搬遷步驟

## 1. 備份舊資料庫
```powershell
mysqldump -u root -p --databases shop > backup-shop.sql
```

## 2. 建立新資料庫
```sql
CREATE DATABASE game_qa_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 3. 匯入正式版 schema
在專案根目錄執行：
```powershell
mysql -u root -p game_qa_platform < database/mysql_game_qa_platform_schema.sql
```

## 4. 將舊 shop 資料搬到新庫
這支 SQL 會自動檢查舊庫中哪些表存在，再把可搬的資料搬進 `game_qa_platform`：
```powershell
mysql -u root -p < database/migrate_shop_to_game_qa_platform.sql
```

## 5. 跑專案 migration 做補齊與回填
這一步會補齊專案 code-first migration 的欄位、seed 和 `inspection_quotes -> quotes / quote_items / billing_records` 的正式回填。
```powershell
npm run migrate
```

## 6. 如果舊庫沒有報價資料，再從 Excel 匯入
```powershell
npm run import:quotes "D:\桌面2\遊戲檢測總表.xlsx" 2025 --dry-run
npm run import:quotes "D:\桌面2\遊戲檢測總表.xlsx" 2025
```

## 7. 啟動並驗證
```powershell
npm test
npm run smoke
npm run dev
```

## 建議檢查 SQL
確認新庫資料量是否合理：
```sql
SELECT COUNT(*) AS users_count FROM game_qa_platform.custaccount;
SELECT COUNT(*) AS legacy_quotes_count FROM game_qa_platform.inspection_quotes;
SELECT COUNT(*) AS quotes_count FROM game_qa_platform.quotes;
SELECT COUNT(*) AS quote_items_count FROM game_qa_platform.quote_items;
SELECT COUNT(*) AS billing_records_count FROM game_qa_platform.billing_records;
```

## 說明
- 專案現在預設連到 `game_qa_platform`。
- `database/migrate_shop_to_game_qa_platform.sql` 會搬帳號、權限、token、舊相容表 `inspection_quotes`，如果舊庫已經有正式表 `quotes` 等，也會一併搬。
- 如果你確定新庫驗證完成，再考慮把舊 `shop` 改成唯讀備份或另外封存。
