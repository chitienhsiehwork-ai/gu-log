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
import yaml from 'yaml';

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

export const STAMP_FIELD = 'sourceDistance';
export const ENGLISH_SKIPPED_VERBATIM = 'verbatim';
const STAMP_COMMAND = 'tools/gp-pipeline/gp-pipeline stamp --file';

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
function cjkRatio(text) {
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

// 文章 ticket 編號的形狀（含已退役的 SP／CP，舊文章的連結文字還看得到）。
const TICKET_ID = /^(?:GP|MP|SD|Lv|SP|CP)-(?:\d+|PENDING)$/u;

/** 連到站內文章（`/posts/`、`/en/posts/` 與站內絕對網址）的連結。 */
function isInSitePostLink(href) {
  if (typeof href !== 'string' || !href) return false;
  let url;
  try {
    url = new URL(href, `${SITE_ORIGIN}/`);
  } catch {
    return false;
  }
  return url.origin === SITE_ORIGIN && /^\/(?:en\/)?posts\/[^/]+\/?$/u.test(url.pathname);
}

/**
 * 連到站內文章、文字剛好就是一個 ticket 編號（例如 `GP-12`）的連結不進投影：taxonomy 與
 * 標籤維護會機械式改寫這種連結。判斷只看這篇文章自己的內容，不查目標文的標題、狀態或
 * 是否存在，別篇改標題、下架或被刪都不會讓這篇的章過期。
 */
function isTicketLink(href, text) {
  return isInSitePostLink(href) && TICKET_ID.test(normalizeSentence(text));
}

function childrenText(node) {
  return (node.children || []).map((c) => inlineText(c)).join('');
}

function inlineText(node) {
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
      const text = childrenText(node);
      return isTicketLink(node.url, text) ? '' : text;
    }
    case 'mdxJsxTextElement': {
      if (node.name === 'br') return '\n';
      if (node.name === 'img') return '';
      const text = childrenText(node);
      return node.name === 'a' && isTicketLink(textOfJsxAttribute(node, 'href'), text) ? '' : text;
    }
    default:
      return childrenText(node);
  }
}

function blockText(node) {
  return inlineText(node).replace(BROKEN_LINK_NOTE, '');
}

/** 延伸閱讀的一項：只有一個站內文章連結，連結文字以 ticket 編號開頭（`GP-12: 標題`）。 */
function isRelatedReadingItem(item) {
  const [paragraph, ...rest] = item.children || [];
  if (rest.length || paragraph?.type !== 'paragraph') return false;
  const [link, ...others] = paragraph.children || [];
  if (others.length || link?.type !== 'link' || !isInSitePostLink(link.url)) return false;
  const [ticket] = normalizeSentence(childrenText(link)).split(': ', 1);
  return TICKET_ID.test(ticket);
}

/**
 * scripts/inject-related-posts.mjs 插入的延伸閱讀：固定的標題，緊接一份每項都是
 * `- [ticket: 標題](/posts/slug/)` 的清單。只認這個形狀、不查目標文，手寫的延伸閱讀照樣進投影。
 */
function isRelatedReadingBlock(heading, next) {
  return (
    RELATED_READING_HEADINGS.has(normalizeSentence(blockText(heading))) &&
    next?.type === 'list' &&
    next.children.length > 0 &&
    next.children.every(isRelatedReadingItem)
  );
}

function collectBlocks(node, blocks, machineBlocks, kind = null) {
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
        if (machineBlocks && isRelatedReadingBlock(child, children[i + 1])) {
          i++;
          break;
        }
        blocks.push({ kind: 'heading', text: blockText(child) });
        break;
      case 'paragraph':
        blocks.push({ kind: kind || 'paragraph', text: blockText(child) });
        break;
      case 'list':
        for (const item of child.children) {
          collectBlocks(item, blocks, machineBlocks, kind === 'quote' ? 'quote' : 'list');
        }
        break;
      case 'blockquote':
        collectBlocks(child, blocks, machineBlocks, 'quote');
        break;
      case 'table':
        for (const row of child.children) {
          const cells = row.children.map((cell) => blockText(cell).trim()).filter(Boolean);
          blocks.push({ kind: 'table-row', noSplit: true, text: cells.join(' | ') });
        }
        break;
      case 'code':
        // 以 CJK 為主的 fenced code 是文字（例如中文範例），其餘是程式碼，不進投影。
        if (cjkRatio(child.value) >= POLICY.codeTextCjkRatio) {
          blocks.push({ kind: 'code-text', text: child.value });
        }
        break;
      case 'html':
        blocks.push({ kind: kind || 'html', text: child.value.replace(/<[^>]+>/g, ' ') });
        break;
      default:
        if (child.children) collectBlocks(child, blocks, machineBlocks, kind);
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
function splitFrontmatter(content) {
  const match = content.match(FRONTMATTER);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[2], body: content.slice(match[0].length) };
}

