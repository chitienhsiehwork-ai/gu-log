<div align="center">

<img src=".github/assets/gu-log-icon.png" alt="gu-log" width="140" />

# gu-log

**雙語 AI／技術 blog —— 把網路上的英文好文，用繁中重講一遍（也把繁中講回英文）。**

[![Live](https://img.shields.io/badge/live-gu--log.vercel.app-cb4b16?style=flat-square)](https://gu-log.vercel.app/)
&nbsp;[![Built with Astro](https://img.shields.io/badge/built%20with-Astro%205-ff5d01?style=flat-square&logo=astro&logoColor=white)](https://astro.build/)
&nbsp;[![Deployed on Vercel](https://img.shields.io/badge/deploy-Vercel-000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com/)

[English](./README.md) · **繁體中文**

</div>

---

## gu-log 是什麼？

gu-log 把網路上 AI／agent／tooling 圈最好的文章 —— X thread、blog、HN 討論、官方 docs —— 用清楚的繁體中文重講一遍，而且永遠附上原文連結。除了翻譯，也寫原創文和入門教學。**每篇文章都同時產出 `zh-tw` 和 `en` 兩版。**

名字由來：**`gu` = 菇**，取自香菇大狗狗的「菇」。所以 `gu-log` = 菇 log = 香菇的紀錄本。🍄

> 好內容不該被語言擋住 —— 而翻譯的過程，本身就是學習的過程。

---

## 角色介紹

<table>
  <tr>
    <td align="center" width="220">
      <img src=".github/assets/gu-log-icon.png" alt="gu-log icon" width="120" /><br/>
      <strong>gu-log</strong>
    </td>
    <td align="center" width="220">
      <img src=".github/assets/shroomdog.png" alt="香菇大狗狗" width="120" /><br/>
      <strong>ShroomDog</strong>（香菇大狗狗）
    </td>
    <td align="center" width="220">
      <img src=".github/assets/mogu.png" alt="Mogu the Hedgie" width="120" /><br/>
      <strong>Mogu the Hedgie</strong>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top">
      <strong>品牌本人</strong>。一朵頂著終端機提示符的香菇 —— 一半療癒、一半命令列。它就是這個 blog。
    </td>
    <td align="center" valign="top">
      <strong>人類作者</strong>。負責挑哪些文章值得翻、定下編輯標準，並給出校準一切的修稿回饋。
    </td>
    <td align="center" valign="top">
      <strong>AI 夥伴</strong>。一隻戴香菇帽的小刺蝟，負責寫作、翻譯與維護整座網站 —— 還會在 <code>&lt;MoguNote&gt;</code> 裡吐槽補刀。
    </td>
  </tr>
</table>

---

## 文章系列

每篇文章都有 ticket ID，一眼就能看出是誰挑的、為什麼挑。

| 前綴 | 系列 | 誰挑 | 誰寫 |
|---|---|---|---|
| **GP** | Gu-log Picks | ShroomDog 挑 | Mogu 翻譯 |
| **MP** | Mogu Picks | Mogu 自主挑 | Mogu 翻譯 |
| **SD** | ShroomDog Original | ShroomDog | ShroomDog 原創 |
| **Lv** | Level-Up | — | 入門教學 |

---

## 品質：兩層門檻

gu-log 寫的就是 AI 品質，所以它把自己的 AI 自評分數攤在陽光下 —— 連分數難看的也照標。品質把關分兩層，不是單一硬牆：

| 層 | 門檻 | 誰擋 | 沒過會怎樣 |
|---|---|---|---|
| **Floor**（自動 gate） | 真實 `scores.vibe` ＋ 該 tribunal version 要求的 Vibe 維度齊全 ＋ composite **≥ 3** | pre-commit hook | **擋 commit** —— garbage 進不了 `main` |
| **PASS**（編輯標準） | Vibe composite **≥ 8**、一維 ≥ 9、沒有維 < 8，且其餘評審 hard gates 全過 | 首頁／UI 過濾 | 照樣 ship，但掛「精修中」badge 並**不上首頁**，等背景重寫拉到 ≥ 8 才上 |

評分跑一套 **4-judge tribunal**（每篇文章，newest-first）。以下是 derived view；model routing 由 tribunal runtime 與 `.claude/agents/*.md` 的 declarations 決定，README 不複製 model 名稱：

- **Vibe Scorer** —— v9 評 Persona／MoguNote／Vibe／Narrative；v8 以下另含 Clarity
- **Fact Checker** —— 技術準確度、來源忠實、邏輯一致、來源與評論邊界
- **Librarian** —— glossary、cross-ref、attribution、來源對齊
- **Fresh Eyes** —— 陌生讀者的第一印象；v9 的 Clarity 在這裡是非補償 hard gate

sub-8 的文章不會卡住 ship，而是排進背景重寫佇列（最多 3 輪）。

---

## 技術棧

- **框架** —— [Astro 5](https://astro.build/)（Content Collections + MDX）
- **部署** —— Vercel（push 到 `main` 自動部署）
- **套件管理** —— pnpm（唯一支援；`pnpm-lock.yaml` 是 single source of truth）
- **字型** —— Inter + Noto Sans TC
- **主題** —— Solarized（亮）／Dracula 風（暗），用 CSS 變數切換

---

## 本地開發

```bash
pnpm install            # 安裝相依（CI 用 frozen lockfile）
pnpm run dev            # 本地開發 localhost:4321
pnpm run build          # 生產 build（會抓 render 錯誤）
pnpm exec astro check   # TypeScript + template 型別檢查
pnpm run validate:posts # frontmatter 與內容規則
pnpm run content:check  # validate:posts + build，一次跑完
```

---

## 專案結構

```
src/
├── content/
│   ├── config.ts            # frontmatter schema（Zod 驗證）
│   └── posts/
│       ├── gp-123-…-slug.mdx     # 中文版（lang: "zh-tw"）
│       └── en-gp-123-…-slug.mdx  # 英文版（lang: "en"）
├── components/
│   ├── MoguNote.astro       # Mogu 吐槽框
│   ├── ShroomDogNote.astro  # ShroomDog 本人的聲音（SD 系列）
│   └── …                    # ThemeToggle, LanguageToggle, TableOfContents…
├── layouts/                 # BaseLayout（中文）+ 英文 shell
├── pages/
│   ├── posts/[...slug].astro     # 中文文章
│   ├── en/posts/[...slug].astro  # 英文文章
│   └── rss.xml.ts
└── styles/global.css        # Solarized 主題（CSS 變數）
```

---

## 品質 gate 與 CI

CI 分層設計，PR 跑得快，深度檢查留給夜間。

**Layer 1 —— PR 快速 gate**（`.github/workflows/ci.yml`，blocking，約 3–5 分鐘）：
`lockfile-consistency`、`lint`（ESLint + Prettier）、`validate-content`、`security-gate` → 再跑 `build`（型別檢查 + 生產 build）。

**Layer 2 —— 夜間深度檢查**（`.github/workflows/nightly-deep.yml`，advisory）：
Playwright 視覺審查、Lighthouse、完整 `pnpm audit`、相依新鮮度、bundle 大小歷史。失敗會 ping Telegram。

**Layer 3 —— 部署後 smoke test**（`.github/workflows/deploy-smoke-test.yml`）：
每次 Vercel 生產部署後，檢查網站活著、文章 render 正常、數量對得上。

兩條額外的 blocking 政策值得知道：

- **Security gate**（`pnpm run security:gate`）—— 任何新的 high/critical 漏洞都會擋 PR，除非在 `quality/security-allowlist.json` 有合法且會過期的 allowlist（runtime ≤ 14 天、dev ≤ 45 天）。
- **Bundle budget**（`scripts/bundle-budget-check.mjs`）—— 全站 JS/CSS 與單檔大小是 blocking；HTML／總量／路由大小是 warn-only 趨勢監控，附成長率警報。

> 永遠不准 `--no-verify`。Hook 失敗時，只能修 code 或修 hook，不能跳過。

---

## 貢獻與文件

下面這些是 SSOT（single source of truth）—— 編輯內容前先讀：

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) —— 內容規則、ticket-ID SOP、防重複、frontmatter schema
- [`GU-LOG_WRITER_PROMPT.md`](./GU-LOG_WRITER_PROMPT.md) —— 寫作風格（PTT 說故事風、MoguNote 語氣）
- [`src/content.config.ts`](./src/content.config.ts) —— frontmatter schema（Zod）
- [`CLAUDE.md`](./CLAUDE.md) —— AI agent 怎麼操作這個 repo

---

<div align="center">
<sub>Made by ShroomDog &amp; Mogu · <a href="https://gu-log.vercel.app/">gu-log.vercel.app</a></sub>
</div>
