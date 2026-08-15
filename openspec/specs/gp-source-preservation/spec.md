# gp-source-preservation Specification

## Purpose
TBD - created by archiving change preserve-gp-source-voice. Update Purpose after archive.
## Requirements
### Requirement: GP body MUST preserve the source voice

GP 正文 SHALL 讓讀者感覺是在讀原作者的自然繁中版本，而不是另一位 AI 寫手對原文的再創作。翻譯 SHALL 保留原文由誰說話、第一／第二／第三人稱、語氣強弱、段落關係、論證順序與自然停點；除非忠實直譯在繁中無法理解，否則不得更換敘事視角或重建文章骨架。

#### Scenario: first-person essay remains first person

- **WHEN** source 作者用第一人稱描述自己的經驗、情緒與判斷
- **THEN** GP 正文 SHALL 使用第一人稱翻譯
- **AND** SHALL NOT 改成「寫這篇文章的人」「他認為」或第三人稱品牌旁白

#### Scenario: source sequence remains recognizable

- **WHEN** source 的段落順序在繁中仍可自然理解
- **THEN** GP 正文 SHALL 保留該順序與段落關係
- **AND** SHALL NOT 為了製造 hook、tension、callback 或 article spine 而重排全文

### Requirement: GP body MAY remove only obvious non-payload slop

GP 翻譯者 SHALL 先翻譯完整原文，另行提出可刪除候選。只有獨立來源審查者核准、且確定性套用器驗證局部修改契約後，pipeline MAY 刪除可明確辨識、且移除後不會改變原文內容或作者個性的低價值文字。可刪範圍 SHALL 限於空洞開場、同義反覆、無資訊轉場、重複摘要、假深度包裝、模板式結語與其他不承載事實、推理、情緒、幽默或作者聲音的文字。

「AI slop」SHALL 由內容功能判斷，不得因句子平淡、線性、不像 gu-log 或未達 narrative rubric 就刪除。

#### Scenario: empty AI-style closing is removed

- **WHEN** source 結尾只用不同詞重複前文結論，沒有新增 payload、情緒或刻意的修辭效果
- **THEN** 翻譯者 MAY 提出刪除候選，但 SHALL 在初稿保留該結尾
- **AND** 只有獨立 reviewer 核准其 source boundary 與不承載 payload 的理由後，deterministic applicator 才 MAY 刪除

#### Scenario: plain but meaningful sentence remains

- **WHEN** source 句子寫得平淡但承載作者經驗、判斷、情緒、條件或論證關係
- **THEN** GP 正文 SHALL 保留其意思與位置
- **AND** SHALL NOT 為了提高 Sentence Signal、persona 或 narrative score 而改寫成金句或比喻

### Requirement: GP additions MUST be navigation or separated commentary

GP pipeline 在原文內容之外只 MAY 新增三類材料：gu-log 內部參照連結、glossary 連結，以及放在 `<MoguNote>` 內的 gu-log 評論。新增材料 SHALL 不冒充原文正文，也不得改變原文的作者聲音、主張或文章形狀。

#### Scenario: internal reference is added without rewriting prose

- **WHEN** source 概念已有直接相關的 gu-log article
- **THEN** pipeline MAY 只在最接近的既有正文文字外包上內部連結
- **AND** SHALL NOT 新增延伸閱讀文字、gu-log 自我介紹或改寫 source argument
- **AND** 沒有可直接包 link 的既有文字時 SHALL 略過該 reference

#### Scenario: glossary link adds recognition only

- **WHEN** GP body 出現已存在的 glossary term
- **THEN** pipeline MAY 對原詞加上 glossary link
- **AND** SHALL NOT 把該句擴寫成 glossary explainer

#### Scenario: gu-log opinion is separated

- **WHEN** editor 想加入 source 沒有的判斷、玩笑、類比或自我指涉
- **THEN** 該材料 SHALL 放進 `<MoguNote>`
- **AND** 移除該 note 後，GP 正文 SHALL 仍是完整且忠實的原文翻譯

### Requirement: Natural Taiwan Chinese MUST be a non-compensating publish gate

GP 的繁中正文 SHALL 使用一般台灣讀者不需停下來解碼的自然中文。準確但罕見的典故、沒有通行語感的直譯組合，以及只有 model 能從字面拼出意思的詞，SHALL 視為未通過；其他品質分數不得補償此失敗。

#### Scenario: obscure metaphor is replaced with direct language

- **WHEN** 翻譯使用「生產力銜尾蛇」等需要讀者先知道神話符號才能理解的比喻
- **AND** source 的意思可用直接、自然的中文表達
- **THEN** GP body SHALL 改用直接說法，例如「為了提高生產力，不斷製造更多提高生產力的工作」
- **AND** SHALL NOT 因該比喻看似生動或符合 persona 而保留