function parseMdx(body) {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMdx).parse(body);
}

/** 導讀（文章）的正文投影與斷句，只看這篇文章自己的內容。 */
export function segmentGuide(content) {
  const { body } = splitFrontmatter(content);
  const tree = parseMdx(body);
  const blocks = [];
  collectBlocks(tree, blocks, true);
  return toSentences(blocks, 'C');
}

/** 正文投影：一行一句的正規化純文字，不依賴 MDX 套件的序列化格式。 */
function projectionText(sentences) {
  return sentences.map((s) => s.text).join('\n');
}

function sha256(text) {
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
export function segmentSource(capture) {
  const lines = capture
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !CAPTURE_MARKERS.some((re) => re.test(line.trim())));
  const text = trimFrame(lines).join('\n');
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text);
  const blocks = [];
  collectBlocks(tree, blocks, false);
  return toSentences(blocks, 'S');
}

/** κ 依原文的 CJK 比例切換：以 CJK 為主的原文先用等長假設。 */
function kappaFor(sourceSentences) {
  const ratio = cjkRatio(projectionText(sourceSentences));
  return ratio >= POLICY.cjkSourceRatio ? POLICY.kappaCjk : POLICY.kappa;
}

/** 原文的摘要：正規化原文的 SHA-256、units 與 κ。 */
export function sourceSummary(sourceSentences) {
  return {
    sourceSha256: sha256(projectionText(sourceSentences)),
    sourceUnits: sourceSentences.reduce((sum, s) => sum + s.units, 0),
    kappa: kappaFor(sourceSentences),
  };
}

// ─── 配對驗證 ───────────────────────────────────────────────────────────

/**
 * 驗證 aligner 的輸出：每個導讀句剛好出現一次、所有編號都存在。不合格就丟錯，
 * 這次配對不能當成通過，也不能當成「沒有配對」。回傳 Map<C id, S id[]>。
 */
export function validateAlignment(raw, guide, source) {
  const alignments = raw && typeof raw === 'object' ? raw.alignments : undefined;
  if (!Array.isArray(alignments)) {
    throw new Error('alignment output has no "alignments" array');
  }
  const guideIds = new Set(guide.map((s) => s.id));
  const sourceIds = new Set(source.map((s) => s.id));
  const map = new Map();
  for (const entry of alignments) {
    if (!entry || typeof entry.c !== 'string' || !Array.isArray(entry.s)) {
      throw new Error('alignment entries must look like {"c": "C1", "s": ["S1"]}');
    }
    if (!guideIds.has(entry.c))
      throw new Error(`alignment names unknown guide sentence ${entry.c}`);
    if (map.has(entry.c)) throw new Error(`alignment lists guide sentence ${entry.c} twice`);
    const ids = new Set();
    for (const id of entry.s) {
      if (typeof id !== 'string' || !sourceIds.has(id)) {
        throw new Error(`alignment for ${entry.c} names unknown source sentence ${String(id)}`);
      }
      ids.add(id);
    }
    map.set(entry.c, [...ids]);
  }
  const missing = guide.filter((s) => !map.has(s.id)).map((s) => s.id);
  if (missing.length)
    throw new Error(`alignment is missing guide sentence(s) ${missing.join(', ')}`);
  return map;
}

function unionAlignments(maps) {
  const out = new Map();
  for (const map of maps) {
    for (const [c, ss] of map) out.set(c, [...new Set([...(out.get(c) || []), ...ss])]);
  }
  return out;
}

