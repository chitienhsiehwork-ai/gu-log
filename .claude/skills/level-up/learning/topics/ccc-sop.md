# CCC SOP (gu-log)

## Current Level
- Status: mastered (Lv.1–7)；boss（stream idle timeout）未打
- Last updated: 2026-06-18
- Confidence: high — 七關 MCQ 全部一次答對

## Evidence
- 2026-06-18 Lv.1 拋棄式 sandbox／commit≠push（答 C，對）
- 2026-06-18 Lv.2 autonomy scope／不問笨問題（答 A，對）
- 2026-06-18 Lv.3 CI = 縱深防禦，本地 hook 可被跳過、CI 跳不掉（答 C，對）
- 2026-06-18 Lv.4 CD = merge 觸發 Vercel 自動部署（答 C，對）
- 2026-06-18 Lv.4.5 主動追問 webhook 機制；原本以為「GitHub 命令 Vercel」，自己修正成「GitHub 廣播 / Vercel 訂閱反應」（答 B，對）→ event-driven 有 intuition
- 2026-06-18 Lv.5 self-merge 三連 + critical-decision stop（答 C，對）
- 2026-06-18 Lv.6 收尾鐵則 prod / preview / question（答 B，對）
- 2026-06-18 Lv.7 tribunal floor≥3 ship／pass≥8 上首頁／不准灌水（答 A，對）

## Known Gaps
- 尚未打 boss：CCC-only stream idle timeout + /tmp chunks workaround（First-Error-Means-Switch）
- tribunal 門檻細節：learner 抓到我先前憑記憶講的 floor/pass 表 drift；已用 ground-truth 重講（見 Teaching Notes）

## Teaching Notes
- Vainglory 對映（已驗證有效，沿用）：
  - 拋棄式 sandbox = 一局結束局內金幣裝備蒸發，只有贏（push）進戰績
  - detect-env = 選角（Carry=CCC / Captain=mac-CC）
  - CI = 你和 Vain 之間那排 turret，全倒才碰得到 Vain
  - CD = 砸爆 Vain 自動結算（webhook 廣播 / Vercel 訂閱）
  - self-merge 三連 = 免費 Kraken 直接拿、別刷問號 ping
  - 收尾鐵則 = 回城要在小地圖留個能點的 ping
  - tribunal = 四人評審團，floor=至少能上場、pass=上 leaderboard
- learner 是高端玩家，可用更進階的 Vainglory 機制。

## Ground-truthed tribunal facts (2026-06-18, 取代先前憑記憶的 drift 版)
- FLOOR（commit gate, `scripts/score-floor-check.mjs`）：`scores.vibe` 需 5 維齊（persona/clawdNote/vibe/clarity/narrative）+ composite≥3，composite=floor(sum/5)。PENDING 草稿、純 housekeeping、純連結維護、en 版、deprecated/retired、無分數舊文 → 豁免。
- PASS / 首頁（`src/utils/post-status.ts` getIndexPosts + `tribunal-scores.ts` PUBLISH_BAR=8）：首頁只擋「有分數且 overall composite<8」的；overall=floor(各評審 composite 平均)。無分數舊文 grandfathered，照留首頁。
- Vibe 維（5）：persona / clawdNote / vibe / clarity / narrative；bar = composite≥8 且 ≥1 維≥9 且無維<8。clarity 定義 = 代名詞/聲音歸屬（誰在講話）。
- Fresh Eyes 維（4）：readability / firstImpression / payoffDensity / lengthFit；bar = composite≥8 且 payoffDensity≥8 且 lengthFit≥8（非補償）。

## Next Suggested Levels
- 👑 Boss: stream idle timeout / /tmp chunks
- 進階線（learner 要求）：用 OpenSpec 做「clarity 從 vibe 移到 fresh eyes」的 SDD → TDD → 實作
