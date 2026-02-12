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
// This is synced with /glossary page
export const glossaryInclude = [
  'Ralph',
  'Vibe Coding',
  'Vibe Note-Taking',
  'MCP',
  'Claude Code',
  'Hooks',
  'Subagent',
  'Context Window',
  'Tools for Thought',
  'Zettelkasten',
  'MOC',
  'OpenClaw',
  'Agent',
];
