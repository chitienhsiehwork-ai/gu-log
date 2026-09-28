/**
 * 來源距離章（source distance stamp）的確定性邏輯：正文投影、原文正規化、斷句、
 * units、兩條規則與零配對、英文逐字檢查、外部來源判斷，以及章的序列化與驗證。
 *
 * 行為契約 SSOT：openspec `source-distance-stamp` spec。所有數字與投影規則集中在
 * POLICY（`source-distance/v1`）；改任何一項就升版，同一個 PR 用
 * `gp-pipeline stamp --file` 重蓋全部 GP（CI 的 validate:posts 驗全站）。
 *
 * aligner（Claude）只提供「每個導讀句轉述了哪些原文句」；指標與結論全部由這裡算。
 * gp-pipeline 透過 scripts/source-distance.mjs（CLI）呼叫；validate-posts 與棘輪直接
 * import。這個檔案只能用純 Node 相依（不 import Astro 專屬模組），pre-commit 要能跑。
 */
import { createHash } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';

export const POLICY = Object.freeze({
  version: 'source-distance/v1',
  // owner 定的數字（只有 owner 能改）：連續段達 runLimit 步、原文占比超過 ratioLimit 就擋。
  runLimit: 3,
  ratioLimit: 0.3,
  // 校準決定的參數（design 決策 4）。
  beta: 0.4, // 等效長度 ≥ β × 原文長度的配對算翻譯型
  kappa: 1.6, // 導讀 units ÷ 原文 units 的換算係數
  gap: 1, // 連續段最多跳過幾句原文
  minStep: 6, // 一步至少要新涵蓋的原文 units
  // 未校準初值（可調）。
  kappaCjk: 1.0, // CJK 比例 ≥ cjkSourceRatio 的原文改用這個 κ（同語言先用等長假設）
  cjkSourceRatio: 0.5,
  maxSourceSentences: 1500, // 第一版不做分段配對
  codeTextCjkRatio: 0.3, // fenced code 的 CJK 占比達到這個值才算文字（投影規則）
  // 英文逐字檢查：n-gram 比例或最長逐字詞數達到門檻就擋；引文豁免上限是原文詞數的比例。
  ngram: Object.freeze({
    n: 8,
    containmentLimit: 0.1,
    verbatimWordLimit: 30,
    quoteAllowanceRatio: 0.05,
  }),
});

const SITE_ORIGIN = 'https://gu-log.vercel.app';

// ─── units ──────────────────────────────────────────────────────────────

const CJK_CLASS = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
const CJK_CHAR = new RegExp(`[${CJK_CLASS}]`, 'u');
const CJK_CHARS = new RegExp(`[${CJK_CLASS}]`, 'gu');
const LATIN_WORDS = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g;

/** units = CJK 字數 + 拉丁詞數（數字算一個詞）。 */
export function units(text) {
  const cjk = (text.match(CJK_CHARS) || []).length;
  const latin = (text.replace(CJK_CHARS, ' ').match(LATIN_WORDS) || []).length;
  return cjk + latin;
}

/** CJK 字元占所有字母與數字的比例。 */
export function cjkRatio(text) {
  const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  return letters ? (text.match(CJK_CHARS) || []).length / letters : 0;
}

/** 以 `|` 或換行分隔的片語清單。 */
function phraseSet(list) {
  return new Set(
    list
      .split(/[|\n]/)
      .map((phrase) => phrase.trim())
      .filter(Boolean)
  );
}

// ─── 斷句 ───────────────────────────────────────────────────────────────

// 句點後面接這些詞不算句尾（小寫比對，不含最後的句點）。
const ABBREVIATIONS = phraseSet(`
  e.g | i.e | vs | mr | mrs | ms | dr | st | jr | sr | u.s | u.k | a.m | p.m
  fig | cf | al | approx | inc | ltd | co
  jan | feb | mar | apr | jun | jul | aug | sep | sept | oct | nov | dec
`);
// 句尾之後緊接的收尾引號、括號與強調符號併進同一句。
const CLOSERS = '」』）)］]"\'”’》*_';
const CJK_TERMINATORS = '。！？；';
// 句點之後要是空白，再接（可選的開頭引號／括號／強調符號）大寫字母、數字或 CJK，才算句尾。
const AFTER_PERIOD = new RegExp(`^\\s+["'“‘(\\[*_]*[A-Z0-9${CJK_CLASS}]`, 'u');

