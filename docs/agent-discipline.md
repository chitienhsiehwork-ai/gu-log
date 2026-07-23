# Agent 紀律：跨領域行為規則

> 這份是「agent 怎麼做事」的跨領域行為規則全文。Tier-0 的 `AGENTS.md` 只各留一行摘要 + 指回這裡，完整 nuance、例外、反例都在本檔。
>
> 收錄三條：🛠️ 順手修 friction + 自主原則、🧭 SSOT 紀律、📐 寫 prompt / 規則的耐久原則。

## 🛠️ 主任務做完踩到的 bug，順手修在同一個 PR（atomic commits）

這是個人副業 repo，**velocity > stability**。寫主任務時順手踩到的 bug、寫 follow-up 寫到不爽的小毛刺，**不要另開 branch / 另開 PR / 寫 follow-up commit message 然後甩給 user**——直接在當前 PR 修掉，每個 fix 一個 atomic commit 就好。

**🔴 最高原則：每個 agent 都要完全自主，絕不把問題甩給下一個 session/CCC，也不要為了確認而一直問 user。**

自主包含兩面：(1) 把所有 friction 當場修掉（見下），(2) **CI 綠 + 改動 logical/safe/appropriate + 不是 critical design decision → 直接 merge + auto-delete，不要問 user「要不要合」**。會拖慢流程、浪費 user 注意力的確認式問題一律不問；只有 critical design decision（產品方向、架構、對外承諾、個人品牌調性）才停下來用 `AskUserQuestion`。細節見 [`CCC-playbook` Self-merge policy](../playbooks/CCC-playbook.md)。

任何 CC/CCC 在做任務的過程中撞到的所有 friction——環境沒裝好、hook 紅了、lint 擋了、驗證器報錯、frontmatter schema 不合、相依工具缺、文件過時——**通通是當前這個 agent 的責任，當場用 proper commit 修掉**，放進同一個 PR。不准：

- ❌ 把問題寫進 PR body / commit message 當「known issue / follow-up」然後丟給 user 或下一個 CCC
- ❌ 回頭問 user「要不要我順便修這個？」——這種 friction 不需要 user 決策，預設答案永遠是「修」
- ❌ 假設「下一個 session 會處理」——下一個 session 很可能根本不會發生，問題就這樣爛在那裡

**為什麼這條是最高原則**：

- **甩鍋給下一個 CCC = 浪費 user 的時間和注意力**。每多丟一個問題回去，user 就要多被 prompt 一次、多開一次 GitHub、多 load 一次脈絡。Agent 存在的意義就是把這些 friction 吃掉，不是轉手。
- **同一個 PR 修全部完全 OK**：repo 已開 auto-merge + auto-delete merged branch，PR 是拋棄式的 review surface，不是需要保持「乾淨單一主題」的長期資產。所以「怕弄髒 PR」不是甩鍋的理由——atomic commit 讓 diff 仍然讀得懂、revert 仍然下得了刀。
- 副業 repo 沒人 review queue，另開 PR 只是讓 user 多開一次 GitHub、多 merge 一次
- Atomic commit + revert 已經是足夠的 rollback 工具，不需要 PR 級別的隔離
- Context switch（CC/CCC 重啟、重新 load 整個任務脈絡）的成本遠大於多寫一個 commit
- 避免「我先 ship 主任務、follow-up 留給下一個 session」這種藉口——下一個 session 可能根本不會發生，bug 就這樣 ship 出去了

**例外**（這時可以把 fix 拆成另一個 PR——但**仍然是當前 agent 自己現在開、自己現在 merge**，不是丟給下一個 session）：
- Fix scope 大到會干擾主 PR review/diff（譬如要動 50 個檔案重構）
- Fix 跟主任務語意完全無關（在改 GP 文章時順手發現 build infra bug）
- User 明講「先別管那個，下次再處理」

⚠️ 注意：「另開 PR」≠「甩給下一個 CCC」。另開 PR 的前提是當前 agent 把它開好、跑綠、merge 掉，friction 在這個 session 內就消失。只有 user 明確喊停才可以真正延後。**預設是全部塞同一個 PR**——auto-merge 的 repo 沒有理由為了「主題乾淨」去拆。

