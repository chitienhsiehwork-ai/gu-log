## REMOVED Requirements

### Requirement: 有外部來源的 GP SHALL 帶有效的來源距離章

**Reason**: 章只為了證明「GP 導讀不是翻譯」而存在。GP 改成 ShroomDog 指定的招牌文章，寫作與 grounding 規則跟 MP 相同（`gp-signature-picks`），MP 本來就沒有離原文距離的限制，所以已經沒有任何文章需要章。

**Migration**: `scripts/validate-posts.mjs` 拿掉驗章與「非 GP 不得帶章」的檢查；frontmatter schema 拿掉 `sourceDistance`，posts schema 是 strict，留著這個欄位的文章會直接 build 失敗。還在線上的 GP-276～279 在改成 MP 時一併刪掉 `sourceDistance`。GP 的品質改在升格時把關：`gp-signature-picks` 要求升格時通過 publish bar（`meetsPublishBar`），由 `scripts/reclassify-post.mjs` 與 pre-commit／CI 檢查。

### Requirement: 章 SHALL 綁正文投影的指紋，只存會擋人的摘要

**Reason**: 章整個退役，正文投影與指紋已經沒有使用者。

**Migration**: 刪掉 `scripts/lib/source-distance.mjs` 的投影與指紋實作、`src/content.config.ts` 的 `sourceDistance` 欄位，以及固定指紋的回歸測試。git 歷史與本 change 的 archive 保留原本的規則，日後要重啟就另提 change。

### Requirement: 原文與導讀 SHALL 以固定規則正規化與斷句

**Reason**: 正規化與斷句只供蓋章時的配對與計分使用，章退役後沒有用途。

**Migration**: 刪掉 `scripts/source-distance.mjs` 的 `segment` 與相關 lib。抓取來源給 Fact Checker 用的完整性規則不受影響，仍以 `tribunal-focal-source-evidence` 為準。

### Requirement: 句子配對 SHALL 由獨立 pin 的 Claude aligner 產生，而且只輸出配對

**Reason**: aligner 只為來源距離配對而存在，章退役後不需要第二個 Claude pin 與它的 router 路徑。

**Migration**: 刪掉 `.claude/agents/source-aligner.md`、gp-pipeline 的 aligner 呼叫與 structured output 路徑、`scripts/tribunal-model-router.sh` 與 `config/llm-pipeline.json` 的 `aligner` 角色，以及相關回歸測試。寫作步驟的 Claude pin 規則照舊由 `claude-prose-writing-runtime` 規範。

### Requirement: 擋下條件 SHALL 由程式依固定參數計算

**Reason**: 計分規則（照順序轉述、原文占比、零配對）與 policy 版本只服務來源距離章，章退役後沒有對象。

**Migration**: 刪掉計分實作、policy 常數與合成資料的單元測試。GP 與 MP 都不再有離原文距離的門檻；MP 可以貼近原文的既有規則見 `editorial-charter`〈MP body MUST be Mogu-authored and source-grounded〉。

### Requirement: 沒過 SHALL 自動改寫最多三輪，改寫看不到門檻

**Reason**: 自動改寫迴圈與 exit code 19 只用在 GP 導讀流程；gp-pipeline 不再撰寫 GP（`gp-signature-picks`）。

**Migration**: gp-pipeline 拿掉 `source-distance` 步驟、改寫迴圈與 exit code 19；`run --from-step source-distance` 改成未知步驟。要寫招牌文章時先用 `--prefix MP` 寫成 MP，再依 `gp-signature-picks` 升格。

### Requirement: 英文版 SHALL 通過逐字 n-gram 檢查

**Reason**: 英文版逐字檢查與 `englishSkipped` 標記只綁在 GP 導讀與章上；GP 改成 MP 規則後，英文版照 MP 的翻譯流程產生。

**Migration**: gp-pipeline 的翻譯步驟拿掉 GP 專屬的逐字檢查；`scripts/check-translation-pairs.mjs` 拿掉 `englishSkipped: verbatim` 的放行條件，GP 照 MP 契約，跟 MP 一樣一定要有英文版。

### Requirement: 手寫或人工修改的 GP SHALL 能用 `gp-pipeline stamp` 蓋章

**Reason**: 沒有章就不需要蓋章指令。GP 正文改由人或 agent 依 ShroomDog 指示修改後重跑 Tribunal（`gp-source-preservation`）。

**Migration**: 刪掉 `gp-pipeline stamp` 子指令與它的測試；文件裡叫人跑 `stamp --file` 的地方改成依 ShroomDog 指示修改後跑 `scripts/tribunal.sh`。
