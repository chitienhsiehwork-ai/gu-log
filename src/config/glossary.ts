// Glossary configuration

// Terms that are common enough to NOT need glossary links
// These are either:
// - Too basic (readers should know)
// - Too specific (model names, product names that are self-explanatory)
// - Explained inline in context
export const glossaryExclude = [
  // Claude model names - readers who read this blog should know
  'Sonnet',
  'Haiku',
  'Opus',
  'Claude',

  // Basic AI/ML terms
  'LLM',
  'API',
  'Token',
  'Prompt',
  'Embedding',

  // Common tools that are self-explanatory
  'Obsidian',
  'Notion',
  'Git',
  'GitHub',
  'VS Code',
  'Terminal',

  // Programming basics
  'Markdown',
  'YAML',
  'JSON',
  'Bash',
  'CLI',
];

// Terms that SHOULD be in glossary (for reference when writing)
// This is synced with /glossary page.
// Creation rule: add a term only when it is canonical/reusable, loses useful
// meaning when translated, and needs a stable gu-log mental-model anchor.
// Do not add entries merely to silence check-jingjing; translate ordinary
// English to natural zh-tw instead.
export const glossaryInclude = [
  'Ralph',
  'Vibe Coding',
  'Vibe Note-Taking',
  'Thread',
  'MCP',
  'RL',
  'Claude Code',
  'Codex',
  'Codex app server',
  'Linear',
  'Hooks',
  'Elixir',
  'Subagent',
  'Context Window',
  'Context Rot',
  'Test-time Compute',
  'Tools for Thought',
  'Zettelkasten',
  'MOC',
  'OpenClaw',
  'Cowork',
  'Agent',
  'Agentic Engineering',
  'Software 3.0',
  'Andrej Karpathy',
  'Simon Willison',
  'Boris Cherny',
];
