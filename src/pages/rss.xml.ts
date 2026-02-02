import rss from '@astrojs/rss';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  // Manually define posts since we don't have content collections yet
  const posts = [
    {
      title: '偷走我的 OpenClaw System Prompt：把它變成真正有用的助理',
      link: '/posts/openclaw-executive-assistant-prompt',
      pubDate: new Date('2026-02-02'),
      description: '每個人都在裸裝 OpenClaw，然後納悶為什麼整理 Downloads 就燒 $200。這個 prompt 加入護欄、成本意識、安全邊界。核心哲學：你不是聊天機器人，你是基礎設施。',
    },
    {
      title: '讓你的 AI 在你睡覺時幫你寫 Code — Ralph Loops 升級指南',
      link: '/posts/ralph-loops-build-while-you-sleep',
      pubDate: new Date('2026-02-02'),
      description: '把 Clawdbot 變成全自動建築工：Ralph Loops 技術讓 AI 不再靠 Context Window 記憶，而是把狀態存在檔案裡。73 個 iterations、6 小時、人類只花 5 分鐘——起床就收割 Working Code。',
    },
    {
      title: '用 AI 管 AI：自架 Telegram AI Agent 完整工作流 (OpenClaw)',
      link: '/posts/openclaw-talk-deep-dive',
      pubDate: new Date('2026-02-01'),
      description: 'ShroomDog 的內部技術分享：如何透過三層架構 (手機/Mac/VPS) 打造個人 AI 系統。重點解析：用 Claude Code 當作控制面板 (Control Plane)、Stealth Mode 認證機制、以及經典的 Bug 追蹤故事。',
    },
    {
      title: 'Claude Code 創造者 Boris 的 10 個使用技巧',
      link: '/posts/boris-claude-code-tips',
      pubDate: new Date('2026-02-01'),
      description: 'Boris Cherny（Claude Code 創造者）分享團隊的使用秘訣：多開 Worktrees 並行、Plan Mode 先行、投資 CLAUDE.md 讓它自我進化、用語音輸入加速 3 倍、Subagents 分工、Learning Mode 學習。',
    },
    {
      title: 'AI 輔助如何影響程式技能養成：Anthropic 最新研究',
      link: '/posts/ai-assistance-coding-skills',
      pubDate: new Date('2026-01-31'),
      description: 'Anthropic 的隨機對照實驗發現：使用 AI 輔助的工程師，測驗分數低了 17%（將近兩個等第）。但關鍵不是「用不用 AI」，而是「怎麼用」。高分組和低分組的差別只在於：有沒有追問「為什麼」。',
    },
    {
      title: 'Clawdbot 如何記得一切：不僅是 RAG，而是記憶體系',
      link: '/posts/clawdbot-memory-deep-dive',
      pubDate: new Date('2026-01-31'),
      description: '深入解析 Clawdbot 的大腦：雙層記憶架構（日誌 vs 長期記憶）、混合搜尋（Vector + Keyword）、以及它是如何在 Context Window 有限的情況下，透過 Flush 和 Compaction 機制實現「永遠記得」。',
    },
    {
      title: 'Clawdbot 架構解密：這隻 AI 到底是怎麼運作的？',
      link: '/posts/clawdbot-architecture-deep-dive',
      pubDate: new Date('2026-01-30'),
      description: '深入剖析 Clawdbot (Moltbot) 的內部構造：它是 TypeScript CLI，不是 Web App。揭秘它的「車道佇列」架構、混合記憶系統、以及如何安全地使用你的電腦（Exec & Browser）。',
    },
    {
      title: 'Redis 不只是 Cache：別開著法拉利去買菜',
      link: '/posts/redis-is-more-than-just-a-cache',
      pubDate: new Date('2026-01-30'),
      description: 'Redis 不只是一個很快的 Cache，它是資料結構伺服器。這篇深度好文解釋了為什麼要把 Redis 當成 State Manager，以及如何用它做 Rate Limiting、Session、排行榜和分散式鎖。含大量專有名詞解釋。',
    },
    {
      title: '如何讓你的 Agent 在你睡覺時學習並發布代碼',
      link: '/posts/agent-ships-while-you-sleep',
      pubDate: new Date('2026-01-30'),
      description: 'Ryan Carson 的自動化工作流：每天半夜自動回顧一天的學習，更新 AGENTS.md，然後挑選下一個功能實作並發 PR。Stop prompting, start compounding。',
    },
    {
      title: 'Claude Code 終於有長記憶了：Supermemory Plugin 發布',
      link: '/posts/supermemory-for-claude-code',
      pubDate: new Date('2026-01-29'),
      description: '長期記憶終於來了！Supermemory 讓 Claude Code 記住跨 Session 的對話和知識。開發者 Dhravya 親自演示：如何讓 AI 記得你的偏好、專案脈絡，甚至上次到哪了。',
    },
    {
      title: 'Claude Code 最強用法：Vibe Editing（想到什麼改什麼）',
      link: '/posts/vibe-note-taking-editing-workflow',
      pubDate: new Date('2026-01-29'),
      description: '別再用傳統筆記軟體了。Claude Code + Vibe Mode：你寫日記／筆記／文章，它即時修正英文、加 Markdown 格式、改善流暢度。沒有 UI、沒有 Submit，純粹流動的編輯體驗。',
    },
    {
      title: 'Obsidian + Claude 速成入門：5 分鐘把你的筆記庫變智慧',
      link: '/posts/obsidian-claude-101',
      pubDate: new Date('2026-01-29'),
      description: '一份超完整的 Obsidian x Claude Desktop 入門教學，從安裝、權限設定、到實戰案例（找筆記、生日快篩、日誌統計）。不是理論，都是實際指令和效果截圖。',
    },
    {
      title: 'Obsidian + Claude 進階技：無限 Context + 非同步 Hooks',
      link: '/posts/obsidian-claude-async-hooks',
      pubDate: new Date('2026-01-28'),
      description: 'Obsidian 整合 Claude 的殺手級技巧：無限制 Context Window（透過 Vault Search）和非同步 Hooks（寫入檔案不 Block LLM 推理）。以及為什麼用 MCP 比 Templater/DataView 更適合 AI。',
    },
    {
      title: '從 Obsidian 學 Context Engineering：怎麼讓 AI 真正「懂」你的筆記',
      link: '/posts/obsidian-context-engineering',
      pubDate: new Date('2026-01-28'),
      description: '讓 Claude 幫你整理筆記的核心心法：Context Engineering。從原始的「把整個 Vault 丟進 Prompt」，到學會設計 Instruction、用 MCP Tools 精準取檔、少即是多的減法哲學。',
    },
    {
      title: 'Claude + Obsidian 的 Self-Aware Infrastructure 觀念',
      link: '/posts/claude-obsidian-infrastructure',
      pubDate: new Date('2026-01-27'),
      description: 'Simon Willison 示範的智慧筆記系統哲學：讓 Claude 可以「讀／寫自己的大腦」。從 Zed AI、Prompt Library、到 API 日誌追蹤，如何讓 AI 成為自己系統的一部分。',
    },
    {
      title: '用 Claude 打造你的 Tool for Thought：從筆記到個人 OS',
      link: '/posts/build-claude-tool-for-thought',
      pubDate: new Date('2026-01-27'),
      description: 'Simon Willison 如何用 Claude Desktop + Obsidian 從單純筆記軟體，進化成「可以對話的個人作業系統」。比喻：Obsidian 是大腦，Claude 是意識，MCP 是神經系統。',
    },
    {
      title: 'Claude Code 和 Codex 的正面對決：誰是真正的 AI 編輯器？',
      link: '/posts/claude-code-vs-codex',
      pubDate: new Date('2026-01-26'),
      description: 'Alex 的深度比較：Claude Code 簡單、高效、適合新手；Codex 強大、可編程、Vim 模式、支援自訂 Agent。但 Codex 還不穩定，Claude Code 是「今天可用的生產力工具」。',
    },
    {
      title: '從零打造一個 PRD：用講的就好',
      link: '/posts/yapping-to-prds',
      pubDate: new Date('2026-01-26'),
      description: 'Ryan Carson 示範如何用 Claude Code 的語音模式「邊散步邊設計產品」。從零開始，用 30 分鐘的碎碎念就生成完整的 PRD、User Stories、甚至 MVP Spec。',
    },
  ];

  return rss({
    title: '香菇大狗狗 - ShroomDog',
    description: '精選外文好文，翻譯成繁體中文。每篇都附原文連結。',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.title,
      link: post.link,
      pubDate: post.pubDate,
      description: post.description,
    })),
    customData: '<language>zh-TW</language>',
  });
}