**Atomic commit 紀律**：
- 一個 commit 做一件事，commit message 解釋「為什麼修」（不是「修了什麼」——diff 自己會說）
- Revert 時可以乾淨切掉某個 fix 而不影響主任務
- Pre-commit / pre-push hook 一律照跑，不要因為「順手修」就 `--no-verify`

**反例**（不要這樣）：
- ❌ 寫 SP 踩到 frontmatter bug → 用 `--no-verify` 繞過、把 fix 寫進 PR body 當「known issue」
- ❌ 跑 tribunal 失敗 → 在主 commit message 寫「scoring infra broken, fix in follow-up」然後 commit
- ✅ 寫 SP 踩到 frontmatter bug → 在同一個 PR 加一個 `fix(frontmatter): SetBlock 處理 nested key 不存在` commit、main commit 不沾

## 🧭 SSOT 紀律：別複製事實，發現 drift 當場收斂

**每個事實只有一個家（SSOT）。任何 CC/CCC/agent 動到有 SSOT 的東西時，預設責任就是「維持單一真相來源」——不複製事實、發現對不上就當場修。** 這是強制行為，不是「有空再做」。

**為什麼這條要硬**：drift 幾乎都源自同一個錯——**把本來住在某個 SSOT 的值，複製一份到散文/表格裡**。複製出來的副本遲早跟本尊分岔，而且分岔時兩邊都長得「看起來對」，沒人會發現，直到某次踩到才知道文件在說謊。實例（2026-06-18 連踩兩次）：model 版本的 SSOT 是 `.claude/agents/*.md` 的 `model:` frontmatter，但 `playbooks/CCC-playbook.md` 路由表把版本號複製了一份 → agent 檔改了、playbook 沒跟 → fresh-eyes 跟 librarian 都 drift 成假資訊。

**四條操作規則（每個 agent 都要內化）**：

1. **寫一個值之前先問「這是不是別處已有事實的副本？」**——版本號、計數、路徑、清單、schema、設定值都算。是副本 → **連到 / 指向 SSOT，不要複製值**。文件的工作是描述 **policy / 為什麼**，不是當第二份資料庫。
2. **真的非列出來不可時（為了可讀性），明確標註「SSOT = X，此處為 derived view，以 X 為準」**，讓下個讀者知道哪邊是真的、該往哪改。
3. **一旦發現某份文件跟它的 SSOT 對不上（值/路徑/數字/清單兜不攏），當場收斂**——在同一個 PR 把 drift 修掉，不要留給下一個 session（這是〈順手修 friction〉的一種）。**SSOT 永遠贏，文件副本服從 SSOT**，除非你查出來是 SSOT 本身錯了（那就修 SSOT + 同步副本，並說明）。
4. **動到任何系統時，順手掃一眼「我改的這個事實，有沒有別的地方也抄了一份？」**——改 agent frontmatter 就回頭看 playbook 有沒有複述、改 schema 就看 docs 有沒有舊欄位、bump counter 就看有沒有別處寫死數字。改 SSOT 不順手掃副本 = 主動製造下一個 drift。

**哪一邊才是 SSOT？可以 drift 的內容，權威端是「程式碼（code）或 openspec spec」，不是散文文件。** 值 / 行為 / schema / 設定 / 流程的真相住在 **code（含 frontmatter、常數、config、Zod schema）或 openspec 的 spec**；playbook / README / CLAUDE.md / 註解 / task prompt 這些散文都是 **derived view**。兩邊對不上時，**散文服從 code/openspec**，把散文那份改成跟權威端一致——除非你查出來是 code/openspec 本身錯了（那才反過來修權威端，並說明）。兩個權威端互相矛盾（code 跟 openspec 講的不一樣）= 這不是 drift 是真衝突，往下看〈收斂的自主姿態〉第 2 點。

**收斂的自主姿態（跟 CCC self-merge 同一條精神：能自己判斷就別問）**：

