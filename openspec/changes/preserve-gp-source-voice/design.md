## Context

現行 GP 流程把同一份 source 依序交給 writer、reviewer、refiner 與會觸發 rewrite 的 Tribunal。規格雖要求 source fidelity，執行 prompt 與 scoring 卻同時獎勵 hook、story-driven structure、persona、MoguNote density、narrative arc 與 callback。GP-273 顯示自然第一人稱翻譯會在這條路徑中被改成第三人稱品牌文章，而且 scorer 將變形判成高品質。

## Goals / Non-Goals

**Goals:**

- 讓 GP 正文成為原作者文章的自然繁中版本。
- 將 AI 的 editorial authority 限制在翻譯、明確 slop removal、navigation enrichment 與 evidence-bounded correction。
- 讓 fidelity、source voice 與自然中文成為不可由其他分數補償的 publish gates。
- 保留 MoguNote、glossary 與 gu-log references，但不讓它們污染 source body。

**Non-Goals:**

- 不要求逐字翻譯或保留不自然英文句法。
- 不禁止所有刪減；明確不承載 payload／voice 的 AI slop 仍可刪。
- 不替 SD、Lv 或明確授權的 guided reading 設定同樣限制。
- 本 change 不重寫 GP-273 的 production body；它只把原始版本收成 regression fixture，並實作新的 pipeline contract。

## Decisions

### 1. 以 source-preserving translation 取代 generative article writing

GP 不再從 source「寫一篇文章」，而是產出 source-aligned translation。這直接移除 writer 自行尋找 angle、spine 與新敘事形狀的權限。

替代方案是繼續擴充 writer prompt，新增「自然一點」「少一點比喻」。不採用，因為 prompt 同時要求忠實與 narrative transformation 時，模型仍會用表面規則換取 scorer 高分。

### 2. 將正文與 enrichment 分成不同 artifact／stage

建議流程：

```text
source capture
      │
      ▼
source-preserving translation ──► fidelity + voice diff
      │                                  │
      │ PASS                             │ FAIL → stop
      ▼                                  │
navigation enrichment                    │
(glossary / gu-log refs)                 │
      │                                  │
      ▼                                  │
optional MoguNote ───────────────────────┘
      │
      ▼
natural-language blind read
      │
      ├─ PASS → publish
      └─ FAIL → bounded patch → recheck
```

正文翻譯完成後先凍結 source-aligned body。references、glossary links 與 MoguNote 在後續 stage 加入，並各自接受「移除 enrichment 後 body 不變」的檢查。

### 3. Review 產生 patch contract，不產生 rewrite brief

Review finding 必須包含 source quote、translation quote、issue type、replacement boundary 與 suggested replacement。Correction provider 只能修改 boundary 內文字及必要相鄰銜接。無法局部修正的 finding 停給人看，不自動升級全文 rewrite。

### 4. 將自然中文從平均分數改為 hard gate

Fresh Eyes 必須實際圈出不自然字詞並給出讀者能辨識的替代說法。`銜尾蛇` 與 `演算法動態` 類案例作為 calibration：問題不是字典定義不存在，而是讀者必須停下來解碼，且有更自然的直接說法。

### 5. GP 排除 editorial rebuild

`add-editorial-spine-rebuild` 的 `restructure`／`rebuild` 適用於 SD、Lv 與明確選擇 guided-reading／adaptation 的內容。GP 若 source 本身無聊，忠實翻譯可以仍然無聊；選錯 source 是 eval 問題，不應靠翻譯階段偷換作者補救。

### 6. Fail closed

現行 `Ralph` 將 Tribunal error 視為 advisory 並繼續 deploy。GP source-preservation gates 必須改為 blocking。可恢復性由保留 workdir artifacts 與 `--from-step` 提供，不靠發布低品質文章。

### 7. Translator、corrector 與 vibe scorer 必須角色隔離

三個會直接影響 GP 文字品質的角色 SHALL 使用不同 model ID、不同 prompt 與不同輸出 contract：

- **Translator** 只輸出 source-aligned 繁中正文與可稽核的 slop deletion candidates，不負責 persona、narrative arc、MoguNote 或評分。第一版 VM routing 使用 `grok-4.6`。
- **Corrector** 只接收已核准 finding，輸出符合 schema 的 bounded patches；不得看到 vibe 分數，也不得重寫未在 boundary 內的段落。第一版 VM routing 使用 `gpt-5.6-sol`。
- **Vibe Scorer** 以冷讀者視角評自然度與可讀性，不取得 translator／corrector 的 reasoning、prompt 或中間結論，也不得提出全文 rewrite。第一版 VM routing 使用 `grok-4.5`。

實際 model ID 與 reasoning effort 的 SSOT SHALL 留在 pipeline config；本設計記錄的是初始 rollout，而不是要求所有環境永久硬編相同版本。Reviewer 與 deterministic hard gates 仍是獨立角色，不得把 vibe scorer verdict 當作 source fidelity verdict。

## Risks / Trade-offs

- **GP 可能不再每篇都有強烈 gu-log persona** → 這是刻意取捨；persona 應存在於 MoguNote，正文的主角是 source author。
- **「obvious AI slop」仍有主觀性** → 要求逐項 source evidence，且刪除必須同時通過 payload 與 voice preservation；有疑義就保留。
- **References 可能破壞原文節奏** → 優先做 inline link，不新增 prose；無自然落點時放延伸閱讀。
- **既有 judge dimensions 可能持續獎勵改寫** → GP hard gates 優先於平均分，並以 GP-273 regression pair 校準。
- **與既有 spine-rebuild change 衝突** → 在兩份 capability 與 routing 中明確標示 GP exclusion；實作前先解決 active change 的 scope drift。
- **多 model routing 增加 provider failure surface** → 每個角色各自做 preflight 並保存 role-specific failure evidence；缺 provider、runner error 或 model provenance 不完整時 fail closed，不得偷偷 fallback 到另一個角色的 model。

## Migration Plan

1. 先建立 GP-273 regression fixture 與 current-behavior characterization tests。
2. 將 GP writer 改成 translation stage，移除 angle／story-driven rewrite authority。
3. 拆出 navigation enrichment 與 MoguNote stage。
4. 將 review/refine 改成 bounded patch protocol。
5. 接上 source voice、natural language 與 fail-closed publish gates。
6. 以少量既有 GP shadow run，比較新舊輸出；只有新路徑通過 regression 與人工讀感才切換預設。
7. rollback 時保留舊 pipeline entrypoint 供診斷，但不得恢復 best-effort production deploy。

## Implementation Choices

- MP 共享 editorial source-preservation contract，但本 change 的 executable pipeline scope 先以 GP 為主；MP automation 另開 follow-up change。
- Translator MAY 提出 AI slop deletion candidates；只有帶 source boundary 與理由、且通過獨立 reviewer 的 candidate 才能套用。有疑義一律保留。
- MoguNote 是獨立、optional enrichment；只有 source 與 gu-log 確實有值得補充的觀點時才生成，不設數量目標。
