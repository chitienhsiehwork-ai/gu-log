## Why

gu-log 目前沒有禁止 emoji 的內容規則，writer 仍可能把愛心或圖示字元帶進文章；GP-274 已讓讀者直接碰到這個品牌語感問題。ShroomDog 已明確決定：讀者可見的文章內容預設不用 emoji，只有他逐次明確授權的例外才能保留。

## What Changes

- 把「reader-visible article content 預設禁止 Unicode emoji；kaomoji 不在此禁令內」寫進 editorial contract 與 writer guidance。
- 新增共用 deterministic validator：本機 pre-commit 阻擋 staged 新增 emoji，CI 以 PR base 為基準再次阻擋。
- 例外只能透過 repo 內可稽核的明確授權紀錄放行，並限制在指定文章與指定 emoji，不提供文章作者可任意開啟的通用旗標。
- 既有文章採 non-retroactive ratchet：不為這次規則批次重寫歷史內容，但任何新增 emoji 都會被擋；已存在的 emoji 可在後續 editorial maintenance 中逐步移除。
- 移除 GP-274 繁中與英文結尾的愛心，並記錄這次 ShroomDog feedback。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `editorial-charter`: 新增 reader-visible emoji 預設禁用、kaomoji 邊界、逐次明確授權例外，以及 pre-commit／CI 雙層 deterministic enforcement 的需求。
- `gp-source-preservation`: 明定來源中的 emoji 預設不進譯文，移除 glyph 不算改變 source payload；若該符號承載可辨識語意，譯文須用自然文字保留意思，除非 ShroomDog 明確授權保留該 emoji。

## Impact

- `openspec/specs/editorial-charter/spec.md` 的穩定 editorial contract。
- `GU-LOG_WRITER_PROMPT.md`、`CONTRIBUTING.md` 與 `docs/shroomdog-editorial-feedback.md`。
- `scripts/` 內的內容 validator 與測試、`scripts/hooks/pre-commit`、`.github/workflows/ci.yml`，以及 GP source／sidecar translation prompt contract。
- GP-274 的 zh-tw／en MDX 與其 reader revision manifest；不新增 runtime dependency，也不改公開 API。