function isAbbreviation(word) {
  const lower = word.toLowerCase();
  // 單一大寫字母加句點是人名縮寫（J. K. Rowling）。
  return ABBREVIATIONS.has(lower) || /^[A-Z]$/.test(word);
}

function splitLine(line) {
  const out = [];
  let buf = '';
  const n = line.length;
  for (let i = 0; i < n; i++) {
    const ch = line[i];
    buf += ch;
    let boundary = false;
    if (CJK_TERMINATORS.includes(ch)) {
      boundary = true;
    } else if (ch === '!' || ch === '?') {
      const next = line[i + 1];
      boundary = next === undefined || /\s/.test(next) || CJK_CHAR.test(next);
    } else if (ch === '.' || ch === '…') {
      // 連續的句點或刪節號當成一個標點。
      let j = i + 1;
      while (j < n && (line[j] === '.' || line[j] === '…')) {
        buf += line[j];
        j++;
      }
      const dotsEnd = j;
      while (j < n && CLOSERS.includes(line[j])) j++;
      const after = line.slice(j);
      const word = (buf.slice(0, buf.length - (dotsEnd - i)).match(/([A-Za-z.]+)$/) || ['', ''])[1];
      if ((after.trim() === '' || AFTER_PERIOD.test(after)) && !isAbbreviation(word)) {
        buf += line.slice(dotsEnd, j);
        i = j - 1;
        boundary = true;
      } else {
        i = dotsEnd - 1;
      }
    }
    if (boundary) {
      while (i + 1 < n && CLOSERS.includes(line[i + 1])) {
        buf += line[i + 1];
        i++;
      }
      out.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

function normalizeSentence(text) {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * 依行、再依中英文句末標點斷句；避開英文縮寫、小數、版本號與網址。
 * 0 units 的碎片（純標點、顏文字）併進前一句，開頭就是 0 units 的碎片丟掉。
 * `noSplit` 給表格列用：整列算一句。
 */
export function splitSentences(text, { noSplit = false } = {}) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const raw = noSplit ? [lines.join(' ')] : lines.flatMap(splitLine);
  const merged = [];
  for (const piece of raw) {
    const sentence = normalizeSentence(piece);
    if (!sentence) continue;
    if (units(sentence) === 0) {
      if (merged.length) merged[merged.length - 1] += ` ${sentence}`;
    } else {
      merged.push(sentence);
    }
  }
  return merged;
}

// ─── MDX 與原文的區塊 ───────────────────────────────────────────────────

const RELATED_READING_HEADINGS = new Set(['延伸閱讀', 'Related Reading']);
// scripts/annotate-broken-links.mjs 在失效連結後面插入的註記。
const BROKEN_LINK_NOTE = /\s*\[⚠️ 此連結已於 \d{4}-\d{2}-\d{2} 確認失效\]/gu;

function textOfJsxAttribute(node, name) {
  const attr = (node.attributes || []).find((a) => a.type === 'mdxJsxAttribute' && a.name === name);
  return attr && typeof attr.value === 'string' ? attr.value : null;
}

/** 站內文章連結的小寫 slug；不是站內文章連結就回 null。 */
export function inSitePostSlug(href) {
  if (typeof href !== 'string' || !href) return null;
  let url;
  try {
    url = new URL(href, `${SITE_ORIGIN}/`);
  } catch {
    return null;
  }
  if (url.origin !== SITE_ORIGIN) return null;
  const match = url.pathname.match(/^\/(?:en\/)?posts\/([^/]+)\/?$/u);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 連到站內文章、而且文字就是目標文 ticket 或標題的連結（taxonomy 與標籤維護唯一會
 * 機械式改寫的形式）不進投影。`ticket: 標題` 是站內連結維護的標準標籤，一併視為
 * 「ticket 或標題」。
 */
function isTicketOrTitleLink(href, text, postIndex) {
  const slug = inSitePostSlug(href);
  if (!slug || !postIndex) return false;
  const target = postIndex.get(slug);
  if (!target) return false;
  const label = normalizeSentence(text);
  const { ticketId, title } = target;
  return Boolean(
    (ticketId && label === ticketId) ||
    (title && label === normalizeSentence(title)) ||
    (ticketId && title && label === `${ticketId}: ${normalizeSentence(title)}`)
  );
}

function inlineText(node, ctx) {
  if (!node) return '';
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return node.value;
    case 'break':
      return '\n';
    case 'image':
    case 'imageReference':
    case 'footnoteReference':
    case 'mdxTextExpression':
    case 'html':
      return '';
    case 'link': {
      const text = (node.children || []).map((c) => inlineText(c, ctx)).join('');
      return isTicketOrTitleLink(node.url, text, ctx.postIndex) ? '' : text;
    }
    case 'mdxJsxTextElement': {
      if (node.name === 'br') return '\n';
      if (node.name === 'img') return '';
      const text = (node.children || []).map((c) => inlineText(c, ctx)).join('');
      if (
        node.name === 'a' &&
        isTicketOrTitleLink(textOfJsxAttribute(node, 'href'), text, ctx.postIndex)
      ) {
        return '';
      }
      return text;
    }
    default:
      return (node.children || []).map((c) => inlineText(c, ctx)).join('');
  }
}

function blockText(node, ctx) {
  return inlineText(node, ctx).replace(BROKEN_LINK_NOTE, '');
}

function isOnlyTicketOrTitleLink(item, ctx) {
  const [paragraph, ...rest] = item.children || [];
  if (rest.length || paragraph?.type !== 'paragraph') return false;
  const [link, ...others] = paragraph.children || [];
  return (
    !others.length &&
    link?.type === 'link' &&
    isTicketOrTitleLink(link.url, inlineText(link, { ...ctx, postIndex: null }), ctx.postIndex)
  );
}

/**
 * scripts/inject-related-posts.mjs 插入的延伸閱讀：固定的標題，緊接一份每項都只有一個
 * ticket／標題型站內連結的清單。只認這個形狀，手寫的延伸閱讀照樣進投影。
 */
function isRelatedReadingBlock(heading, next, ctx) {
  return (
    RELATED_READING_HEADINGS.has(normalizeSentence(blockText(heading, ctx))) &&
    next?.type === 'list' &&
    next.children.length > 0 &&
    next.children.every((item) => isOnlyTicketOrTitleLink(item, ctx))
  );
}

function collectBlocks(node, blocks, ctx, kind = null) {
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    switch (child.type) {
      case 'mdxjsEsm':
      case 'mdxFlowExpression':
      case 'thematicBreak':
      case 'definition':
      case 'yaml':
      case 'toml':
        break;
      case 'heading':
        if (ctx.machineBlocks && isRelatedReadingBlock(child, children[i + 1], ctx)) {
          i++;
          break;
        }
        blocks.push({ kind: 'heading', text: blockText(child, ctx) });
        break;
      case 'paragraph':
        blocks.push({ kind: kind || 'paragraph', text: blockText(child, ctx) });
        break;
      case 'list':
        for (const item of child.children) {
          collectBlocks(item, blocks, ctx, kind === 'quote' ? 'quote' : 'list');
        }
        break;
      case 'blockquote':
        collectBlocks(child, blocks, ctx, 'quote');
        break;
      case 'table':
        for (const row of child.children) {
          const cells = row.children.map((cell) => blockText(cell, ctx).trim()).filter(Boolean);
          blocks.push({ kind: 'table-row', noSplit: true, text: cells.join(' | ') });
        }
        break;
      case 'code':
        // 以 CJK 為主的 fenced code 是文字（例如中文範例），其餘是程式碼，不進投影。
        if (cjkRatio(child.value) >= ctx.policy.codeTextCjkRatio) {
          blocks.push({ kind: 'code-text', text: child.value });
        }
        break;
      case 'html':
        blocks.push({ kind: kind || 'html', text: child.value.replace(/<[^>]+>/g, ' ') });
        break;
      default:
        if (child.children) collectBlocks(child, blocks, ctx, kind);
    }
  }
}

function toSentences(blocks, prefix) {
  const sentences = [];
  let block = 0;
  for (const blk of blocks) {
    const parts = splitSentences(blk.text, { noSplit: blk.noSplit });
    if (!parts.length) continue;
    block++;
    for (const text of parts) {
      sentences.push({
        id: `${prefix}${sentences.length + 1}`,
        text,
        units: units(text),
        block,
        kind: blk.kind,
      });
    }
  }
  return sentences;
}

const FRONTMATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;

/** 拆出 frontmatter 文字與正文；沒有 frontmatter 時 frontmatter 是 null。 */
export function splitFrontmatter(content) {
  const match = content.match(FRONTMATTER);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[2], body: content.slice(match[0].length) };
}

function parseMdx(body) {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMdx).parse(body);
}

