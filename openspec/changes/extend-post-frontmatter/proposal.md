## Why

`add-dedup-policy` 已經在 `dedup-taxonomy` 跟 `dedup-policy` 兩份 spec 裡定義了五維分類跟四條規則，但這些規則要能真正被 dedup-gate 跟 tribunal 執行，前提是每篇文章的 frontmatter 裡要有對應欄位讓它們讀。目前 `src/content/config.ts` 的 Zod schema 缺以下欄位：`sourceType`、`temporalType`、`authorCanonical`、`authorType`、`clusterIds`、`seriesId`、`dedup.*`、`metadata.gateWarnings`。

既有 922 篇文章沒有這些欄位；若直接把新欄位設成必填，下一次 Vercel build 會因為 Zod 驗證失敗而整個失敗。因此本 change 同時要定義「遷移策略」，確保新欄位變必填的過程不會弄壞 production。

## What Changes

### 新欄位（必填）

- `sourceType: 'primary' | 'derivative' | 'commentary'`
- `temporalType: 'event' | 'evergreen' | 'hybrid'`
- `authorCanonical: string`
- `authorType: 'individual' | 'org' | 'proxy'`
- `clusterIds: string[]`（可為空陣列；空陣列代表「目前未納入任何 cluster」）

### 新欄位（選填）

- `seriesId?: string`（有意識的系列標記；`seriesId` 以 `kebab-case`）
- `dedup?: { independentDiff?, acknowledgedOverlapWith?, overlapJustification?, humanOverride?, humanOverrideReason?, commentaryAngle? }`
- `metadata?: { gateWarnings?: string[] }`

### 結構性約束（schema 層 cross-field invariants）

- `status = deprecated` ↔ `deprecatedBy` 必填
- `dedup.humanOverride = true` → `dedup.humanOverrideReason` 必填
- `dedup.acknowledgedOverlapWith` 非空 → `dedup.overlapJustification` 必填
- `authorType = proxy` → `author` 欄位不可與 `authorCanonical` 完全相同（代理人須與真正作者身分區分）

### 遷移策略（A 方案：硬性一次到位）

執行順序：

1. schema 新欄位以 `.optional()` 上線（短期施工支架，避免 build 破壞）
2. 腳本 `scripts/backfill-dedup-frontmatter.mjs` 分段補 922 篇
   - 第一段：機械補 `authorCanonical`、`authorType`、`sourceType` 初判（從既有 `source` / `sourceUrl` 欄位）
   - 第二段：語言模型補 `temporalType`、`clusterIds`、`sourceType` 複核；每 50 篇一個 commit
   - 第三段：隨機抽 30 篇給 user 審，通過後整批放行
3. 補完後同一個 commit 把 `.optional()` 拔掉變成必填，永久鎖緊
4. 事後若發現誤判 → 當場改那一篇 + commit 訊息寫 `fix: 修正 <ticketId> 分類`

### 新能力 (capability)

- `extended-post-frontmatter`：frontmatter schema 能承載 dedup 分類 + 編輯宣告所需所有欄位

### 被排除的項目

- **規則層面的跨文章驗證**（derivative 必須有 independentDiff、同作者觸發門檻）→ 留給 `dedup-gate`（Level F）跟 `librarian dupCheck`（Level E）。schema 只做「單兵檢查」，不做「部隊檢查」。
- **cluster 命名規範**（如何生成 clusterId、誰擁有 cluster）→ 留給 Level E 跟 Level G。本 change 只要求 `clusterIds` 是字串陣列，不規範內容格式。

## Impact

### Affected specs

- `extended-post-frontmatter`（新 capability）

### Affected code

- `src/content/config.ts`：擴充 Zod schema，新增 refine 條件
- `scripts/backfill-dedup-frontmatter.mjs`（新）：遷移腳本
- `scripts/validate-posts.mjs`：可能需同步加新欄位檢查（若已有的話）
- `pnpm run build`：完成遷移前不影響，遷移中 `.optional()` 暫存期亦不影響

### Depends on

- `add-dedup-policy`（Level A + B）：本 change 的欄位命名與結構來自其 taxonomy + policy 定義。建議先 archive `add-dedup-policy`，使 `openspec/specs/dedup-taxonomy/` 跟 `openspec/specs/dedup-policy/` 成為 SSOT，再進本 change；若 user 同意順序對調也可併行。

### Blocks

- Level D（`add-dedup-eval-harness`）：evals 要讀這些欄位才能組 golden dataset
- Level E（`add-librarian-dupcheck`）：Librarian 要讀這些欄位做判定
- Level F（`add-semantic-dedup-gate-layers`）：gate 要讀這些欄位做規則判定