// ─── 計分 ───────────────────────────────────────────────────────────────

const sentenceIndex = (id) => Number(id.slice(1));

/**
 * 一次配對的指標。規則①（照順序一句對一句）與規則②（原文占比）都由這裡從配對算出，
 * 定義見 source-distance-stamp spec〈擋下條件 SHALL 由程式依固定參數計算〉。
 */
export function scoreAlignment(guide, source, map) {
  const kappa = kappaFor(source);
  const sourceUnits = new Map(source.map((s) => [s.id, s.units]));
  const totalSource = source.reduce((sum, s) => sum + s.units, 0);

  // 有配對的導讀句＝一個配對。
  const pairs = [];
  for (const c of guide) {
    const ss = (map.get(c.id) || []).slice().sort((a, b) => sentenceIndex(a) - sentenceIndex(b));
    if (!ss.length) continue;
    const sourceLength = ss.reduce((sum, s) => sum + sourceUnits.get(s), 0);
    const equivalent = c.units / kappa;
    pairs.push({
      c: c.id,
      block: c.block,
      ss,
      sourceLength,
      equivalent,
      translation: equivalent >= POLICY.beta * sourceLength,
    });
  }

  // 規則①：翻譯型配對依導讀順序沿著原文往前推進時形成連續段。一個配對對到的原文句先
  // 依相鄰關係分群（S4＋S103 不能讓進度直接跳到尾），同時追多條候選連續段取最長。
  const unitsIn = (pair, lo, hi) =>
    pair.ss
      .filter((s) => sentenceIndex(s) > lo && sentenceIndex(s) <= hi)
      .reduce((sum, s) => sum + sourceUnits.get(s), 0);
  const clusters = (pair) => {
    const ids = pair.ss.map(sentenceIndex);
    const out = [];
    let current = [ids[0], ids[0]];
    for (const i of ids.slice(1)) {
      if (i - current[1] <= POLICY.gap + 1) current[1] = i;
      else {
        out.push(current);
        current = [i, i];
      }
    }
    out.push(current);
    return out;
  };
  let maxRun = 0;
  const runs = [];
  let chains = [];
  for (const pair of pairs.filter((p) => p.translation)) {
    const next = [];
    const groups = clusters(pair);
    for (const chain of chains) {
      let best = null;
      for (const [a, b] of groups) {
        let candidate = null;
        if (a >= chain.lastStart && b <= chain.frontier) {
          // 停在已涵蓋範圍內：不加步數，也不切斷。
          candidate = { ...chain, members: [...chain.members, pair.c] };
        } else if (
          a >= chain.lastStart &&
          b > chain.frontier &&
          a - chain.frontier <= POLICY.gap + 1
        ) {
          const fresh = unitsIn(pair, chain.frontier, b);
          candidate = {
            lastStart: a,
            frontier: b,
            steps: chain.steps + (fresh >= POLICY.minStep ? 1 : 0),
            members: [...chain.members, pair.c],
          };
        }
        if (
          candidate &&
          (!best ||
            candidate.steps > best.steps ||
            (candidate.steps === best.steps && candidate.frontier > best.frontier))
        ) {
          best = candidate;
        }
      }
      if (best) next.push(best);
    }
    for (const [a, b] of groups) {
      next.push({
        lastStart: a,
        frontier: b,
        steps: unitsIn(pair, a - 1, b) >= POLICY.minStep ? 1 : 0,
        members: [pair.c],
      });
    }
    const byRange = new Map();
    for (const chain of next) {
      const key = `${chain.lastStart}:${chain.frontier}`;
      if (!byRange.has(key) || byRange.get(key).steps < chain.steps) byRange.set(key, chain);
    }
    chains = [...byRange.values()];
    for (const chain of chains) {
      if (chain.steps > maxRun) maxRun = chain.steps;
      if (chain.steps >= POLICY.runLimit) runs.push(chain.members);
    }
  }

  // 規則②：每個配對最多算它的等效長度，依原文句長度分攤，每個原文句最多算滿自己。
  const credit = new Map();
  for (const pair of pairs) {
    const amount = Math.min(pair.sourceLength, pair.equivalent);
    for (const s of pair.ss) {
      credit.set(s, (credit.get(s) || 0) + (amount * sourceUnits.get(s)) / pair.sourceLength);
    }
  }
  let reproduced = 0;
  for (const [s, value] of credit) reproduced += Math.min(sourceUnits.get(s), value);

  return {
    aligned: pairs.length,
    translationPairs: pairs.filter((p) => p.translation).length,
    maxRun,
    sourceRatio: totalSource ? reproduced / totalSource : 0,
    runs: dedupeRuns(runs),
    pairs,
  };
}