/**
 * 導讀（文章）的正文投影與斷句。postIndex：小寫 slug → { ticketId, title }，
 * 用來判斷「文字就是目標文 ticket 或標題」的站內連結；沒給就所有連結都只取文字。
 */
export function segmentGuide(content, { postIndex = null, policy = POLICY } = {}) {
  const { body } = splitFrontmatter(content);
  const tree = parseMdx(body);
  const blocks = [];
  collectBlocks(tree, blocks, { postIndex, policy, machineBlocks: true });
  return toSentences(blocks, 'C');
}

/** 正文投影：一行一句的正規化純文字，不依賴 MDX 套件的序列化格式。 */
export function projectionText(sentences) {
  return sentences.map((s) => s.text).join('\n');
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 內容指紋：`sourceUrl` 原字串加上正文投影的 SHA-256。 */
export function subjectFingerprint(sourceUrl, sentences) {
  return sha256(`${sourceUrl}\n${projectionText(sentences)}`);
}

// ─── 原文正規化 ─────────────────────────────────────────────────────────

// 擷取工具（fetch-x-article.sh、fetch-x-thread.py、fetch-article.py、gp-pipeline
// 的 generic fetch）加上的標頭與標記。
const CAPTURE_MARKERS = [
  /^@\S+ — (?:\d{4}-\d{2}-\d{2}|unknown-date)\s*$/u,
  /^Source URL:/u,
  /^Fetched via:/u,
  /^Fetched:/u,
  /^Published:/u,
  /^Thread: \d+ tweets/u,
  /^=== .* ===$/u,
  /^---+$/u,
  /^THREAD \d+\/\d+/u,
  /^⚠️ INCOMPLETE THREAD/u,
  /^INCOMPLETE_SOURCE_WARNING:/u,
  /^\[media\]$/u,
];

// 網站外框：分享鈕、訂閱、登入之類的整行按鈕文字，出現在任何位置都剪。
const FRAME_LINES = phraseSet(`
  share | share this | share this post | share this article | tweet | copy link | copy url
  email | print | facebook | linkedin | reddit | hacker news
  subscribe | sign in | sign up | log in | follow | listen | save | bookmark
  分享 | 訂閱 | 登入 | 追蹤
`);

// 文末停止標題：從這一行開始到結尾都是外框（相關文章、留言、作者簡介、致謝、引用、
// 註腳、附錄）。只在正文過半之後生效，避免開頭的分享列把整篇剪掉。
const STOP_HEADINGS = phraseSet(`
  related | related posts | related articles | related content | related reading
  read more | more from | you may also like | you might also like | recommended | further reading
  comments | leave a comment | discuss | discussion | tags
  share | share this | share this post | share this article
  subscribe | subscribe to our newsletter | newsletter
  about the author | about the authors | author bio
  acknowledgements | acknowledgments | citation | citations | cite this | cite this article
  footnotes | notes | references | appendix
  相關文章 | 延伸閱讀 | 留言 | 分享 | 訂閱 | 關於作者 | 作者簡介 | 致謝 | 參考資料 | 註釋 | 註解 | 附錄
`);

const DATE_LINE =
  /^(?:(?:published|updated|posted|last updated)\s*(?:on)?:?\s*)?(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}|\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]* \d{4})\b/iu;
