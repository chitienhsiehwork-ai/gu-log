/**
 * remark-kaomoji-nowrap
 *
 * Remark plugin that stops kaomoji from being split across a line break.
 *
 * Strategy (content-layer, zero-CSS — works in any renderer: RSS, email, …):
 *   1. Replace ASCII spaces inside a kaomoji with NBSP (U+00A0).
 *   2. Insert a Word Joiner (U+2060) between EVERY adjacent code point of the
 *      kaomoji, so there is no break opportunity anywhere inside it.
 *
 * Why interleave WJ everywhere instead of only at "arm" boundaries: a kaomoji
 * that contains CJK / halfwidth-katakana / Cyrillic glyphs (e.g. w(ﾟДﾟ)w,
 * (´・ω・`), (；ω；)) has Unicode line-break opportunities *between* those
 * inner glyphs, not just at the arms. Joining only the arms left those mid-face
 * breaks live. Interleaving WJ is invisible and makes the whole glyph atomic.
 *
 * Coverage is locked by scripts/check-kaomoji-unbreakable.mjs (CI + pre-commit):
 * if a kaomoji isn't detected/protected here, that gate fails — add its signal
 * glyph to KAOMOJI_CHARS (or its decoration to ARM_CHARS) and re-run.
 */

import { visit } from 'unist-util-visit';

const NBSP = ' ';
const WJ = '⁠';

// Glyphs that mark a bracketed group as a kaomoji rather than ordinary
// parenthetical prose. Only add glyphs that essentially never appear in normal
// "(...)" text — each one here can turn a real parenthetical into a (harmless
// but pointless) nowrap span. Eyes / mouths / cheeks / brows + halfwidth
// katakana (U+FF65–FF9F, e.g. ﾟ ﾉ ･ ｡) + a few Cyrillic/symbol eyes.
// NOTE: do NOT add the backtick ` here — inline-code parentheticals like
// （`Cmd+D`）are prose, not kaomoji. (´・ω・`) is still detected via ´ / ・ / ω.
const KAOMOJI_CHARS = /[°□▽△￣ᴥᴗᵕ◍◔◕๑˃˂ᗜಠ∀ω·•‿╥﹏☆⁰¬⌐■ヘヮД´・⊂⊃⊙≧≦ㅂ₃ง･-ﾟ]/u;

// Decoration / arm glyphs that flank the bracket group (leading or trailing),
// e.g. ╰(°▽°)╯, ヽ(°〇°)ﾉ, ٩(◕‿◕｡)۶, (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧. Halfwidth katakana is
// included via the range so ﾉ / ﾟ / ･ count as arms too.
const ARM_CHARS = '[╯╰ノヽヾ┐┌┘└┻━ゞ☆♪♡✧＊*:。۶٩وﻭงノ／＼＾^＞＜≧≦\\uFF65-\\uFF9F]';

// A kaomoji candidate:
//   Pattern A: ʕ … ʔ                         (bear-style)
//   Pattern B: [arms] ( … ) [arms]           (paren-based, optional flanking arms)
const POTENTIAL_KAOMOJI = new RegExp(
  '(?:' +
    'ʕ[^\\n\\r]{1,18}ʔ' +
    '|' +
    ARM_CHARS +
    '{0,4}' +
    '[（(][^\\n\\r()（）]{1,28}[）)]' +
    ARM_CHARS +
    '{0,8}' +
    ')',
  'gu'
);

/**
 * Make a single kaomoji match unbreakable: NBSP for spaces, then a Word Joiner
 * between every adjacent code point. Idempotent — re-running adds no extra WJ.
 */
function protect(match) {
  const withNbsp = match.replace(/ /g, NBSP);
  const cps = Array.from(withNbsp); // iterate by code point, not UTF-16 unit
  let out = '';
  for (let i = 0; i < cps.length; i++) {
    out += cps[i];
    const next = cps[i + 1];
    if (next !== undefined && cps[i] !== WJ && next !== WJ) out += WJ;
  }
  return out;
}

/**
 * Find kaomoji in a text string and protect them. Exported for the gate + tests.
 */
export function protectKaomoji(text) {
  return text.replace(POTENTIAL_KAOMOJI, (match) => {
    // Structural shape matched — only transform if it actually looks like a
    // kaomoji (contains a face glyph), so normal "(see note)" stays untouched.
    if (!KAOMOJI_CHARS.test(match)) return match;
    return protect(match);
  });
}

// Code points whose Unicode line-break class permits a break with the glyph
// next to them even without a space: CJK ideographs, kana (full + halfwidth),
// Hangul, CJK symbols/punct, Thai. Latin letters / ASCII punctuation / most
// symbols do NOT break without a space, so a kaomoji's outer "w(…)w" letter
// boundaries are safe and must not be flagged.
function breakable(ch) {
  const cp = ch.codePointAt(0);
  return (
    (cp >= 0x3040 && cp <= 0x30ff) || // hiragana + katakana
    (cp >= 0x3000 && cp <= 0x303f) || // CJK symbols & punctuation
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xff65 && cp <= 0xff9f) || // halfwidth katakana
    (cp >= 0x0e00 && cp <= 0x0e7f) || // Thai (complex breaking)
    /\s/.test(ch)
  );
}

/**
 * Reports whether a string still has a real internal line-break opportunity:
 * two adjacent code points with no Word Joiner / NBSP between them where at
 * least one side is in a breakable script. Exported so the gate can assert a
 * protected kaomoji is fully atomic.
 */
export function hasBreakOpportunity(s) {
  const cps = Array.from(s);
  for (let i = 0; i < cps.length - 1; i++) {
    const a = cps[i];
    const b = cps[i + 1];
    if (a === WJ || a === NBSP || b === WJ || b === NBSP) continue;
    if (breakable(a) || breakable(b)) return true;
  }
  return false;
}

/**
 * Remark plugin entry point.
 */
export default function remarkKaomojiNowrap() {
  return (tree) => {
    visit(tree, 'text', (node) => {
      node.value = protectKaomoji(node.value);
    });
  };
}
