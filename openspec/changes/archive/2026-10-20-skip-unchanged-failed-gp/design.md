# Design

## 沿用 FAILED，不新增 NEEDS_REVIEW

#1098 的提案草稿想重用 Tribunal v2 的 `NEEDS_REVIEW`／rc=3。實際上 publisher、監控、告警與兩個 selector 都已經把 `FAILED` 當成「已評分但沒過」的 metadata，GP 的失敗分數也照常寫回 frontmatter、照 floor 規則上線。差別只在「要不要再領」，所以只在 `FAILED` 項目多記一個 `inputFingerprint`，由 selector 決定跳過。這樣 exit code、publisher 分類與告警都不用動。

## 指紋用 reader revision

指紋是 zh-tw 與 English 檔各自的 reader revision（`scripts/reader-revision-of-stdin.mjs`）。它排除分數等 backend frontmatter，所以 GP 失敗時寫回的分數不會讓指紋變；worker worktree 發佈回 main repo 的 bytes 也一樣，selector 在 main repo 算出的值會對得上。投影欄位已凍結，不會因 supervisor／worker 版本差異而飄。

只改 reader revision 沒涵蓋的 frontmatter（例如 `translatedBy`）不會讓 GP 重新排隊；這種情況手動跑 `tribunal.sh` 即可。

## 修改後次數與 stages 歸零

指紋不同代表評審看到的是新內容。`init_article_progress` 這時把 `topLevelAttempts` 與 `stages` 歸零：不歸零的話，舊內容累積的次數會讓修好的文章一進場就變 `EXHAUSTED`；不清 stages 的話，舊內容的 PASS 會被 crash-resume 沿用。

## Fail open

指紋算不出來（node 或依賴壞掉）時 selector 照舊選文，等於回到修正前的行為，不會讓文章永久卡住。

## 取捨

- 模型或 prompt 改了不會自動重評；這類語意變更照既有慣例要 bump `tribunalVersion`。
- #1099 的 FactChecker 來源 packet 落地後，packet hash 應一起進指紋。
