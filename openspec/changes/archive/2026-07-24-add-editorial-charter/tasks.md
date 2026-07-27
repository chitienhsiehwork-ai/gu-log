## 1. Charter spec

- [x] 1.1 建立 `openspec/changes/add-editorial-charter/proposal.md`，說明北極星缺口、drift 痛點、與 `add-editorial-spine-rebuild` 的關係。
- [x] 1.2 建立 `openspec/changes/add-editorial-charter/specs/editorial-charter/spec.md`，把 user 已拍板的 ①–⑤ 寫成可引用 requirements。
- [x] 1.3 在 spec 中把「重組敘事 = 改 packaging，不改 payload」寫成 GP/MP body 的單點權威定義。
- [x] 1.4 在 spec 中保留「原作者一句話測試」與「我改的是怎麼講，還是講了什麼」自檢句。
- [x] 1.5 在 spec 中定義 Lv-原創 mode 與 Lv-導讀 mode，包含 Lv-導讀開頭 cite ref 與轉述不得扭曲的底線。
- [x] 1.6 在 spec 中定義四系列一句話定位。
- [x] 1.7 在 spec 中定義 MOBA register policy，並標明 on-site MOBA glossary 是 follow-up。
- [x] 1.8 建立 `openspec/changes/add-editorial-charter/design.md`，記錄設計決策（D1–D6）、被否決的替代方案與 risks，補上 propose 階段漏掉的 how/why 層。

## 2. 文件收斂

- [x] 2.1 把 `CONTRIBUTING.md` 中 GP/MP、Lv、系列定位與 note/body 邊界相關段落降級成 derived view，指向 `openspec/specs/editorial-charter/spec.md`。
- [x] 2.2 把 `GU-LOG_WRITER_PROMPT.md` 中 editorial identity、body/note 邊界、MOBA register 相關段落改成引用 charter，不再重複定義 first-principles。
- [x] 2.3 把 `CLAUDE.md` / `AGENTS.md` 中 gu-log purpose / audience / success 相關敘述改成 derived view，指向 charter。
- [x] 2.4 更新 Tribunal judge prompts，讓 Fresh Eyes 的 persona 從「泛泛三個月工程師」重新指向「user 會丟連結的那個同事」，並明確 Fresh Eyes 只守可分享下限。
- [x] 2.5 已由 `rebrand-mogu-gp-mp-taxonomy` change 收斂品牌：ShroomDog 保留作者身份、Mogu 是 persona / automation identity，GP / MP 是正式系列名。

## 3. 開場路由

- [x] 3.1 在 `scripts/detect-env.sh` 或其輸出的 playbook routing 中新增 content / editorial work 的 charter 入口提示。
- [x] 3.2 在 `playbooks/local-agent-playbook.md` 補上：local machine actor 進行寫文、修文、內容規則、writer prompt、judge prompt 工作前 MUST 讀 `openspec/specs/editorial-charter/spec.md`。
- [x] 3.3 在 `playbooks/CCC-playbook.md` 補上相同 charter 入口規則，避免 Cloud worker 漏讀。
- [x] 3.4 routing 已指向 archive 後的 stable path `openspec/specs/editorial-charter/spec.md`，並與本 change 同一個 PR 完成 sync + archive。

## 5. Validation

- [x] 5.1 `openspec validate add-editorial-charter --strict` 通過。