function dedupeRuns(runs) {
  const unique = [...new Map(runs.map((r) => [r.join(','), r])).values()];
  return unique.filter(
    (run) =>
      !unique.some(
        (other) => other !== run && other.length > run.length && run.every((c) => other.includes(c))
      )
  );
}

function failedRules(score, { run = true, ratio = true } = {}) {
  const fails = [];
  if (run && score.maxRun >= POLICY.runLimit) fails.push('run');
  if (ratio && score.sourceRatio > POLICY.ratioLimit) fails.push('ratio');
  return fails;
}

/**
 * 兩次配對的判法：第一次零配對 → ZERO（直接結束，不改寫）；第一次任一條沒過 → FAIL；
 * 第一次三條都過、只有一次配對 → NEEDS_SECOND；第二次的規則①各自判、規則②用聯集 → PASS
 * 或 FAIL。FAIL 附上改寫報告（只列段落，不含門檻、指標或規則名稱）。
 */
export function decide(guide, source, maps) {
  if (!maps.length) throw new Error('decide needs at least one alignment');
  const first = scoreAlignment(guide, source, maps[0]);
  if (first.aligned === 0) {
    return { verdict: 'ZERO', fails: ['zero'], scores: [first] };
  }
  const firstFails = failedRules(first);
  if (firstFails.length) {
    return {
      verdict: 'FAIL',
      fails: firstFails,
      scores: [first],
      report: rewriteReport(guide, source, [maps[0]], [first]),
    };
  }
  if (maps.length < 2) return { verdict: 'NEEDS_SECOND', fails: [], scores: [first] };
  const second = scoreAlignment(guide, source, maps[1]);
  const union = scoreAlignment(guide, source, unionAlignments(maps.slice(0, 2)));
  const fails = [...failedRules(second, { ratio: false }), ...failedRules(union, { run: false })];
  const metrics = {
    maxRun: Math.max(first.maxRun, second.maxRun),
    sourceRatio: floor4(union.sourceRatio),
    alignedSentences: union.aligned,
  };
  if (fails.length) {
    return {
      verdict: 'FAIL',
      fails,
      scores: [first, second],
      union,
      metrics,
      report: rewriteReport(guide, source, maps.slice(0, 2), [first, second]),
    };
  }
  return { verdict: 'PASS', fails: [], scores: [first, second], union, metrics };
}

// 章上的比例無條件捨去到小數四位：通過時的精確值在門檻內，記錄值也一定在門檻內。
function floor4(value) {
  return Math.floor(value * 1e4) / 1e4;
}

