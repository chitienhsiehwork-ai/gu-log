## 1. Spec 內部一致性

- [ ] 確認 `specs/dedup-taxonomy/spec.md` 跟 `specs/dedup-policy/spec.md` 沒有衝突或循環引用
- [ ] 確認 5 條 Design Principles（#1 在 taxonomy、#2–#5 在 policy）之間沒有矛盾
- [ ] 確認所有 SHALL 陳述皆至少有一個 WHEN/THEN scenario

## 2. Validation

- [ ] `openspec validate add-dedup-policy` 通過
- [ ] Proposal 中列出的 2 個 capabilities（`dedup-taxonomy` + `dedup-policy`）各自皆有對應 spec

## 3. User 審核

- [ ] User（gu-log 編輯）review proposal + 兩份 spec + design
- [ ] User 確認 5 Design Principles 符合 editorial 意圖
- [ ] User 對 B-3-A 梯度數字（1–7/8–14/15–30、個人 vs 組織）表態 — 採納或調整
- [ ] 若有任何 principle / 規則調整，先回到 change 修改，再進 step 4

## 4. Archive

- [ ] `openspec archive add-dedup-policy`
- [ ] 確認 `openspec/specs/dedup-taxonomy/spec.md` 跟 `openspec/specs/dedup-policy/spec.md` 已由 archive 自動建立
- [ ] Change 目錄移至 `openspec/changes/archive/YYYY-MM-DD-add-dedup-policy/`

## 5. Hand-off to 下游 changes

- [ ] 於 memory 更新「5 Design Principles 已定案」
- [ ] Level C（`extend-post-frontmatter`）可開始 — 此 change 的 taxonomy 定義了 `clusterIds`、`sourceType`、`seriesId`、`authorCanonical` 欄位需求
- [ ] Level D（`add-dedup-eval-harness`）可開始 — evals 將校準 B-3-A 參數跟 `independentDiff` / `thesis 重疊` 門檻

## 6. Documentation（可延後）

- [ ] `CONTRIBUTING.md` 加 cross-link 至 archived specs
- [ ] `WRITING_GUIDELINES.md` 加 cross-link 至 archived specs
- [ ] 考慮在 `CLAUDE.md` 的「文件架構」段落提及 `openspec/specs/` 為 policy SSOT
