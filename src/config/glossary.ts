// Glossary configuration

const GLOSSARY_INTERNAL_ORIGIN = 'https://gu-log.invalid';
const ABSOLUTE_HTTP_URL = /^https?:\/\/[^/?#]+/i;

export interface ParsedGlossaryUrl {
  href: string;
  external: boolean;
}

interface ParseGlossaryUrlOptions {
  allowInternal: boolean;
  field: string;
}

function hasUnsafeUrlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === '\\' || codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function invalidGlossaryUrl(field: string, allowInternal: boolean): never {
  const expected = allowInternal
    ? 'a same-origin root-relative path or an absolute http(s) URL'
    : 'an absolute http(s) URL';
  throw new Error(`Invalid glossary URL at ${field}: expected ${expected}`);
}

export function parseGlossaryUrl(
  value: string,
  { allowInternal, field }: ParseGlossaryUrlOptions
): ParsedGlossaryUrl {
  if (!value || value !== value.trim() || hasUnsafeUrlCharacter(value)) {
    return invalidGlossaryUrl(field, allowInternal);
  }

  if (allowInternal && value.startsWith('/') && !value.startsWith('//')) {
    try {
      const parsed = new URL(value, GLOSSARY_INTERNAL_ORIGIN);
      if (parsed.origin === GLOSSARY_INTERNAL_ORIGIN) {
        return { href: value, external: false };
      }
    } catch {
      // Fall through to the fail-closed diagnostic.
    }
  }

  if (ABSOLUTE_HTTP_URL.test(value)) {
    try {
      const parsed = new URL(value);
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.hostname.length > 0
      ) {
        return { href: value, external: true };
      }
    } catch {
      // Fall through to the fail-closed diagnostic.
    }
  }

  return invalidGlossaryUrl(field, allowInternal);
}

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
  'Benchmark',
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