function joinSentences(texts) {
  let out = '';
  for (const text of texts) {
    if (out && /[A-Za-z0-9.,!?;:)"'’”]$/.test(out) && /^[A-Za-z0-9("'‘“]/.test(text)) out += ' ';
    out += text;
  }
  return out;
}

/**
 * 改寫報告：只列兩種段落——連續段裡的導讀句（每次配對中達到上限的連續段，去重），以及
 * 依聯集配對、轉述量最多、累計到總轉述量四成的段落。不給門檻、指標或規則名稱，避免寫手
 * 對著數字剛好壓線。
 */
export function rewriteReport(guide, source, maps, scores) {
  const textOf = new Map(guide.map((s) => [s.id, s.text]));
  const runs = dedupeRuns(scores.flatMap((score) => score.runs));
  const runText = runs.length
    ? runs.map((run) => run.map((c) => `- ${textOf.get(c)}`).join('\n')).join('\n\n')
    : '（無）';

  const union = scoreAlignment(guide, source, unionAlignments(maps));
  const byBlock = new Map();
  for (const pair of union.pairs) {
    byBlock.set(
      pair.block,
      (byBlock.get(pair.block) || 0) + Math.min(pair.sourceLength, pair.equivalent)
    );
  }
  const total = [...byBlock.values()].reduce((sum, v) => sum + v, 0);
  const heavy = [];
  let accumulated = 0;
  for (const [block, amount] of [...byBlock].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    if (accumulated >= 0.4 * total) break;
    heavy.push(block);
    accumulated += amount;
  }
  const heavyText = heavy.length
    ? heavy
        .sort((a, b) => a - b)
        .map(
          (block) => `> ${joinSentences(guide.filter((s) => s.block === block).map((s) => s.text))}`
        )
        .join('\n\n')
    : '（無）';

  return [
    '## 連續照原文順序轉述的句子',
    '',
    runText,
    '',
    '## 主要在重講原文內容的段落',
    '',
    heavyText,
    '',
  ].join('\n');
}

// ─── 英文逐字檢查 ───────────────────────────────────────────────────────

function words(text) {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []
  );
}

const QUOTE_SPANS = /“[^”]*”|"[^"\n]*"/gu;

/**
 * 英文版跟正規化原文的逐字比對：非引文文字的詞級 n-gram 有多少比例出現在原文，以及
 * 最長一段跟原文逐字相同的詞數。blockquote 與雙引號內的文字是標明的引文，依文件順序
 * 豁免到上限（原文詞數的比例），超過上限的部分照常計入。
 */
export function englishVerbatim(content, source) {
  const { n, containmentLimit, verbatimWordLimit, quoteAllowanceRatio } = POLICY.ngram;
  const { body } = splitFrontmatter(content);
  const blocks = [];
  collectBlocks(parseMdx(body), blocks, true);

  const sourceWords = words(projectionText(source));
  const vocabulary = new Map();
  const toIds = (list) =>
    list.map((w) => {
      if (!vocabulary.has(w)) vocabulary.set(w, vocabulary.size + 1);
      return vocabulary.get(w);
    });
  const sourceIds = toIds(sourceWords);
  const sourceGrams = new Set();
  for (let i = 0; i + n <= sourceIds.length; i++)
    sourceGrams.add(sourceIds.slice(i, i + n).join(' '));

  // 依文件順序切出一般文字段與引文段。
  const pieces = [];
  for (const { kind, text } of blocks) {
    if (kind === 'quote') {
      pieces.push({ quote: true, words: words(text) });
      continue;
    }
    let last = 0;
    for (const match of text.matchAll(QUOTE_SPANS)) {
      pieces.push({ quote: false, words: words(text.slice(last, match.index)) });
      pieces.push({ quote: true, words: words(match[0]) });
      last = match.index + match[0].length;
    }
    pieces.push({ quote: false, words: words(text.slice(last)) });
  }

  const allowance = Math.floor(quoteAllowanceRatio * sourceWords.length);
  let quotedWords = 0;
  const counted = [];
  for (const piece of pieces) {
    if (!piece.words.length) continue;
    if (!piece.quote) {
      counted.push(piece.words);
      continue;
    }
    const exempt = Math.min(piece.words.length, allowance - quotedWords);
    quotedWords += exempt;
    if (exempt < piece.words.length) counted.push(piece.words.slice(exempt));
  }

  let grams = 0;
  let hits = 0;
  let maxVerbatimWords = 0;
  for (const segment of counted) {
    const ids = toIds(segment);
    for (let i = 0; i + n <= ids.length; i++) {
      grams++;
      if (sourceGrams.has(ids.slice(i, i + n).join(' '))) hits++;
    }
    maxVerbatimWords = Math.max(maxVerbatimWords, longestCommonRun(ids, sourceIds));
  }
  const ngramContainment = grams ? hits / grams : 0;
  const metrics = {
    ngramContainment: floor4(ngramContainment),
    maxVerbatimWords,
    quotedWords,
  };
  const fails = [];
  if (ngramContainment >= containmentLimit) fails.push('ngram');
  if (maxVerbatimWords >= verbatimWordLimit) fails.push('verbatim');
  return { verdict: fails.length ? 'FAIL' : 'PASS', fails, metrics };
}