const READ_TIME = /\b\d+\s*(?:min|minute)s?\s*read\b|分鐘閱讀|閱讀時間/iu;
const BYLINE = /^(?:by|written by|posted by|作者[:：]?)\s*\S+/iu;
const SENTENCE_END = /[.!?。！？…]["'”’)）」』]*$/u;

function plainLine(line) {
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/u, '')
    .replace(/[*_`]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

function frameKey(line) {
  return plainLine(line)
    .replace(/[:：]$/u, '')
    .trim()
    .toLowerCase();
}

function isLeadingFrameLine(line) {
  const text = plainLine(line);
  if (!text) return true;
  if (FRAME_LINES.has(frameKey(line))) return true;
  if (DATE_LINE.test(text) || READ_TIME.test(text)) return true;
  if (BYLINE.test(text) && units(text) <= 8) return true;
  // 導覽、作者列、題圖說明這類短行：沒有句尾標點的短行。
  return units(text) <= 8 && !SENTENCE_END.test(text);
}

function trimFrame(lines) {
  const kept = lines.filter((line) => !FRAME_LINES.has(frameKey(line)));
  let start = 0;
  while (start < kept.length && isLeadingFrameLine(kept[start])) start++;
  // 整份都像外框（例如很短的推文）就不剪開頭。
  if (start >= kept.length) start = 0;
  const body = kept.slice(start);
  const total = body.reduce((sum, line) => sum + units(plainLine(line)), 0);
  let seen = 0;
  for (let i = 0; i < body.length; i++) {
    if (i > 0 && seen * 2 >= total && STOP_HEADINGS.has(frameKey(body[i]))) {
      return body.slice(0, i);
    }
    seen += units(plainLine(body[i]));
  }
  return body;
}

/**
 * 從擷取結果產生蓋章用的原文：去掉擷取標頭與標記，依寫死的規則剪掉網站外框，
 * 再以跟導讀相同的規則斷句。同一份擷取每次結果都一樣。
 */
export function segmentSource(capture, { policy = POLICY } = {}) {
  const lines = capture
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !CAPTURE_MARKERS.some((re) => re.test(line.trim())));
  const text = trimFrame(lines).join('\n');
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text);
  const blocks = [];
  collectBlocks(tree, blocks, { postIndex: null, policy, machineBlocks: false });
  return toSentences(blocks, 'S');
}

/** κ 依原文的 CJK 比例切換：以 CJK 為主的原文先用等長假設。 */
export function kappaFor(sourceSentences, policy = POLICY) {
  const ratio = cjkRatio(projectionText(sourceSentences));
  return ratio >= policy.cjkSourceRatio ? policy.kappaCjk : policy.kappa;
}

/** 原文的摘要：正規化原文的 SHA-256、units 與 κ。 */
export function sourceSummary(sourceSentences, policy = POLICY) {
  return {
    sourceSha256: sha256(projectionText(sourceSentences)),
    sourceUnits: sourceSentences.reduce((sum, s) => sum + s.units, 0),
    kappa: kappaFor(sourceSentences, policy),
  };
}

// ─── 外部來源與需要章的文章 ─────────────────────────────────────────────

const EXAMPLE_HOSTS = ['example.com', 'example.org', 'example.net'];

/**
 * `sourceUrl` 是不是外部來源：gu-log 自己、示範用網域與 ShroomDog 自己的 ChatGPT 對話
 * 分享都不算。
 */
export function isExternalSource(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) return false;
  let url;
  try {
    url = new URL(sourceUrl.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === new URL(SITE_ORIGIN).hostname) return false;
  if (
    EXAMPLE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ||
    host.endsWith('.example')
  ) {
    return false;
  }
  if (host === 'chatgpt.com' && url.pathname.startsWith('/share/')) return false;
  return true;
}

const GP_TICKET = /^GP-(?:\d+|PENDING)$/;

export function isGpTicket(ticketId) {
  return typeof ticketId === 'string' && GP_TICKET.test(ticketId);
}

/** 需要章的文章：有外部來源、沒下架的 GP（繁中與英文檔）。 */
export function requiresStamp(data) {
  return (
    !!data &&
    isGpTicket(data.ticketId) &&
    data.status !== 'taken-down' &&
    isExternalSource(data.sourceUrl)
  );
}