1. **能判斷哪邊對 → 自己判斷、把錯的那邊（通常是散文副本）修掉、最後跟 user 提一聲就好**。不要為了確認而停下來問——「playbook 寫 4.7 但 frontmatter 是 opus 浮動」這種 code-vs-doc drift，code 端就是 SSOT，直接把 doc 修好、回報時帶一句「順手收了 X 的 drift」即可。（本 session 的 librarian drift 其實就該這樣自己收，不必開 AskUserQuestion。）
2. **只有「難以判斷、又是重要決定」才叫 user 拍板**（用 `AskUserQuestion`）：例如兩個權威端真的互相矛盾、或要決定的是產品方向 / 架構 / 對外承諾 / 品牌調性 / config 取向（像「fresh-eyes 該 pin 哪代還是浮動」那種是 taste/config 偏好，不是單純 reconcile drift，才值得問）。判斷不出來時，預設往「自己收 + 提一聲」靠，不要往「停下來問」靠。

**為什麼用 prompt 而不是只靠 lint**：drift 的形態太多（版本號、計數、路徑、清單、描述措辭），deterministic guard 抓不完、還容易誤殺正當用法。真正可靠的是**每個 agent 帶著 SSOT 意識在動**——看到對不上就順手收，而不是等某支 checker 剛好覆蓋到。lint 只是補網，不是主防線。

這條把既有的「改規則時只改 SSOT 來源檔，不要在 task prompt 裡重複定義」（見 `AGENTS.md`〈維護這份 Tier-0〉）從「規則文件」推廣到**所有事實**（值、設定、計數、路徑），並加上「權威端 = code/openspec」「主動偵測 + 自主收斂 + 提一聲」的義務。

## 📐 寫 prompt / 規則：抓耐久原則，別把抄自 SSOT 的具體值留在散文

**verbose 散文比抽象規則 drift 得多。** 任何抄自真 SSOT（`settings.json`、workflow YAML、code、frontmatter、某天的計數 / 快照）的具體值，底層一變就默默過期，但句子還在、還「讀起來像對的」。人腦 drift 少，是因為只握幾個 mental model（核心判準）當尺、遇事動態判斷；AI 一次吞很多 token，反而黏在具體細節和 edge case 上，把會爛的特例當真相背。好的 prompt 抓那幾個 load-bearing 的第一性原理，讓未來 agent 照當下狀況判斷，而不是 pin 死一堆會過期的特例。

- **散文只講 policy / 為什麼**；event 名、套件名、計數、路徑、deny 哪個工具這類具體值一律**指回 code / YAML**，不在散文留第二份（複製事實 = 製造 drift，見上面〈SSOT 紀律〉）。
- **審查用 Keep / Simplify / Drop**：transient 環境狀態（「本機目前沒裝」）→ Drop；複製 SSOT 的值 → 指回 SSOT；一個原則被一堆特例埋住 → Simplify 成原則。目標是**少而通用、不易過期**，不是加更多條款。
- **no-op test（Pocock 的刀，跟 drift 互補）**：drift 砍的是「會過期的具體值」，no-op 砍的是「不管過不過期、根本不改變 agent 行為的句子」。檢驗法：把那行刪掉，agent 輸出會變嗎？不變 = no-op，Drop。典型 no-op = agent 預設本來就會做的事——「要 thorough」「commit message 要詳細」「實作要好讀」「仔細思考」。agent 寫的 skill 特別容易整段都是這種空話，難評估、難維護、白燒 token。寫完 prompt / skill 自己過一遍，或用 `/trim` 讓 sub-agent 逐行測。（來源：https://x.com/mattpocockuk/status/2069784839474032896）
- **持久化的 artifact（learning record、note、SOP、prompt）要對「零 session 脈絡的 fresh agent」自洽**：不要塞只有當下這場對話解得開的 handle——session-local 的關卡 / 步驟編號（`Lv.2`、`step 3`）、選項字母（「答對 B」）、「這個 turn / 剛剛那版」、臨時計數。下一個 agent 沒跑過那場流程、沒看過那些選項，這些 token 對它只是噪音（看不懂又燒 context）。**記「證明出來的耐久結論」（學會 / 決定了什麼），不是「產生它的 ephemeral 過程」（在第幾關、選了哪個字母）。** 一句測試：把這行抽出來單獨給一個沒讀過上下文的 agent，它看得懂嗎？看不懂就改寫成自洽的結論。