#### Scenario: opaque feed translation is rejected

- **WHEN** 翻譯用「演算法動態」指稱由推薦演算法持續供應的 social feed、Reels 或短影音動態
- **THEN** GP body SHALL 依 source 實際所指改成「無限滑的推薦動態」「短影音動態」或其他自然且具體的說法
- **AND** SHALL NOT 發布無法讓讀者辨識產品行為的合成詞

### Requirement: GP corrections MUST be evidence-bounded patches

GP review SHALL 對每個問題提供 source evidence、問題類型與允許修改的範圍。後續 correction SHALL 只修改被指出的局部內容；不得以 refine、vibe improvement 或 pass-score optimization 為由自由重寫全文。

每個 finding／patch SHALL 綁定 source 與 translation SHA-256，並包含 exact old text、old-text hash、start/end byte offsets 與 suggested replacement。Boundary SHALL 限於單一句子或單一段落。Applicator SHALL 拒絕 stale hash、offset/text 不符、overlap、跨段落、frontmatter、完整文章輸出，以及 boundary 外任何 byte 變動。

#### Scenario: factual issue receives a local correction

- **WHEN** reviewer 發現一個 hedge 遺失或數字翻錯
- **THEN** correction SHALL 只修正 finding 明列的相關句子
- **AND** 任何相鄰銜接修改 SHALL 另立 finding 與 boundary
- **AND** SHALL 保留其他未被指出的段落與 source voice

#### Scenario: low vibe score cannot trigger GP rebuild

- **WHEN** GP 的 persona、vibe 或 narrative judge 給出低分
- **BUT** body 已忠實、完整且自然地翻譯 source
- **THEN** pipeline SHALL NOT 觸發 restructure、rebuild 或全文 rewrite
- **AND** SHALL 將該分數視為不適用或 scorer calibration evidence

### Requirement: GP text roles MUST use independent models and contracts

GP translator、bounded corrector 與 vibe scorer SHALL 使用三個不同 model ID，並各自使用只包含該角色責任的 prompt 與輸出 schema。任何角色 SHALL NOT 取得另一角色的 hidden reasoning，pipeline SHALL NOT 因 provider failure 而把任務靜默改派給另外兩個角色使用中的 model。

#### Scenario: translator cannot optimize for its own vibe rubric

- **WHEN** translator 產出 source-aligned 繁中正文
- **THEN** translator prompt SHALL NOT 包含 persona、narrative、callback、MoguNote density 或 vibe score optimization 指令
- **AND** vibe scorer SHALL 使用不同 model 與獨立 cold-read prompt

#### Scenario: corrector only returns bounded patches

- **WHEN** corrector 收到一組已核准 review findings
- **THEN** corrector SHALL 使用不同於 translator 與 vibe scorer 的 model
- **AND** 輸出 SHALL 只能包含符合 patch schema 的局部修改
- **AND** SHALL NOT 輸出完整重寫文章

#### Scenario: unavailable role fails closed

- **WHEN** 任一必要角色的指定 model 不可用、runner error 或 provenance 無法驗證
- **THEN** pipeline SHALL 保留 failure evidence 並停止該次 publish
- **AND** SHALL NOT 靜默換成 translator、corrector 或 vibe scorer 已使用的 model

### Requirement: GP enrichment MUST preserve a canonical body projection

GP navigation 與 MoguNote enrichment SHALL 在 source-aligned body 凍結後執行。Pipeline SHALL 透過 canonical body projection 移除 MoguNote nodes、剝除 allowlist 內連結 wrapper，並保留其他 MDX 結構與文字節點；enrichment 前後 projection bytes 與 SHA-256 SHALL 完全相同。

#### Scenario: link wrapper preserves body text

- **WHEN** navigation enricher 對既有 glossary term 或 gu-log reference 加上允許的 link wrapper
- **THEN** 移除該 wrapper 後 SHALL 得到和 enrichment 前完全相同的文字與節點順序

#### Scenario: enrichment prose is rejected

- **WHEN** enrichment 在 MoguNote 之外新增文字、改寫 heading、重排節點或加入未知 component
- **THEN** canonical body projection SHALL 不相符
- **AND** pipeline SHALL 拒絕該 enrichment

### Requirement: GP publication MUST fail closed on source-preservation gates

GP 只有在 source fidelity、source voice preservation、自然中文與內容完整性 gate 全部通過後才 SHALL publish。任何上述 gate FAIL、runner error 或缺少有效 verdict 時，pipeline SHALL 停在可檢查狀態，不得 best-effort deploy。