function longestCommonRun(a, b) {
  let best = 0;
  let previous = new Int32Array(b.length + 1);
  let current = new Int32Array(b.length + 1);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      current[j + 1] = a[i] === b[j] ? previous[j] + 1 : 0;
      if (current[j + 1] > best) best = current[j + 1];
    }
    [previous, current] = [current, previous];
  }
  return best;
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

// ─── 章的序列化 ─────────────────────────────────────────────────────────

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 依固定順序輸出 `sourceDistance` 的 YAML 區塊（不含配對明細）。 */
function serializeStamp(stamp) {
  const lines = [`${STAMP_FIELD}:`];
  lines.push(`  policy: ${quote(stamp.policy)}`);
  lines.push(`  verdict: ${quote(stamp.verdict)}`);
  lines.push(`  subjectSha256: ${quote(stamp.subjectSha256)}`);
  lines.push(`  sourceSha256: ${quote(stamp.sourceSha256)}`);
  lines.push(`  sourceUnits: ${stamp.sourceUnits}`);
  lines.push('  metrics:');
  for (const [key, value] of Object.entries(stamp.metrics)) lines.push(`    ${key}: ${value}`);
  if (stamp.aligner !== undefined) lines.push(`  aligner: ${quote(stamp.aligner)}`);
  if (stamp.rewrites !== undefined) lines.push(`  rewrites: ${stamp.rewrites}`);
  if (stamp.alignerCalls !== undefined) lines.push(`  alignerCalls: ${stamp.alignerCalls}`);
  if (stamp.englishSkipped !== undefined) {
    lines.push(`  englishSkipped: ${quote(stamp.englishSkipped)}`);
  }
  lines.push(`  checkedAt: ${quote(stamp.checkedAt)}`);
  return lines.join('\n');
}

