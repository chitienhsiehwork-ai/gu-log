## 1. Schema 擴充（第一階段 — `.optional()` 短期支架）

- [ ] `src/content/config.ts` 新增欄位（全部先以 `.optional()` 或 `.default([])` 上線）
  - [ ] `sourceType: z.enum(['primary', 'derivative', 'commentary']).optional()`
  - [ ] `temporalType: z.enum(['event', 'evergreen', 'hybrid']).optional()`
  - [ ] `authorCanonical: z.string().optional()`
  - [ ] `authorType: z.enum(['individual', 'org', 'proxy']).optional()`
  - [ ] `clusterIds: z.array(z.string()).default([])`
  - [ ] `seriesId: z.string().optional()`
  - [ ] `dedup: z.object({...}).optional()`（含 6 子欄位）
  - [ ] `metadata.gateWarnings: z.array(z.string()).optional()`
- [ ] `src/content/config.ts` 新增 cross-field invariants（refine）
  - [ ] `status=deprecated` ↔ `deprecatedBy` 必填
  - [ ] `dedup.humanOverride=true` → `humanOverrideReason` 必填
  - [ ] `dedup.acknowledgedOverlapWith` 非空 → `overlapJustification` 必填
  - [ ] `authorType=proxy` → `author !== authorCanonical`
- [ ] `pnpm run build` 通過（既有 922 篇仍可 build，因為新欄位都 optional）

## 2. Backfill 腳本

- [ ] 建立 `scripts/backfill-dedup-frontmatter.mjs`
- [ ] 實作第一段「確定性提取」：
  - [ ] 從 `sourceUrl` domain 抽 `authorCanonical`
  - [ ] 查 known-org list（anthropic / openai / google / deepmind / ...）決定 `authorType`
  - [ ] 依 URL pattern 給 `sourceType` 初判（blog/docs → primary；news site → derivative；twitter/x/thread → primary or commentary 依系列判）
- [ ] 實作第二段「語言模型判讀」：
  - [ ] Prompt 要有 few-shot example（從 dedup-taxonomy spec 擷取）
  - [ ] 每篇產出 `temporalType`、`clusterIds`（至少 1 個候選）、`sourceType` 複核
  - [ ] 輸出格式為 JSON，要驗證 schema
- [ ] 實作分批 commit 機制：
  - [ ] 每補完 50 篇自動 commit
  - [ ] Commit 訊息格式：`chore(backfill): batch N (<startTicket>..<endTicket>) — temporalType+clusterIds`
  - [ ] 掛了重跑時能從上一批 commit 之後繼續（讀 git log 找斷點）
- [ ] 實作抽檢機制：
  - [ ] 每批完成後隨機抽 30 篇（種子 = 當批 git tree SHA）
  - [ ] 輸出清單到 `/tmp/backfill-batch-N-audit.md` 供 user 閱讀
  - [ ] 等 user 明確 `backfill continue` 指令才跑下一批

## 3. 執行 backfill

- [ ] 機械補全部 922 篇（第一段）
- [ ] 語言模型分批跑（第二段 + 第三段抽檢）
  - [ ] 每批執行完停機等 user 審
  - [ ] 若抽檢失敗，記錄問題 → 調整 prompt → 重跑該批
- [ ] 記錄整體耗時、總 token / API 成本到 `scripts/backfill-log.md`

## 4. Schema 收緊（第二階段 — 拔掉 `.optional()`）

- [ ] 確認 922 篇全部補完（`node scripts/validate-posts.mjs` 通過 + 手動抽查 10 篇）
- [ ] 單一 commit 同時：
  - [ ] 把 `sourceType`、`temporalType`、`authorCanonical`、`authorType` 的 `.optional()` 拔掉
  - [ ] `clusterIds` 的 `.default([])` 保留（空陣列是合法值）
  - [ ] Commit 訊息：`feat(schema): 收緊 dedup frontmatter 為必填（backfill 完成）`
- [ ] `pnpm run build` 通過
- [ ] `pnpm exec astro check` 通過（TypeScript 型別檢查）

## 5. Validation

- [ ] `openspec validate extend-post-frontmatter` 通過
- [ ] Change 的兩種 scenario 實測：
  - [ ] 故意把一篇 post 的 `sourceType` 拿掉 → build 失敗
  - [ ] 故意把 `status` 改 `deprecated` 不補 `deprecatedBy` → build 失敗

## 6. Archive

- [ ] `openspec archive extend-post-frontmatter`
- [ ] 確認 `openspec/specs/extended-post-frontmatter/spec.md` 已由 archive 自動建立
- [ ] Change 目錄移至 `openspec/changes/archive/YYYY-MM-DD-extend-post-frontmatter/`

## 7. Hand-off to 下游 changes

- [ ] 於 memory 更新「frontmatter 欄位已到位」
- [ ] Level D（`add-dedup-eval-harness`）可開始 —— golden dataset 的 case 可用新欄位標註
- [ ] Level E（`add-librarian-dupcheck`）可開始 —— Librarian prompt 可 reference 欄位
- [ ] Level F（`add-semantic-dedup-gate-layers`）可開始 —— gate 可讀欄位做規則判定