有效 verdict SHALL 是版本化 envelope，包含 gate 名稱、source SHA-256、canonical body projection SHA-256、`PASS`／`FAIL`、結構化 findings 與完整 provider/model/harness provenance。Aggregate manifest SHALL 另綁定完整 executable role profile 的 fingerprint；model、provider、prompt 或 output contract 任一設定改變後，舊 manifest SHALL 視為 stale。Source Reviewer SHALL 負責 fidelity、voice、person、order 與 completeness；獨立 Vibe Scorer SHALL 負責自然台灣中文 cold read。Correction 後所有必要 gate SHALL 重跑。

#### Scenario: tribunal failure blocks deployment

- **WHEN** 任一 source-preservation hard gate FAIL 或無法產生有效 verdict
- **THEN** pipeline SHALL NOT 執行 deploy
- **AND** SHALL 保留 source、translation、review 與 failure evidence 供恢復

#### Scenario: recovery cannot reuse stale verdict

- **WHEN** `--from-step`、`--file` 或 deploy recovery 發現 source 或 canonical body hash 和 verdict 不符
- **THEN** pipeline SHALL 視為缺少有效 verdict並重跑必要 gate，或停止發布
- **AND** SHALL NOT 沿用舊 PASS

#### Scenario: role profile change invalidates prior manifest

- **WHEN** translator、source reviewer、corrector、commentary 或 vibe scorer 的 model、provider、prompt contract 或 output contract 在 PASS 後改變
- **THEN** deploy SHALL 拒絕舊 manifest 並要求重新執行適用的 GP stages
- **AND** SHALL NOT 只因 source/body hash 沒變就沿用舊 PASS

#### Scenario: enriched article cannot reconstruct frozen translation

- **WHEN** recovery 只有 production article，但缺少原 run 的 `source-translation.mdx`
- **THEN** pipeline SHALL 停止並要求原 frozen artifact
- **AND** SHALL NOT 把可能已有 MoguNote 或 glossary wrapper 的 published article 冒充 source-aligned translation 再跑 enrichment

### Requirement: GP rebuild prohibition MUST override generic editorial modes

GP source translation SHALL NOT 進入 `restructure` 或 `rebuild`。任何通用 editorial mode capability 在套用於 GP 前 SHALL 先服從已 archive 的 GP source-preservation contract；低 persona、narrative 或 vibe 分數不得重新授權全文改寫。

#### Scenario: generic rebuild proposal cannot capture GP

- **WHEN** 通用 editorial judge 將忠實且自然的 GP 判為 structural fail
- **THEN** routing SHALL 拒絕 `restructure` 與 `rebuild`
- **AND** SHALL 只接受有 source evidence 的 bounded correction，或保留原文翻譯

### Requirement: GP-273 MUST calibrate source-preserving behavior

Pipeline tests SHALL 使用 GP-273 的自然第一人稱直譯稿與已發布第三人稱改寫稿作為 regression pair。評估 SHALL 驗證系統偏好保留第一人稱直譯稿，並拒絕將後者的額外比喻、第三人稱視角、重複結語與品牌化 framing 視為品質提升。

#### Scenario: regression prefers the direct translation

- **WHEN** evaluator 比較 GP-273 的 source-aligned first-person translation 與 rewritten published version
- **THEN** source-preservation gate SHALL 接受前者作為較符合 GP contract 的版本
- **AND** SHALL flag 後者的 voice-owner change、unsupported packaging 與不自然用語

### Requirement: GP translator MUST receive canonical glossary terminology

GP source-translation runtime SHALL 在產生翻譯 prompt 前，從 glossary 資料讀取所有宣告 `forbiddenZhTw` 的項目，並只把標準 `term` 與對應禁用字串注入術語 context。翻譯者 SHALL 遵守該 context，且 SHALL NOT 在 prompt template 另存一份具體詞彙對照表。

術語 context SHALL 是 source translator 的版本化 prompt contract；其內容改變後，既有 role-profile fingerprint 與 publish-gate manifest SHALL 視為 stale。

#### Scenario: Agent rule reaches translator dispatch

- **WHEN** `Agent` glossary 項目宣告一個 `forbiddenZhTw` 譯名
- **AND** pipeline 產生 source translator prompt
- **THEN** 實際送給翻譯者的 prompt SHALL 同時包含標準用詞 `Agent` 與該禁用譯名
- **AND** SHALL 指示翻譯者使用標準用詞，而不是等發布檢查才發現違規

#### Scenario: prompt does not duplicate glossary data

- **WHEN** glossary 的標準用詞或 `forbiddenZhTw` 設定改變
- **THEN** 翻譯 prompt 的術語 context SHALL 由 runtime 資料重新產生
- **AND** source translator template SHALL NOT 需要同步修改具體詞彙清單

#### Scenario: terminology contract invalidates stale gate

- **WHEN** 注入翻譯者的術語 context 改變
- **THEN** role-profile fingerprint SHALL 改變
- **AND** pipeline SHALL NOT 沿用先前的 publish-gate PASS
