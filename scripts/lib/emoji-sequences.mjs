import { findKaomojiSpans } from '../../src/plugins/remark-kaomoji-nowrap.mjs';

const TAG_FLAG_SEQUENCE = '\\u{1F3F4}[\\u{E0061}-\\u{E007A}]+\\u{E007F}';
const EMOJI_MODIFIED_ATOM = '\\p{Emoji_Modifier_Base}\\uFE0F?\\p{Emoji_Modifier}';
const EMOJI_DEFAULT_ATOM =
  '(?:(?!\\p{Emoji_Modifier})(?:\\p{Emoji_Presentation}\\uFE0F?|\\p{Emoji}\\uFE0F)|[♥♡❤])';
const EMOJI_JOIN_ATOM = `(?:${EMOJI_MODIFIED_ATOM}|\\p{Extended_Pictographic}\\uFE0F?)`;
const EMOJI_ATOM = `(?:${EMOJI_MODIFIED_ATOM}|${EMOJI_DEFAULT_ATOM})`;
const EMOJI_SEQUENCE = `${EMOJI_ATOM}(?:\\u200D${EMOJI_JOIN_ATOM})*`;
const EMOJI_RE = new RegExp(
  `(?:${TAG_FLAG_SEQUENCE}|\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|${EMOJI_SEQUENCE}|\\p{Emoji_Modifier})`,
  'gu'
);
const KAOMOJI_TEXT_EMOJI_OVERLAP = new Set(['♥', '♡', '❤']);
const KAOMOJI_EYE = '[°□■◍◔◕๑ಠ♥♡❤⊙⌐¬]';
const KAOMOJI_MOUTH = '[▽△￣ᴥᴗᵕ˃˂ᗜ∀ω‿╥﹏ヘヮД・≧≦ㅂ₃]';
const KAOMOJI_FACE_STRUCTURE = new RegExp(
  `${KAOMOJI_EYE}[^\n\r]{0,10}${KAOMOJI_MOUTH}[^\n\r]{0,10}${KAOMOJI_EYE}`,
  'u'
);

function hasStructuredHeartKaomoji(span) {
  return KAOMOJI_FACE_STRUCTURE.test(span.text);
}

function isAllowedKaomojiTextOverlap(match, kaomojiSpans) {
  if (!KAOMOJI_TEXT_EMOJI_OVERLAP.has(match[0])) return false;
  const start = match.index;
  const end = start + match[0].length;
  return kaomojiSpans.some(
    (span) => start >= span.start && end <= span.end && hasStructuredHeartKaomoji(span)
  );
}

export function findEmojiSequences(text) {
  const kaomojiSpans = findKaomojiSpans(text);
  return [...text.matchAll(EMOJI_RE)]
    .filter((match) => !isAllowedKaomojiTextOverlap(match, kaomojiSpans))
    .map((match) => ({
      emoji: match[0],
      index: match.index,
    }));
}
