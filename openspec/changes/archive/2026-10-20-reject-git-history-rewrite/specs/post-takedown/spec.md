## MODIFIED Requirements

### Requirement: 公開 repo 的 HEAD SHALL NOT 保留下架譯文與未授權的第三方原文全文

下架文章的正文 SHALL 從 HEAD 移除。Repo SHALL NOT 在 HEAD 保存沒有授權可再散布的第三方文章或 prompt 全文擷取，或下架文章的整篇譯文；測試資料、fixture 與 `public/` 也一樣。需要長期保存的第三方原文 SHALL 放在 repo 外。ShroomDog 本人的對話紀錄 MAY 保留。只被下架文章使用的文章圖檔 SHALL 一併移除。下架與原文清理 SHALL NOT 以改寫 git 歷史（例如 `git filter-repo` 加 force-push）達成；git 歷史中的舊版譯文與原文副本保留原狀。這只涵蓋歷史 commit；tip 仍是全文、可直接瀏覽的公開 branch 不適用本條，SHALL 另行追蹤刪除或封存，並在刪除前取得 owner 同意。只有原作者實際要求移除、且要求的內容只存在於 git 歷史時，才重新評估，屆時 SHALL 先修改本要求。理由與重新評估條件見 `openspec/changes/archive/2026-10-20-reject-git-history-rewrite/design.md`。

#### Scenario: 測試需要來源與譯文 fixture

- **WHEN** 測試或 eval fixture 需要來源與譯文的內容
- **THEN** 內容 SHALL 是自寫的合成文字
- **AND** SHALL NOT 是第三方文章原文或 gu-log 已下架的譯文

#### Scenario: 正式站提供第三方 prompt 全文

- **WHEN** `public/` 底下有第三方 prompt 或文章的全文
- **THEN** 它 SHALL 被移除

#### Scenario: Agent 擷取第三方原文

- **WHEN** agent 為寫作或查證擷取第三方原文
- **THEN** 擷取結果 SHALL 留在 repo 外
- **AND** SHALL NOT commit 進 `sources/` 或其他追蹤路徑

#### Scenario: 有人提議改寫 git 歷史

- **WHEN** 有 change 或 agent 提議改寫 git 歷史，以抹掉下架譯文或原文副本
- **THEN** 它 SHALL 先修改本要求，並說明決策紀錄裡的理由為什麼不再成立
- **AND** 沒有原作者實際提出的移除要求時，SHALL NOT 執行
