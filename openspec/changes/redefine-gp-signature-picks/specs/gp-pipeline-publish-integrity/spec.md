## MODIFIED Requirements

### Requirement: 寫作指令的說明與錯誤訊息 SHALL NOT 邀請撰寫 Lv

`write`、`review`、`refine` 的說明，`run`、`candidate` 與 root help 裡描述可撰寫系列的文字，以及 `run`、`write` 缺少 `--prefix` 時列出的可用系列，SHALL NOT 把 Lv 列為 pipeline 可以撰寫的系列。`run --help` SHALL 說明 Lv 檔只能從 `translate` 或 `deploy` 恢復。`counter`、`dedup`、`deploy` 等非寫作指令的說明與錯誤訊息 SHALL 繼續列出 Lv。

#### Scenario: 查看 write 的說明

- **WHEN** 操作者執行 `gp-pipeline write --help`
- **THEN** `--prefix` 的說明 SHALL 只列出 MP、SD
- **AND** 說明 SHALL NOT 宣稱 `write` 可以撰寫 Lv 或 GP

#### Scenario: write 沒帶 prefix

- **WHEN** 操作者執行 `gp-pipeline write --source <檔案>`，沒有帶 `--prefix`
- **THEN** 指令 SHALL 以 exit code 1 結束，錯誤訊息列出的可用系列 SHALL 是 MP、SD，SHALL NOT 包含 Lv 或 GP

#### Scenario: 查看 counter 的說明

- **WHEN** 操作者執行 `gp-pipeline counter bump --help`
- **THEN** `--prefix` 的說明 SHALL 繼續列出 Lv

## REMOVED Requirements

### Requirement: GP SHALL 以導讀流程產出並在發布前蓋章

**Reason**: GP 不再是導讀，而是 ShroomDog 指定、由 MP 升格的招牌文章（`gp-signature-picks`）；來源距離章也整個退役（`source-distance-stamp`）。pipeline 不再需要 GP 專屬的寫作 prompt、post-fixer 步驟、`source-distance` 步驟、只評分的 `ralph` 分支或英文逐字檢查。

**Migration**: 有來源的新文章一律用 `--prefix MP` 跑 pipeline；ShroomDog 指定成 GP 的文章，依 `gp-signature-picks` 用 `scripts/reclassify-post.mjs` 升格；pipeline 的寫作入口拒絕 GP、GP 仍可用的步驟與 help 文字也都寫在 `gp-signature-picks`；`--from-step source-distance` 變成未知步驟。只對 GP 生效的 glossary 術語 context 跟著 GP 分支移除；擋下 `ShroomDogNote` 的檢查改成不分系列，見「寫作步驟 SHALL 拒絕含 `ShroomDogNote` 的模型輸出」。

## ADDED Requirements

### Requirement: 寫作步驟 SHALL 拒絕含 `ShroomDogNote` 的模型輸出

`write` 與 `refine`（含 `run` 裡的這兩步）的模型輸出使用或 import `ShroomDogNote` 時，不論系列，該步驟 SHALL 以 exit code 14 失敗。這份輸出 SHALL 移到旁邊留作證據，SHALL NOT 留在草稿的位置，之後的步驟與 `--from-step` 恢復都 SHALL NOT 拿它當草稿，也 SHALL NOT 寫進 `src/content/posts/`。`write` 與 `refine` 的 prompt SHALL 對每個系列說明不得寫 `ShroomDogNote`，`review` SHALL 把它列為 Blocker。

#### Scenario: MP 的 write 寫出 ShroomDogNote

- **WHEN** `gp-pipeline write --prefix MP` 的模型輸出含 `<ShroomDogNote>`
- **THEN** 指令 SHALL 以 exit code 14 結束
- **AND** 工作目錄 SHALL NOT 留下以這份輸出當內容的 `draft-v1.mdx`

#### Scenario: SD 的 refine 寫出 ShroomDogNote

- **WHEN** SD 草稿的 refine 輸出 import 了 `ShroomDogNote`
- **THEN** 該步驟 SHALL 以 exit code 14 失敗
- **AND** 這份輸出 SHALL NOT 成為 `final.mdx`，也 SHALL NOT 進到 `src/content/posts/`