/** 把章寫進 frontmatter（取代既有的章），正文與其他欄位一個字都不動。 */
export function writeStamp(content, stamp) {
  const match = content.match(FRONTMATTER);
  if (!match) throw new Error('file has no YAML frontmatter');
  const lines = match[2].split(/\r?\n/);
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^${STAMP_FIELD}\\s*:`).test(lines[i])) {
      while (i + 1 < lines.length && /^(?:\s|$)/.test(lines[i + 1])) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  const frontmatter = stamp ? [...kept, serializeStamp(stamp)].join('\n') : kept.join('\n');
  return `${match[1]}${frontmatter}${match[3]}${content.slice(match[0].length)}`;
}

export function parseFrontmatter(content) {
  const { frontmatter } = splitFrontmatter(content);
  if (frontmatter === null) return null;
  const data = yaml.parse(frontmatter);
  return data && typeof data === 'object' ? data : null;
}

// ─── 驗章 ───────────────────────────────────────────────────────────────

function isHex64(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function isRatio(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * 驗一篇文章的章。回傳 { required, errors }；errors 為空代表這篇在章這件事上合格。
 * content 是整份檔案（含 frontmatter）；data 是解析過的 frontmatter。
 */
export function verifyStamp({ content, data, file }) {
  const errors = [];
  const required = requiresStamp(data);
  const stamp = data ? data[STAMP_FIELD] : undefined;
  const fix = `${STAMP_COMMAND} ${file}`;
  if (!required) {
    // 下架文章帶章由下架欄位規則報錯，這裡不重複。
    if (stamp !== undefined && data?.status !== 'taken-down') {
      errors.push(
        isGpTicket(data?.ticketId)
          ? `${STAMP_FIELD} only belongs on GP posts with an external sourceUrl; remove it`
          : `${STAMP_FIELD} is only allowed on GP posts (the first version stamps GP only); remove it`
      );
    }
    return { required, errors };
  }
  if (stamp === undefined || stamp === null) {
    errors.push(`GP post with an external source has no ${STAMP_FIELD} stamp — run: ${fix}`);
    return { required, errors };
  }
  if (typeof stamp !== 'object' || Array.isArray(stamp)) {
    errors.push(`${STAMP_FIELD} must be a mapping — run: ${fix}`);
    return { required, errors };
  }
  if (stamp.policy !== POLICY.version) {
    errors.push(
      `${STAMP_FIELD}.policy is ${JSON.stringify(stamp.policy)}, current policy is ${POLICY.version} — re-stamp: ${fix}`
    );
  }
  if (stamp.verdict !== 'PASS') {
    errors.push(`${STAMP_FIELD}.verdict must be PASS — re-stamp: ${fix}`);
  }
  if (!isHex64(stamp.subjectSha256) || !isHex64(stamp.sourceSha256)) {
    errors.push(
      `${STAMP_FIELD}.subjectSha256 and sourceSha256 must be SHA-256 hex digests — re-stamp: ${fix}`
    );
  }
  if (!isCount(stamp.sourceUnits) || stamp.sourceUnits === 0) {
    errors.push(`${STAMP_FIELD}.sourceUnits must be a positive integer — re-stamp: ${fix}`);
  }
  if (typeof stamp.checkedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(stamp.checkedAt)) {
    errors.push(`${STAMP_FIELD}.checkedAt must be YYYY-MM-DD — re-stamp: ${fix}`);
  }
  const metrics = stamp.metrics && typeof stamp.metrics === 'object' ? stamp.metrics : {};
  if (data.lang === 'en') {
    const { ngramContainment, maxVerbatimWords, quotedWords } = metrics;
    if (!isRatio(ngramContainment) || !isCount(maxVerbatimWords) || !isCount(quotedWords)) {
      errors.push(
        `${STAMP_FIELD}.metrics must record ngramContainment, maxVerbatimWords and quotedWords — re-stamp: ${fix}`
      );
    } else if (
      ngramContainment >= POLICY.ngram.containmentLimit ||
      maxVerbatimWords >= POLICY.ngram.verbatimWordLimit
    ) {
      errors.push(`${STAMP_FIELD}.metrics exceed the current verbatim limits — re-stamp: ${fix}`);
    }
    for (const key of ['aligner', 'rewrites', 'alignerCalls', 'englishSkipped']) {
      if (stamp[key] !== undefined)
        errors.push(`${STAMP_FIELD}.${key} does not belong on an English stamp`);
    }
  } else {
    const { maxRun, sourceRatio, alignedSentences } = metrics;
    if (!isCount(maxRun) || !isRatio(sourceRatio) || !isCount(alignedSentences)) {
      errors.push(
        `${STAMP_FIELD}.metrics must record maxRun, sourceRatio and alignedSentences — re-stamp: ${fix}`
      );
    } else if (
      maxRun >= POLICY.runLimit ||
      sourceRatio > POLICY.ratioLimit ||
      alignedSentences === 0
    ) {
      errors.push(
        `${STAMP_FIELD}.metrics exceed the current source-distance limits — re-stamp: ${fix}`
      );
    }
    if (typeof stamp.aligner !== 'string' || !stamp.aligner) {
      errors.push(`${STAMP_FIELD}.aligner must name the aligner model — re-stamp: ${fix}`);
    }
    if (!isCount(stamp.rewrites) || !isCount(stamp.alignerCalls) || stamp.alignerCalls < 2) {
      errors.push(
        `${STAMP_FIELD}.rewrites and alignerCalls must record this stamp's rewrite rounds and aligner calls — re-stamp: ${fix}`
      );
    }
    if (stamp.englishSkipped !== undefined && stamp.englishSkipped !== ENGLISH_SKIPPED_VERBATIM) {
      errors.push(`${STAMP_FIELD}.englishSkipped may only be ${ENGLISH_SKIPPED_VERBATIM}`);
    }
  }
  if (isHex64(stamp.subjectSha256)) {
    let actual;
    try {
      actual = subjectFingerprint(data.sourceUrl, segmentGuide(content));
    } catch (error) {
      errors.push(`cannot compute the body projection for ${STAMP_FIELD}: ${error.message}`);
    }
    if (actual && actual !== stamp.subjectSha256) {
      errors.push(
        `${STAMP_FIELD} is stale: the body projection or sourceUrl no longer matches subjectSha256 — re-stamp: ${fix}`
      );
    }
  }
  return { required, errors };
}
