## ADDED Requirements

### Requirement: FactChecker 改寫 MAY 原子修正讀者可見摘要

部署版 parent runner MAY 只在 `factChecker` 失敗後的有界改寫，允許寫手替換既有頂層單一實體行、帶引號的 `summary` 字串內容。這項權限 SHALL 由 runner 依 stage 推導，不得由寫手、prompt、文章內容、provider 或另一個可矛盾的參數升級。English sidecar 存在時，zh-tw／English 摘要 SHALL 兩邊都改或兩邊都不改；沒有 sidecar 時 MAY 只修正 zh-tw，且不得建立新的 English 檔。其他 judge rewrite 與 final-build repair SHALL 維持全部 frontmatter 不可變。

允許的內容替換之外，summary key、位置、quote style、行尾與所有 frontmatter bytes SHALL 維持不變。候選捕獲 SHALL 封閉拒絕重複鍵（包含帶引號或明確鍵形式）、多行／block／plain／tagged／anchored scalar 及 malformed escape。捕獲、驗證、套用與 CAS rollback SHALL 使用同一個由 stage 推導的 policy；crash recovery SHALL 依 journal 保存的完整 bytes 與 identity 維持 policy-neutral 的既有雙語 crash-atomic 邊界。摘要候選仍 SHALL 由下一輪 FactChecker 重新評分，不得直接取得 PASS。

#### Scenario: FactChecker 修正雙語摘要後重新驗證

- **WHEN** `factChecker` 因既有 zh-tw `summary` 的事實錯誤判定失敗，且 English sidecar 存在
- **THEN** parent runner MAY 允許 writer 在隔離候選中成對替換兩個既有單行 quoted `summary` payload
- **AND** 兩個語言檔除 summary payload 外的 frontmatter bytes SHALL 完全等於各自 baseline
- **AND** candidate SHALL 先通過既有 post／YAML validation，再以雙語 CAS 套用
- **AND** 下一輪 FactChecker SHALL 重新讀取套用後的文章並依既有 pass bar 判斷
- **AND** summary 替換本身 SHALL NOT 直接取得 PASS

#### Scenario: Writer 嘗試改動受保護 frontmatter

- **WHEN** writer 新增、刪除、搬移或改動非 `summary` frontmatter，改變 summary 的 key／quote style／行結構，產生 duplicate／multi-line／block／plain／tagged／anchored summary，或只改雙語 pair 的其中一邊
- **THEN** candidate capture SHALL 封閉失敗並保留 canonical pair
- **AND** quoted key、explicit key 與其他不支援的 YAML key 形狀 SHALL NOT 繞過 duplicate-summary 拒絕
- **AND** runner SHALL NOT 把該候選視為成功改寫

#### Scenario: 沒有 English sidecar 的 FactChecker 摘要修正

- **WHEN** `factChecker` rewrite 處理沒有 English sidecar 的文章，並只替換既有 zh-tw 單行 quoted `summary` payload
- **THEN** candidate capture MAY 接受該單語摘要候選
- **AND** runner SHALL NOT 為了滿足 paired policy 建立新的 English sidecar
- **AND** 候選仍 SHALL 經過 validation、CAS apply 與下一輪 FactChecker 重評

#### Scenario: 非 FactChecker 路徑嘗試改動摘要

- **WHEN** Librarian、FreshEyes、Vibe 或 final-build repair 的 writer candidate 改動任一 `summary`
- **THEN** transaction SHALL 只從目前 stage 推導 preserve-all policy，並封閉拒絕該候選
- **AND** writer prompt、provider 或 caller SHALL NOT 傳入另一個可矛盾的 policy 來升級權限

#### Scenario: 摘要候選在 runner validation 失敗

- **WHEN** 實際 runner 已套用合法 paired-summary candidate，但後續 validation 失敗
- **THEN** runner 的 rollback 路徑 SHALL 使用與該 stage capture／apply 相同的 policy
- **AND** CAS rollback SHALL 收斂回完整 baseline pair
- **AND** SHALL NOT 覆寫平行人工編輯

#### Scenario: 摘要候選在雙語 exchange 中途死亡

- **WHEN** 行程在合法 paired-summary candidate 的雙語 exchange 中途終止
- **THEN** policy-neutral crash recovery SHALL 只依 journal 的完整 baseline／candidate bytes 與 identity 判斷
- **AND** 最終 SHALL 收斂成完整 baseline pair 或完整 candidate pair
- **AND** SHALL NOT 產生單語新摘要或丟棄未知 journal 證據
