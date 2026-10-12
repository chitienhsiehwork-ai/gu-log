// Glossary configuration
// 收錄哪些詞以 src/data/glossary.json 為準；新增詞條的判斷標準見 GU-LOG_WRITER_PROMPT.md 的
// Glossary creation standard。

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

export type GlossaryLang = 'zh-tw' | 'en';

// 詞彙表分類的唯一對照（openspec: glossary-browsing）。篩選按鈕依資料實際用到的分類、
// 照這裡的順序產生；詞條的分類標籤顯示對應語言的 label。資料用到這裡沒有的分類時，
// 單元測試會失敗，頁面 build 也會停下來。
export const GLOSSARY_CATEGORY_LABELS: Record<string, Record<GlossaryLang, string>> = {
  tools: { 'zh-tw': '工具', en: 'Tools' },
  concepts: { 'zh-tw': '概念', en: 'Concepts' },
  methods: { 'zh-tw': '方法', en: 'Methods' },
  products: { 'zh-tw': '產品', en: 'Products' },
  models: { 'zh-tw': '模型', en: 'Models' },
  platforms: { 'zh-tw': '平台', en: 'Platforms' },
  people: { 'zh-tw': '人物', en: 'People' },
};

interface GlossaryCategoryEntry {
  category: string;
}

/** 資料用到、但沒有 label 的分類，依第一次出現的順序。 */
export function findUnlabeledGlossaryCategories(entries: GlossaryCategoryEntry[]): string[] {
  const unlabeled = entries
    .map((entry) => entry.category)
    .filter((category) => !Object.hasOwn(GLOSSARY_CATEGORY_LABELS, category));
  return [...new Set(unlabeled)];
}

export function glossaryCategoryLabel(category: string, lang: GlossaryLang): string {
  if (!Object.hasOwn(GLOSSARY_CATEGORY_LABELS, category)) {
    throw new Error(
      `Glossary category "${category}" has no label; add it to GLOSSARY_CATEGORY_LABELS`
    );
  }
  return GLOSSARY_CATEGORY_LABELS[category][lang];
}

/** 篩選按鈕：資料實際用到的分類（不含「全部」），照 GLOSSARY_CATEGORY_LABELS 的順序。 */
export function glossaryCategoryFilters(
  entries: GlossaryCategoryEntry[],
  lang: GlossaryLang
): { id: string; label: string }[] {
  const used = new Set(entries.map((entry) => entry.category));
  return Object.keys(GLOSSARY_CATEGORY_LABELS)
    .filter((id) => used.has(id))
    .map((id) => ({ id, label: glossaryCategoryLabel(id, lang) }));
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
