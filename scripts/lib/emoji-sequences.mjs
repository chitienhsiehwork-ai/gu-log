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
const KAOMOJI_EYE = '[°■◍◔◕๑ಠ♥♡❤⊙¬]';
const KAOMOJI_MOUTH = '[□_▽△￣ᴥᴗᵕ˃˂ᗜ∀ω‿╥﹏ヘヮД・≧≦ㅂ₃]';
const KAOMOJI_FACE_SEPARATOR = '(?:\\s|[•｡；´｀*:･ﾟ]|\\p{M})*';
const KAOMOJI_FACE_STRUCTURE = new RegExp(
  `^${KAOMOJI_FACE_SEPARATOR}(${KAOMOJI_EYE})${KAOMOJI_FACE_SEPARATOR}(${KAOMOJI_MOUTH})${KAOMOJI_FACE_SEPARATOR}(${KAOMOJI_EYE})${KAOMOJI_FACE_SEPARATOR}$`,
  'du'
);

function hasStructuredHeartKaomoji(span, match) {
  const openingIndex = span.text.search(/[（(]/u);
  const closingIndex = Math.max(span.text.lastIndexOf(')'), span.text.lastIndexOf('）'));
  if (openingIndex < 0 || closingIndex <= openingIndex) return false;

  const face = span.text.slice(openingIndex + 1, closingIndex);
  const faceMatch = KAOMOJI_FACE_STRUCTURE.exec(face);
  if (!faceMatch?.indices) return false;

  const relativeStart = match.index - span.start;
  const relativeEnd = relativeStart + match[0].length;
  const faceStart = openingIndex + 1;
  if (relativeStart >= faceStart && relativeEnd <= closingIndex) {
    const inFaceStart = relativeStart - faceStart;
    const inFaceEnd = relativeEnd - faceStart;
    return [faceMatch.indices[1], faceMatch.indices[3]].some(
      ([eyeStart, eyeEnd]) => eyeStart === inFaceStart && eyeEnd === inFaceEnd
    );
  }

  return relativeEnd === openingIndex || relativeStart === closingIndex + 1;
}

function isAllowedKaomojiTextOverlap(match, kaomojiSpans) {
  if (!KAOMOJI_TEXT_EMOJI_OVERLAP.has(match[0])) return false;
  const start = match.index;
  const end = start + match[0].length;
  return kaomojiSpans.some(
    (span) => start >= span.start && end <= span.end && hasStructuredHeartKaomoji(span, match)
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
