# Claude Tag + OpenClaw self-host（LINE / Teams）

## Learner Goal
- 產出 gu-log 系列文：讀者 (c) 雙軌拆篇——公司同事（Teams 企業部署說服/教學）+ gu-log 一般讀者（Claude tag 介紹 + LINE 自架）。
- 目的：介紹 Claude tag 行為與 use case，並示範用 OpenClaw 重現於 LINE（個人 VPS gateway）與 MS Teams（公司 on-prem k8s，原本幻想純內網）。
- 用 shotcall 決定文章 include/exclude；user 是 shotcaller。

## Chosen Frame
- 類比 A：Vainglory「官方 ranked（Claude tag：Anthropic 代管）vs 自架私服（OpenClaw：自由接平台但維運/資安自扛）」。深度 3（深挖細節，含企業部署暗礁）。

## Current Level
- Status: learning（Level 1 進行中）
- Last updated: 2026-07-14
- Confidence: n/a（尚無 MCQ 證據）

## Evidence
- 2026-07-14: Level 0 完成——選 (c) 雙讀者拆篇、類比 A、深度 3。
- 2026-07-14: 一次答對「ephemeral sandbox vs durable thread」——正確推出 idle 釋放後未 push 改動蒸發、thread 上下文可重建 session。
- 2026-07-14: 一次答對「DM 走個人 connectors、org Access bundle 不跟人走」——權限綁頻道不綁玩家的模型成立。
- 2026-07-14: learner 對教學格式提出修正：壓縮 glossary 行無效，重要概念需完整段落（已寫入 user-profile）。
- 2026-07-14: 一次答對 webhook 訊息流向（LINE 雲主動 POST 進 VPS），且自己畫出 user → LINE cloud → webhook 的鏈。
- 2026-07-14: 主動提問 reverse proxy 的用途並自陳不熟其應用——已插入補課。
- 2026-07-14: 主動提問「來源 IP 是 HTTP 還是 TCP 層」，自建 TCP=電話線 / HTTP=電話裡講的語言 類比（正確）——網路分層概念在建立中，適合用此類比續教。

## Key Research Facts（供出題 ground truth，已查證）
- Claude tag：thread=session、ephemeral sandbox（idle 釋放、回覆重建）、thread+memory 持久；per-channel Access bundles、default-deny network、Agent Proxy 邊界注入憑證；channel 用量吃 org pool（預設 $1,000/月）、DM 吃個人帳號；Team/Enterprise 限定、需 org Owner、ZDR 不可用；官方無 Teams/LINE 版。
- OpenClaw：LINE/Teams channel 皆官方支援；LINE 需 public HTTPS webhook（VPS 可行）、5000 字 chunk、markdown stripped、pairing 預設；Teams 需 Azure Bot（2025-07-31 後僅 Single Tenant）、public webhook（純內網不可行）、admin consent、15/30s webhook timeout。
- 安全：CVE-2026-25253（port 18789 + 無認證 → 惡意網站接管 agent）、4 萬+ 裸奔實例、ClawHub ~824 惡意 skill、link-preview 間接 prompt injection。

## Decisions（shotcall 結果）
- 2026-07-14 拆篇：四路全開——① Lv「Claude tag 是什麼」② SD「OpenClaw × LINE 個人自架」③ SD「OpenClaw × Teams 企業部署」④ SD「2026 OpenClaw 安全危機始末」（獨立成篇）。切線紀律：④ 講事件始末與教訓，③ 的安全章節只講「部署時怎麼防」並內連 ④。

- 2026-07-14 Teams 篇主軸：選 A 夢碎敘事軸（隨後 learner 自提 pivot 方案，篇三定位待 L5-2 shotcall 重議）。
- 2026-07-14 learner 自提加碼方案：放棄 Teams，改 self-hosted GitLab issues 當 agent surface（issue thread = session、glab CLI、worktree per issue、egress proxy 注入憑證）——徹底解掉 inbound 問題。視為候選架構納入篇三決策。

- 2026-07-15 L5-2 篇三定案：選 B「內網版 Claude tag」完整弧線（夢碎→頓悟→GitLab issues 落地），但依 learner 組織現實修正：**雙軌結局**——GitLab issues（工程部門、真純內網）與 DMZ+Teams（全部門觸及，風險可控值得開門）並列為兩個 perspective，不是主從關係；Teams DMZ 不只是降級框。Mattermost 內網聊天當延伸段落（phase 2）。
- 2026-07-15 篇三內連結確定：SP-187（官方 Symphony 規格）+ CP-179（Elixir 開源實作）——「Elixir」= CP-179 那個 Elixir 語言寫的 Symphony 實作。

## Context（影響教學方向的 learner 自報資訊）
- learner 組織現實：GitLab 是**各部門各自 self-host**（非全公司單一實例），只有 Teams 能觸及所有部門——這是 DMZ+Teams 路線的真實價值（reach），也是雙軌並列的理由。
- learner 團隊計畫：OpenClaw 部署在 intranet-only on-prem k8s、出網受限，走 forward proxy 在「預期方向」注入憑證（自行重現 Agent Proxy 模式）。L5 需正面處理「inbound webhook 與此計畫的衝突」。

## Known Gaps
- reverse proxy 的實務用途（TLS termination、port 隔離、path routing）不熟——2026-07-14 已補課，待後續驗證是否吸收。

## Teaching Notes
- 用 Vainglory 高端術語（shotcalling、objective trade、open lobby、private server griefing），不解釋基礎。
- 數字/門檻一律引上方 research facts，不憑記憶。

## Next Suggested Levels
- L1 官方 ranked 遊戲規則（session/sandbox 模型）→ L2 入場資格與計費 → L3 私服架構（gateway/webhook）→ L4 shotcall 拆篇 → L5 Teams 內網破滅 + shotcall 主軸 → L6 安全事件 + shotcall 擺放 → L7 LINE 篇 scope shotcall → L8 敘事主線 + include/exclude 總表
