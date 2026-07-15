# Claude Tag + OpenClaw self-host（LINE / Teams）

## Learner Goal
- 產出 gu-log 系列文：讀者 (c) 雙軌拆篇——公司同事（Teams 企業部署說服/教學）+ gu-log 一般讀者（Claude tag 介紹 + LINE 自架）。
- 目的：介紹 Claude tag 行為與 use case，並示範用 OpenClaw 重現於 LINE（個人 VPS gateway）與 MS Teams（公司 on-prem k8s，原本幻想純內網）。
- 用 shotcall 決定文章 include/exclude；user 是 shotcaller。

## Chosen Frame
- 類比 A：Vainglory「官方 ranked（Claude tag：Anthropic 代管）vs 自架私服（OpenClaw：自由接平台但維運/資安自扛）」。深度 3（深挖細節，含企業部署暗礁）。

## Current Level
- Status: shotcall 全部拍板完，待起手寫「Claude tag 介紹篇」
- Last updated: 2026-07-15
- Confidence: 決策層 full clear

## 核心互動模式（這位 learner 怎麼跑 level-up）
- **邊學邊改題目**：不是被動答 MCQ，而是每關拿到概念就反手修正教學本身（砍「壓縮 glossary 行」、砍編號改用名字、砍 Caddy 教學只留價值）。教學格式的決策權他要拿在手上。
- **概念一到手就外推成真架構**：學完 webhook inbound 鐵律，當場自己推出「換 self-hosted GitLab issues surface 就能徹底繞掉開門問題」——比原訂 Teams DMZ 方案高一階。level-up 的價值對他是「給零件、他自己組」，不是「給答案」。
- **主動挖底層 gap**：撞到不熟的（reverse proxy、TCP vs HTTP 分層）會直接停下來問，且自帶類比（TCP=電話線 / HTTP=電話裡的語言）——正確就沿用他的類比續教。
- **要求有用+有趣+安全三者兼得**，不接受為了安全而閹割（安全危機篇堅持攻擊者視角當鉤子，只是 payload 換成心智模型）。

## 這位 learner 特別厲害的點
- 篇三 GitLab-issues pivot：抓到「問題不是 webhook，是平台的雲不是你的」——self-host GitLab = 把郵局搬進大樓，inbound 問題整類消失。這是本場最強一手。
- 雙軌結局的組織現實判斷：知道 GitLab 各部門各自架、只有 Teams 打得到全公司，所以 depth（GitLab）vs reach（Teams DMZ）並列而非主從。
- 產品判斷：識破「Claude tag 迭代太快、當基礎課考讀者站不住」，把介紹篇從 Lv 改判 SD。

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
- 2026-07-15 L6 篇四定案：C 攻擊者視角當「鉤子」，但**核心 payload 是教 internet/defense 心智模型**（bind address、認證、供應鏈、出網管制、prompt injection 防線），不是攻擊 cookbook。紀律：講清楚「為什麼會被打穿」的原理，不給可複製的攻擊步驟；防護原則通用、內連篇三。learner 信任 Claude 能寫到「有用+有趣+安全」三者兼得。

## Context（影響教學方向的 learner 自報資訊）
- learner 組織現實：GitLab 是**各部門各自 self-host**（非全公司單一實例），只有 Teams 能觸及所有部門——這是 DMZ+Teams 路線的真實價值（reach），也是雙軌並列的理由。
- learner 團隊計畫：OpenClaw 部署在 intranet-only on-prem k8s、出網受限，走 forward proxy 在「預期方向」注入憑證（自行重現 Agent Proxy 模式）。L5 需正面處理「inbound webhook 與此計畫的衝突」。

- 2026-07-15 LINE 篇 scope 定案：A 可複製骨架軸，但 learner 修正——**反代只提「為什麼有用」，工具名 Caddy 全文只出現一次**（「Mogu 自己會挑 Caddy」），重點是「知道可以用反代」這個決策，不教 Caddy 怎麼設。原則：一次性決策不佔教學篇幅，講價值不講操作。反代的價值定調 = **更安全**（gateway 藏 localhost、公網只露單一門單一路徑，正好是安全危機篇 0.0.0.0 裸奔第一爆的反面），一句話帶到即可。
- 2026-07-15 稱呼修正：文章一律用名字（LINE 篇/Teams 篇…）不用編號（已寫入 user-profile）。
- 2026-07-15 介紹篇型別改判：Lv → **SD**（Claude tag 迭代太快、不是可考的基礎，且四篇全 SD 語氣才統一）。四篇型別最終：全 SD。
- 2026-07-15 反代加梗：反代炫砲點後放「攻擊者哭哭」聲（18789 連不上→打 443 被擋→算不出 HMAC 簽章），安全危機篇是主旋律、LINE 篇客串一句。fact-check 雷：無簽章通常回 403 不是 401，寫時挑對。
- 產出順序：介紹篇（SD）先立地基（其他三篇內連它），再 LINE / Teams / 安全危機——理由是「地基」而非「Lv 單純」。（順序待 learner 最終拍板）

## Known Gaps
- reverse proxy 的實務用途（TLS termination、port 隔離、path routing）不熟——2026-07-14 已補課，待後續驗證是否吸收。

## Teaching Notes
- 用 Vainglory 高端術語（shotcalling、objective trade、open lobby、private server griefing），不解釋基礎。
- 數字/門檻一律引上方 research facts，不憑記憶。

## Next Suggested Levels
- L1 官方 ranked 遊戲規則（session/sandbox 模型）→ L2 入場資格與計費 → L3 私服架構（gateway/webhook）→ L4 shotcall 拆篇 → L5 Teams 內網破滅 + shotcall 主軸 → L6 安全事件 + shotcall 擺放 → L7 LINE 篇 scope shotcall → L8 敘事主線 + include/exclude 總表
