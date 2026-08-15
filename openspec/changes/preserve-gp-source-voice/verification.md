# 驗證證據

## Shadow 比較

2026-08-15 以四種既有 GP source 做 non-deploy shadow run。比較的是抓回的完整 source、production 現行正文，以及新 `source-translate` 輸出；正式文章均未修改。

| 案例 | 類型 | Source | 現行 production | 新輸出 | 結果 |
|---|---|---:|---:|---:|---|
| GP-273 | 第一人稱 essay | 6,360 bytes | 8,438 bytes | 6,291 bytes | 新輸出保留第一人稱與原段落推進；現行版改成第三人稱並新增品牌化小標與 framing。最終 source／natural gates 均 PASS，且不含「銜尾蛇」「演算法動態」。 |
| GP-175 | 技術文章 | 26,141 bytes | 11,923 bytes | 7,173 bytes | 新輸出的主段落依 source 順序走 interaction sessions、effort、adaptive thinking、behavior changes；現行版另造「太聽話」「開大火力」等 pitfall spine。抓回的 source 含大量網站導覽與 cookie chrome，因此這份輸入不符合 production source-capture contract；本案例只驗證 shadow routing，不得發布。 |
| GP-219 | 短文 | 6,982 bytes | 4,345 bytes | 6,350 bytes | 新輸出保留原作者從研究、工程到判斷力的完整論證與第一人稱收束；現行版大幅壓縮成三個編輯小節。 |
| GP-53 | 原文本身含 AI 贅文的長教學 | 26,563 bytes | 14,129 bytes | 26,424 bytes | 新輸出保留 17 個 phase、命令與警告，長度接近 source；現行版壓成可靠度 review。這證明預設是保留原文，不會因為來源像 AI 寫的就擅自重建。 |

Bytes 只用來觀察是否異常壓縮或膨脹，不是品質門檻；真正門檻仍是 source-preservation contract 與 gate verdict。

## GP-273 完整 gate

- Source Reviewer：PASS，實際執行 model 與 provider provenance 已寫入 fresh manifest。
- Vibe Scorer：PASS，使用不同 model、不同 prompt，只讀 canonical body。
- Aggregate verdict：PASS；manifest 的 source 與 body hashes 都和最終正文相符。
- Deterministic natural-language findings：空。
- Bounded recovery 曾修正 reviewer 圈出的局部片語；每次修正後兩個 gate 都全量重跑。有限次數後仍失敗時 pipeline 會停住，不會進 deploy。

## Model 與 provider 實測

- Translator 使用 Grok 4.6，低 reasoning effort；shared OAuth 登入、model listing、一般 request 與 native JSON schema structured output 都通過。
- Source Reviewer 與 Corrector 使用相同 model family 但不同角色 prompt；Vibe Scorer 改用另一個 model，符合 translator、corrector、vibe scorer 三者 model ID 不同的契約。
- Grok 4.5 在最小 request 與 structured output request 可用，但完整文章 cold read 多次長時間無結果；不適合目前的 hard gate latency/reliability。
- 另一個候選 scorer 雖較快，卻在 GP-273 已知不自然片語仍存在時誤判 PASS；未採用。
- Model ID、provider 與 effort 的唯一設定來源是 `config/llm-pipeline.json`，本文件不把候選比較寫成 routing contract。

## 手機閱讀檢查

以 390 × 844 viewport 在本機 Astro preview 開啟 GP-273 shadow article，從首屏捲到頁尾：

- 正文是單欄，標題、source、段落、頁尾導覽與留言區沒有水平溢位或遮擋。
- 首屏可讀到約四段正文；完整 16 段都存在於 accessibility snapshot。
- Console 只有本機開發環境的 analytics／留言 iframe 網路訊息，article render 沒有錯誤。

測試用 GP-999 article 已在驗證後移除，未加入 git，也未部署。
