## Context

Vercel 的 deployed default 沒有設定 `trailingSlash`，因此現存文章的 `/posts/slug` 與 `/posts/slug/` 都直接回 200。Manifest-backed article removal 目前只產生無 slash 的 literal redirect source；production 的 1,079 條既有規則全部通過 verifier，但 slash 版本繞過規則並回 404。Manifest 約佔一千條 route，為每個 alias 複製第二條 redirect 會逼近或超過 Vercel 2,048-route hard budget。

## Goals / Non-Goals

**Goals:**

- 每個 manifest-backed exact article alias 同時接受無 slash 與一個 trailing slash。
- 兩種形式都直接 308 到同一 canonical destination，且 follow 後為 200。
- 維持一筆 manifest entry 對一條 platform route，不放寬成 deep-path wildcard。
- Production verifier 實際測兩種形式。

**Non-Goals:**

- 不改全站 canonical trailing-slash policy。
- 不替 unknown legacy slug、API、artifact、asset 或深層路徑推斷 destination。
- 不改 listing redirects；它們有獨立且已驗證的有限契約。

## Decisions

1. **每個 article source 使用 Vercel optional-slash path pattern。** 由已通過 slug safety validation 的 literal path 產生 `<path>{/}?`，以一條 route 精確匹配兩種 pathname。這是 Vercel 高階 `redirects[].source` 使用的 `path-to-regexp` 語法；strict compilation 會錨定整條 pathname，而 optional group 只接受零或一個 `/`，不接受 prefix／deep-path 擴張。
2. **Source 與 destination 分開建模。** Source pattern 只屬 incoming match；destination 維持 literal canonical path，避免 capture substitution 或 redirect chain。
3. **Verifier 展開兩個可請求的 variant。** Production audit 不把 path pattern 當 URL，而是對每條 optional-slash source materialize 無 slash與 slash 兩種 GET，逐一驗 raw 308、exact Location、followed 200 與無 loop。
4. **不採 route duplication 或 global `trailingSlash`。** Duplication 消耗有限 route budget；全域設定會改所有 canonical URL 行為並引入額外 redirect，超出本修正範圍。

## Risks / Trade-offs

- [Vercel path pattern 與 JavaScript regex 語法不一致] → unit tests 以 Vercel 同系列的 `path-to-regexp` parser strict-compile 每條 source，CI Preview 仍必須成功編譯後才可 merge，production 再跑全 manifest audit。
- [Pattern 注入或 overmatch] → slug 先通過既有 `SAFE_SLUG`；unit tests 明確拒絕 extra slash 與 deep suffix。
- [Verifier 請求量約倍增] → 維持 bounded concurrency，這是人工 preview／production closure gate，不加入每次 PR 的無界遠端測試。
- [Emergency forward-fix 再次失敗] → 不刪 canonical content；失敗時可回復前一個 literal-source config，並保留已知無 slash 相容性。
