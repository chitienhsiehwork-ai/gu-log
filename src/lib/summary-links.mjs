import { glossaryAnchor } from './glossary-anchor.mjs';

/**
 * 把純文字摘要切成「文字／詞條連結」片段，給文章頁的摘要區塊用。
 * 摘要在 frontmatter 是純文字（列表卡片、RSS、搜尋都直接印），所以連結
 * 不寫在摘要裡，由這裡照 glossary 自動加：每個詞條只連第一次出現的地方。
 * 比對規則跟 scripts/check-glossary-links.mjs 的 normalizeGlossary 一致
 * （linking.match 優先，否則用 term；預設分大小寫）。
 */

const WORD_CHAR = /[\p{L}\p{N}_-]/u;
const ASCII_WORD = /[A-Za-z0-9]/;

function isBoundary(text, index) {
  const ch = text[index];
  return !ch || !WORD_CHAR.test(ch) || !ASCII_WORD.test(ch);
}

export function linkSummary(summary, glossary, { english = false } = {}) {
  const text = String(summary ?? '').trim();
  if (!text) return [];

  const candidates = [];
  for (const entry of glossary) {
    if (!entry?.term || entry.linking?.enabled === false) continue;
    const linking = entry.linking ?? {};
    const matches =
      Array.isArray(linking.match) && linking.match.length ? linking.match : [entry.term];
    const caseSensitive = linking.caseSensitive !== false;
    const haystack = caseSensitive ? text : text.toLowerCase();
    let best = null;
    for (const match of matches.filter(Boolean)) {
      const needle = caseSensitive ? match : match.toLowerCase();
      let from = 0;
      while (from <= haystack.length) {
        const start = haystack.indexOf(needle, from);
        if (start < 0) break;
        const end = start + needle.length;
        const asciiEdges = ASCII_WORD.test(needle[0]) || ASCII_WORD.test(needle.at(-1));
        if (!asciiEdges || (isBoundary(text, start - 1) && isBoundary(text, end))) {
          if (!best || start < best.start) best = { start, end };
          break;
        }
        from = start + 1;
      }
    }
    if (best) {
      candidates.push({
        ...best,
        href: `${english ? '/en/glossary' : '/glossary'}#${glossaryAnchor(entry)}`,
      });
    }
  }

  // 長的優先，重疊的丟掉，再照位置排回來。
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const picked = [];
  for (const candidate of candidates) {
    if (picked.every((p) => candidate.end <= p.start || candidate.start >= p.end)) {
      picked.push(candidate);
    }
  }
  picked.sort((a, b) => a.start - b.start);

  const segments = [];
  let cursor = 0;
  for (const { start, end, href } of picked) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({ text: text.slice(start, end), href });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
