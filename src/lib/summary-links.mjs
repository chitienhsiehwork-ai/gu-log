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

// 句尾：中文標點後面可以直接斷；半形 . ! ? 要後面是空白或結尾才算（4.0.7、example.com 不斷）。
// 緊跟在後面的收尾引號、括號留在同一句，「……？」。這種連在一起的也算同一個句尾。
// 寫成「一個句尾標點，後面接任意個標點或收尾符號」，不用巢狀的重複，免得遇到一長串 !!!! 時回溯爆炸。
const SENTENCE_END = /[。！？][。！？」』）”’]*|[.!?][.!?"'”’)\]]*/gu;
const CLOSER = /["'”’」』）)\]]$/u;
// 比這短的句子（「結果？」「For.」）不自己佔一行，跟旁邊的句子併在一起。
const MIN_SENTENCE_LENGTH = 8;

/**
 * 把 linkSummary 的片段照句子切開，給摘要區塊「一句一行」用。
 * 連結片段不會被切開；半形句點後面接小寫字母（e.g. 這種縮寫）不算句尾；
 * 引號收在句子中間（他說「講人話。」然後走了）不算句尾；太短的句子併進隔壁。
 * @param {Array<{ text: string, href?: string }>} segments
 * @returns {Array<Array<{ text: string, href?: string }>>} 每一句是一串片段
 */
export function splitSummarySentences(segments) {
  const full = segments.map((segment) => segment.text).join('');
  const links = [];
  let offset = 0;
  for (const segment of segments) {
    if (segment.href) links.push({ start: offset, end: offset + segment.text.length });
    offset += segment.text.length;
  }

  const cuts = [];
  for (const match of full.matchAll(SENTENCE_END)) {
    const cut = match.index + match[0].length;
    if (links.some((link) => cut > link.start && cut < link.end)) continue;
    const rest = full.slice(cut);
    // 半形句尾後面要是空白或結尾才算（規則寫在這裡而不是 regex 的 lookahead，比對才不會回溯）。
    if (/^[.!?]/.test(match[0]) && (/^\S/u.test(rest) || /^\s+\p{Ll}/u.test(rest))) continue;
    if (CLOSER.test(match[0]) && /^\S/u.test(rest)) continue;
    if (full.slice(cuts.at(-1) ?? 0, cut).trim().length < MIN_SENTENCE_LENGTH) continue;
    cuts.push(cut);
  }
  if (cuts.at(-1) !== full.length) {
    // 最後剩下的一小段太短，就併回前一句。
    if (cuts.length && full.slice(cuts.at(-1)).trim().length < MIN_SENTENCE_LENGTH) cuts.pop();
    cuts.push(full.length);
  }

  const sentences = [];
  let from = 0;
  for (const to of cuts) {
    // 句子之間的空白不屬於任何一句。
    const start = from + (full.slice(from, to).match(/^\s*/)?.[0].length ?? 0);
    const sentence = [];
    let position = 0;
    for (const segment of segments) {
      const segmentEnd = position + segment.text.length;
      const sliceStart = Math.max(start, position);
      const sliceEnd = Math.min(to, segmentEnd);
      if (sliceStart < sliceEnd) {
        const text = segment.text.slice(sliceStart - position, sliceEnd - position);
        sentence.push(segment.href ? { text, href: segment.href } : { text });
      }
      position = segmentEnd;
    }
    if (sentence.length) sentences.push(sentence);
    from = to;
  }
  return sentences;
}
